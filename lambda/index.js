const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
const { BedrockRuntimeClient, InvokeModelCommand } = require('@aws-sdk/client-bedrock-runtime');
const { STSClient, AssumeRoleCommand } = require('@aws-sdk/client-sts');
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const crypto = require('crypto');

const secretsClient = new SecretsManagerClient({ region: 'eu-west-2' });
const bedrockClient = new BedrockRuntimeClient({ region: 'eu-west-2' });

// ─── Encryption ───────────────────────────────────────────────────────────────

function encryptToken(data, key) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key, 'hex'), iv);
    let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}.${encrypted}.${tag}`;
}

function decryptToken(token, key) {
    const [ivHex, encrypted, tagHex] = token.split('.');
    const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        Buffer.from(key, 'hex'),
        Buffer.from(ivHex, 'hex')
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return JSON.parse(decrypted);
}

// ─── AI Generation ────────────────────────────────────────────────────────────

async function generateActionPlan(circumstances) {
    const payload = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 2048,
        messages: [{
            role: 'user',
            content: `Based on these circumstances, generate 3-8 practical action steps with relevant local service links:\n\n${circumstances}`
        }],
        system: 'You are a family support advisor. Generate specific, actionable steps with links to real local services.'
    };

    const command = new InvokeModelCommand({
        modelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
        body: JSON.stringify(payload),
        contentType: 'application/json'
    });

    const response = await bedrockClient.send(command);
    const result = JSON.parse(new TextDecoder().decode(response.body));
    return parseActions(result.content[0].text);
}

function parseActions(text) {
    const lines = text.split('\n').filter(l => l.match(/^\d+\.|^-|^\*/));
    return lines.map(l => l.replace(/^\d+\.\s*|^[-*]\s*/, '').trim()).filter(Boolean);
}

// ─── Email (Cross-Account SES) ────────────────────────────────────────────────

async function sendEmail(to, caseRef, actions, encryptionKey, baseUrl) {
    const sesRole = await getSecret('ses-role');
    const stsClient = new STSClient({ region: 'eu-west-2' });
    const assumed = await stsClient.send(new AssumeRoleCommand({
        RoleArn: sesRole.roleArn,
        RoleSessionName: 'packages-email'
    }));

    const sesClient = new SESClient({
        region: 'eu-west-2',
        credentials: {
            accessKeyId: assumed.Credentials.AccessKeyId,
            secretAccessKey: assumed.Credentials.SecretAccessKey,
            sessionToken: assumed.Credentials.SessionToken
        }
    });

    const actionsHtml = actions.map((action, i) => {
        const completeToken = encryptToken({ caseRef, action: i + 1 }, encryptionKey);
        const updateToken = encryptToken({ caseRef, action: i + 1, type: 'update' }, encryptionKey);
        return `
            <tr>
                <td><img src="${baseUrl}/status/${caseRef}/action-${i + 1}.png" width="20" height="20"/></td>
                <td>${escapeHtml(action)}</td>
                <td><a href="${baseUrl}/action-complete?token=${completeToken}">Mark Complete</a></td>
                <td><a href="${baseUrl}/action-update?token=${updateToken}">Update</a></td>
            </tr>`;
    }).join('');

    const closeToken = encryptToken({ caseRef, type: 'close' }, encryptionKey);

    await sesClient.send(new SendEmailCommand({
        Source: 'noreply@council.gov.uk',
        Destination: { ToAddresses: [to] },
        Message: {
            Subject: { Data: `Your Action Plan - ${caseRef}` },
            Body: {
                Html: { Data: `<h2>Your Personalised Action Plan</h2>
                    <table>${actionsHtml}</table>
                    <p><a href="${baseUrl}/close-case?token=${closeToken}">Close my case</a></p>` }
            }
        }
    }));
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function getSecret(name) {
    const cmd = new GetSecretValueCommand({ SecretId: `ai-packages-${name}` });
    const result = await secretsClient.send(cmd);
    return JSON.parse(result.SecretString);
}

// ─── Route Handler ────────────────────────────────────────────────────────────

exports.handler = async (event) => {
    const path = event.path || event.rawPath;
    const method = event.httpMethod || event.requestContext?.http?.method;

    try {
        if (path === '/call-ai' && method === 'POST') {
            const { circumstances } = JSON.parse(event.body);
            if (!circumstances || circumstances.length > 5000) {
                return response(400, { error: 'Invalid circumstances' });
            }
            const actions = await generateActionPlan(circumstances);
            return response(200, { actions });
        }

        if (path === '/create-case' && method === 'POST') {
            const { circumstances, email, actions } = JSON.parse(event.body);
            const caseRef = await createCrmCase(circumstances, email, actions);
            if (email) {
                const { key } = await getSecret('encryption-key');
                await sendEmail(email, caseRef, actions, key, process.env.BASE_URL);
            }
            return response(200, { success: true, caseReference: caseRef });
        }

        if (path === '/action-complete' && method === 'POST') {
            const { key } = await getSecret('encryption-key');
            const { token } = parseFormBody(event.body);
            const { caseRef, action } = decryptToken(token, key);
            await updateCrmTimeline(caseRef, `Action ${action} marked as complete`);
            await swapStatusImage(caseRef, action);
            return htmlResponse(200, '<h2>Action marked as complete!</h2>');
        }

        if (path === '/action-update' && method === 'POST') {
            const { key } = await getSecret('encryption-key');
            const { token, update } = parseFormBody(event.body);
            if (!update || update.length > 1000) return response(400, { error: 'Invalid update' });
            const { caseRef, action } = decryptToken(token, key);
            await updateCrmTimeline(caseRef, `Update on action ${action}: ${update}`);
            return htmlResponse(200, '<h2>Update submitted!</h2>');
        }

        return response(404, { error: 'Not found' });
    } catch (err) {
        console.error('Error:', err);
        return response(500, { error: 'Internal server error' });
    }
};

function response(statusCode, body) {
    return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function htmlResponse(statusCode, html) {
    return { statusCode, headers: { 'Content-Type': 'text/html' }, body: html };
}

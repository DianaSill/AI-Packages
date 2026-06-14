# Case Study: AI-Driven Family Support System

## Project Overview

**Challenge**: Families needing support often don't know where to start. Navigating available services is overwhelming, and frontline staff spend significant time on routine signposting.

**Solution**: An AI system that takes a family's circumstances, generates a personalised action plan with links to local services, creates a trackable case, and lets users report progress via email.

**Impact**: Faster support delivery, reduced staff workload for routine signposting, measurable outcomes via case tracking.

## Business Requirements

- Single entry point for families regardless of their combination of needs
- Personalised advice (not generic leaflets)
- No login required — accessible to anyone
- Trackable outcomes for the council
- Staff visibility without manual data entry
- Email optional (for anonymous submissions)

## Technical Challenges & Solutions

### Challenge 1: Secure Email Tracking Without Authentication

**Problem**: Users need to mark actions complete and submit updates via email links, but we can't require them to create an account or log in.

**Solution**:
- AES-256-GCM encrypted tokens containing case reference + action number
- Tokens embedded in email URLs — only someone with the email can access them
- GET shows confirmation page, POST performs the action (prevents accidental triggers from email link prefetching)
- Tokens are single-purpose — a completion token can't be used for updates

**Result**: Secure, frictionless interaction without authentication.

### Challenge 2: Email Status Images That Actually Update

**Problem**: Email clients aggressively cache images. Once a user opens the email, the status images (tick/cross) would never update even after completing an action.

**Solution**:
- `/status/{ref}/action-{n}.png` endpoint returns a 302 redirect (not the image itself)
- Redirect URL includes a cache-busting timestamp parameter
- Actual images stored in S3 per case, swapped from cross to tick on completion
- Email clients follow the redirect and get the fresh image

**Result**: Status images update correctly even in aggressive-caching email clients.

### Challenge 3: Cross-Account Email Delivery

**Problem**: SES was configured in a different AWS account. The Lambda function couldn't send emails directly.

**Solution**:
- Created an IAM role in the SES account with `ses:SendEmail` permission
- Lambda assumes the role via STS before sending
- Role ARN stored in Secrets Manager (not hardcoded)

**Result**: Clean separation of concerns — email infrastructure managed separately from application logic.

### Challenge 4: AI Response Quality

**Problem**: AI needed to return structured, actionable advice with real local service links — not generic platitudes.

**Solution**:
- Bedrock Claude with a carefully crafted system prompt
- Knowledge base of local services, eligibility criteria, and contact details
- Response parsed into discrete actions (not free-form text)
- Retry logic (2 attempts) for robustness

**Result**: Consistently useful, specific action plans with working links to real services.

### Challenge 5: CloudFront Path-Based Routing

**Problem**: Single domain needed to serve both the static form (S3) and the API (API Gateway).

**Solution**:
- Default behaviour (`/*`) routes to S3 origin
- API behaviour (`/api/*`) routes to API Gateway origin
- CloudFront Function on viewer-request strips `/api` prefix before forwarding
- No caching on API path, standard caching on static assets

**Result**: Clean URL structure with single SSL certificate and domain.

## Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| AES-256-GCM (not signed URLs) | Tokens need to hide the case reference, not just validate it |
| GET/POST pattern for actions | Prevents email prefetch bots from accidentally completing actions |
| Status images via redirect | Only reliable way to defeat email client image caching |
| Bedrock over external AI APIs | Data stays within AWS, no third-party data processing |
| Cross-account SES via role | Email infrastructure managed by a different team |
| CloudFront Function (not Lambda@Edge) | Simpler, cheaper, sufficient for prefix stripping |

## Results

- **Response time**: Action plan generated in 3-5 seconds
- **Case creation**: Fully automated, zero staff involvement
- **Email delivery**: Cross-account SES with DKIM verification
- **Tracking**: All user interactions visible in CRM timeline
- **Security**: Zero exposed case references in URLs (all encrypted)

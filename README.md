# AI Packages — Family Support System

An AI-driven case management system that generates personalised action plans for families needing support, with automated case creation and interactive email tracking.

**For the complete case study with detailed technical analysis, see [CASE_STUDY.md](CASE_STUDY.md)**

**⚠️ Note: This is a sanitized version for portfolio purposes. All sensitive data, URLs, and identifiers have been anonymized.**

## Overview

Families describe their circumstances via a web form. AI generates a tailored action plan (3-8 practical steps with links to local services). A case is created automatically in the council's CRM, and the user receives an email with encrypted interactive links to track progress.

## Architecture

```mermaid
%%{init: {'theme': 'dark', 'themeVariables': {'primaryColor': '#386193', 'primaryTextColor': '#fff', 'primaryBorderColor': '#5a8cc8', 'lineColor': '#5a8cc8', 'secondaryColor': '#1a1a2e', 'tertiaryColor': '#16213e', 'background': '#0d1117', 'mainBkg': '#0d1117', 'nodeBorder': '#5a8cc8'}, 'layout': 'elk'}}%%
flowchart TB
    User(["Family / Professional"])

    subgraph Frontend["Static Frontend"]
        eForm["eForm<br/>S3 + CloudFront"]
    end

    subgraph API["API Layer"]
        APIGW["API Gateway<br/>REST API"]
        Lambda["Lambda<br/>Node.js 22"]
    end

    subgraph AI["AI Generation"]
        Bedrock["Amazon Bedrock<br/>Claude"]
    end

    subgraph Integrations["Downstream Services"]
        CXM["CXM<br/>Case Creation"]
        SES["SES<br/>Cross-Account Email"]
        S3img["S3<br/>Status Images"]
    end

    subgraph Tracking["User Interactions (via email)"]
        Complete["Mark Complete"]
        Update["Submit Update"]
        Close["Close Case"]
    end

    User -->|"Submits form"| eForm
    eForm -->|"/api/*"| APIGW
    APIGW --> Lambda
    Lambda -->|"Generate plan"| Bedrock
    Lambda -->|"Create case"| CXM
    Lambda -->|"Send email"| SES
    Lambda -->|"Store images"| S3img
    Complete -->|"AES-256-GCM token"| Lambda
    Update -->|"AES-256-GCM token"| Lambda
    Close -->|"AES-256-GCM token"| Lambda
    Lambda -->|"Update timeline"| CXM

    style Frontend fill:#1a1a2e,stroke:#3498db,stroke-width:2px,color:#fff
    style API fill:#1a1a2e,stroke:#8b5cf6,stroke-width:3px,color:#fff
    style AI fill:#1a1a2e,stroke:#2ecc71,stroke-width:2px,color:#fff
    style Integrations fill:#1a1a2e,stroke:#f39c12,stroke-width:2px,color:#fff
    style Tracking fill:#1a1a2e,stroke:#e74c3c,stroke-width:2px,color:#fff
    style User fill:#386193,stroke:#5a8cc8,stroke-width:2px,color:#fff
    style eForm fill:#2c3e50,stroke:#3498db,stroke-width:2px,color:#fff
    style APIGW fill:#2c3e50,stroke:#8b5cf6,stroke-width:2px,color:#fff
    style Lambda fill:#2c3e50,stroke:#8b5cf6,stroke-width:2px,color:#fff
    style Bedrock fill:#2c3e50,stroke:#2ecc71,stroke-width:2px,color:#fff
    style CXM fill:#2c3e50,stroke:#f39c12,stroke-width:2px,color:#fff
    style SES fill:#2c3e50,stroke:#f39c12,stroke-width:2px,color:#fff
    style S3img fill:#2c3e50,stroke:#f39c12,stroke-width:2px,color:#fff
    style Complete fill:#2c3e50,stroke:#e74c3c,stroke-width:2px,color:#fff
    style Update fill:#2c3e50,stroke:#e74c3c,stroke-width:2px,color:#fff
    style Close fill:#2c3e50,stroke:#e74c3c,stroke-width:2px,color:#fff

    linkStyle 0 stroke:#3498db,stroke-width:2px
    linkStyle 1 stroke:#8b5cf6,stroke-width:2px
    linkStyle 2 stroke:#8b5cf6,stroke-width:2px
    linkStyle 3 stroke:#2ecc71,stroke-width:2px
    linkStyle 4 stroke:#f39c12,stroke-width:2px
    linkStyle 5 stroke:#f39c12,stroke-width:2px
    linkStyle 6 stroke:#f39c12,stroke-width:2px
    linkStyle 7 stroke:#e74c3c,stroke-width:2px
    linkStyle 8 stroke:#e74c3c,stroke-width:2px
    linkStyle 9 stroke:#e74c3c,stroke-width:2px
    linkStyle 10 stroke:#f39c12,stroke-width:2px
```

## Features

- **AI Action Plan Generation** — Bedrock Claude generates 3-10 tailored actions with relevant local service links
- **Automatic Case Creation** — Cases created in CRM via API with full field mapping
- **Encrypted Email Links** — AES-256-GCM tokens hide case references in URLs
- **Action Completion Tracking** — Users mark actions complete via email (GET/POST confirmation pattern)
- **Progress Updates** — Free-text updates submitted via email links, logged to case timeline
- **Case Closure** — Users can close their case when they've received enough support
- **Cross-Account Email** — SES delivery via assumed role in separate AWS account
- **Custom Domain** — CloudFront with path-based routing (`/api/*` → API Gateway, `/*` → S3)

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/call-ai` | Generate action plan from circumstances |
| POST | `/create-case` | Create CRM case + send email |
| GET/POST | `/action-complete` | Mark action as done |
| GET/POST | `/action-update` | Submit progress update |
| GET/POST | `/close-case` | Close the case |
| GET | `/status/{ref}/action-{n}.png` | Status image (tick/cross) with cache-busting |
| POST | `/webhook` | Receive CRM event notifications |

## Security

- **AES-256-GCM encryption** for all email link tokens
- **XSS protection** on all user inputs
- **SSRF protection** on webhook handler
- **Input validation** with length limits
- **UTF-8 form handling** for international characters
- **CORS restricted** to specific allowed origins

## Technology Stack

- **AWS Lambda** (Node.js 22)
- **Amazon Bedrock** (Claude) for AI generation
- **API Gateway** (REST API)
- **CloudFront** with custom domain + path-based routing
- **S3** for static eForm hosting + status images
- **SES** (cross-account via assumed role)
- **Secrets Manager** for API credentials + encryption keys
- **ACM** for SSL certificate
- **Route 53** for DNS

## Email Flow

1. User submits form → AI generates plan → Case created in CRM
2. Email sent with encrypted action links + status images
3. User clicks link → Confirmation page → POST → CRM timeline updated
4. Status images update from ✗ to ✓ as actions are completed
5. Staff see all activity in case timeline without manual data entry

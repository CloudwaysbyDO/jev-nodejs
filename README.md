# Agency Request Triage — Jev on Cloudways Node.js Hosting

A reference Node.js application that proves a simple point: **you can run an AI-powered application on [Cloudways Managed Node.js Hosting](https://www.cloudways.com/en/velocity.php), using [Jev](https://openrouter.ai/docs/guides/community/jev) — a structured decision model — through the OpenRouter API.**

To test that out, we built a small sample app with Node.js and Express: paste a messy client request, and Jev instantly returns a structured decision — category, priority, assigned team, and whether to escalate.

Clone it, add your OpenRouter API key, deploy to Cloudways, and you have a working AI decision layer in under 30 minutes.

---

## Overview

Digital agencies receive dozens of unstructured client requests every day:

> "The checkout on our WooCommerce website stopped working."
> "Can you change the button color?"
> "The website is down and we have a campaign launching in two hours."

Each message needs to be categorized, prioritized, assigned to a team, and — in some cases — escalated. Doing this manually is slow and inconsistent.

This application lets a user paste a client request and immediately receive a structured analysis:

| Field | Example output |
|---|---|
| **Category** | Technical Issue |
| **Priority** | Critical |
| **Assigned Team** | Developer |
| **Escalation** | Yes |
| **Overall Confidence** | 100% |

The decisions are made by **Jev**, a structured decision model that returns typed, probability-weighted answers — not generated prose. This is not a chatbot: the typed output plugs directly into application logic. `priority === 'critical'` is something your code can branch on. A paragraph of generated text is not.

---

## What is Jev?

[Jev](https://openrouter.ai/docs/guides/community/jev) is TypeSafe's first "System One" model. Instead of generating text, it evaluates application state against typed questions and returns structured answers with calibrated probabilities.

Jev answers three kinds of question:

| Primitive | What it answers | Returns |
|---|---|---|
| **Choice** | Which one of these options? | Selected option + probability per option + confidence |
| **Noul** | Does this condition hold? | Probability of yes (0–1) |
| **Score** | Where does this fall on a scale? | Probability-weighted position + confidence |

This app uses three **Choice** questions (category, priority, team) and one **Noul** question (escalate?).

Jev is available via OpenRouter. You do **not** need a TypeSafe account — an [OpenRouter API key](https://openrouter.ai/settings/keys) is all you need. Requests are billed per input token to your OpenRouter account; output tokens are free. A triage request in this app costs about **$0.00003** — every response includes a `usage.cost` field showing the exact amount.

> The Decisions API is in beta. See the [Jev model page](https://openrouter.ai/typesafe/jev-1.13) for current pricing, limits, and status.

---

## Technology stack

The app is intentionally minimal so the Jev integration stays front and center:

| Layer | Technology | Why |
|---|---|---|
| Runtime | Node.js 18+ | Native `fetch()` — no HTTP client dependency needed |
| Backend | [Express](https://expressjs.com) | The most widely known Node.js web framework — one file, ~150 lines |
| Frontend | Vanilla HTML / CSS / JavaScript | No build step, no framework, nothing to compile |
| AI | Jev via the OpenRouter Decisions API | Structured decisions instead of generated text |
| Config | dotenv | Environment-variable configuration |
| Hosting | [Cloudways Managed Node.js Hosting](https://www.cloudways.com/en/velocity.php) | Git-based deployments, managed nginx + PM2, environment variable panel |

**Total production dependencies: 2** (`express`, `dotenv`).

Express does three jobs here:

1. **Serves the static frontend** (`public/` folder)
2. **Exposes one API route** — `GET /analyze` — which validates input, calls Jev, and returns clean JSON
3. **Keeps the API key server-side** — the browser never sees it

---

## Architecture

```
           User
             │
             ▼
   ┌─────────────────────┐
   │  Browser            │
   │  HTML + CSS + JS    │
   └────────┬────────────┘
            │  GET /analyze?message=...
            ▼
   ┌─────────────────────┐
   │  Node.js + Express  │  ← hosted on Cloudways
   │  src/server.js      │     (nginx + PM2, managed)
   └────────┬────────────┘
            │  POST /api/alpha/decisions
            │  Authorization: Bearer OPENROUTER_API_KEY
            ▼
   ┌──────────────────────┐
   │  Jev (OpenRouter)    │  ← external API
   │  ~typesafe/jev-latest│
   └────────┬─────────────┘
            │  Structured JSON
            │  { category, priority, team, escalate }
            ▼
   ┌─────────────────────┐
   │  Node.js + Express  │
   │  Parses + returns   │
   └────────┬────────────┘
            │  Clean JSON
            ▼
   ┌─────────────────────┐
   │  Browser            │
   │  Renders result     │
   └─────────────────────┘
```

**Cloudways hosts the Node.js application.** Jev is an external API. They are separate services.

```mermaid
flowchart TD
    A[User Browser] -->|GET /analyze| B[Express on Cloudways]
    B -->|POST /api/alpha/decisions| C[Jev via OpenRouter]
    C -->|typed answers| B
    B -->|clean JSON| A
```

---

## How the integration works

Everything lives in [`src/server.js`](src/server.js). The backend sends a `state` (the client message, with context) and four `questions` to Jev's Decisions API:

```
POST https://openrouter.ai/api/alpha/decisions
```

```json
{
  "model": "~typesafe/jev-latest",
  "state": "Client support request for a digital web agency: The checkout on our WooCommerce website stopped working...",
  "questions": {
    "category": {
      "type": "choice",
      "instructions": "What is the primary category of this client request?",
      "criteria": {
        "technical_issue": "Technical Issue - something on the site is broken or malfunctioning",
        "outage": "Outage - the site or a critical service is completely down",
        "design_change": "Design Change - visual or styling adjustments",
        "new_feature": "New Feature - new functionality to be built",
        "performance": "Performance - the site is slow or resource-heavy",
        "content_change": "Content Change - text, images, or copy updates",
        "other": "Other - anything that does not fit the above"
      }
    },
    "priority": {
      "type": "choice",
      "instructions": "What is the urgency of this client request? Consider business impact and deadlines.",
      "criteria": {
        "low": "Low - cosmetic or minor, no business impact",
        "medium": "Medium - should be handled soon but nothing is broken",
        "high": "High - significant impact or an approaching deadline",
        "critical": "Critical - revenue is being lost or a hard deadline is at risk"
      }
    },
    "team": {
      "type": "choice",
      "instructions": "Which team or role should handle this request?",
      "criteria": {
        "developer": "Developer - code, bugs, technical work",
        "designer": "Designer - visual design and styling",
        "content": "Content - copywriting and content updates",
        "project_manager": "Project Manager - planning, scoping, coordination"
      }
    },
    "escalate": {
      "type": "noul",
      "instructions": "Should this request be escalated to a senior team member? Escalate if critical, revenue-affecting, or deadline-driven."
    }
  }
}
```

> ⚠️ **Important format detail:** in a Choice question, `criteria` must be a **record (object)** mapping each option ID to a description — **not an array**. If you send an array of `{id, label}` objects, Jev rejects the request with `400: "Invalid input: expected record, received array"`. This is the single most common integration mistake.
>
> The descriptions also matter: richer criteria ("revenue is being lost or a hard deadline is at risk") give Jev more signal and produce noticeably better decisions than bare labels.

Jev returns typed answers keyed by question ID — no text to parse, no regex, no prompt-output cleanup:

```json
{
  "model": "typesafe/jev-1.13-20260917",
  "answers": {
    "category":  { "type": "choice", "choice": "technical_issue", "confidence": 0.99 },
    "priority":  { "type": "choice", "choice": "critical",        "confidence": 1.0  },
    "team":      { "type": "choice", "choice": "developer",       "confidence": 1.0  },
    "escalate":  { "type": "noul",   "noul": 0.94 }
  },
  "usage": { "input_tokens": 705, "output_tokens": 177, "cost": 0.00002961 },
  "provider": "TypeSafe"
}
```

The backend converts this into clean JSON for the frontend. One line captures the whole idea of the demo:

```js
escalate: { value: answers.escalate.noul >= 0.5, ... }
```

**An AI judgment used directly as application logic.** In a real system, this is where you'd trigger a Slack alert, assign a ticket, or page an on-call engineer.

The API key never leaves the server.

---

## Prerequisites

- **Node.js** 18 or later (`node -v` to check — native `fetch` requires 18+)
- **npm** (bundled with Node.js)
- **OpenRouter API key** — see Step 1 below
- **Git** and a **GitHub account**
- **Cloudways account** (only needed for deployment)

---

## Step 1 — Get an OpenRouter API key

Jev is accessed through OpenRouter. There is no separate TypeSafe signup.

1. Go to [openrouter.ai](https://openrouter.ai) and create a free account.
2. Open [openrouter.ai/settings/keys](https://openrouter.ai/settings/keys).
3. Click **Create Key**, give it a name (e.g. `agency-triage`), and copy the key — it starts with `sk-or-v1-`.
4. Add a small amount of credit at [openrouter.ai/settings/credits](https://openrouter.ai/settings/credits) — even $1 covers tens of thousands of triage requests.

> 🔒 This key must never appear in frontend code, in Git, or in any file you commit. It lives in exactly two places: your local `.env` file (which is gitignored) and the Cloudways Environment Variables panel.

---

## Step 2 — Run locally

```bash
# Clone
git clone https://github.com/cloudways/cloudways-jev-nodejs-demo.git
cd cloudways-jev-nodejs-demo

# Install dependencies (express + dotenv)
npm install

# Create your environment file
cp .env.example .env
```

Open `.env` and set your key:

```
OPENROUTER_API_KEY=sk-or-v1-xxxxxxxxxxxxxxxxxxxxxxxx
PORT=3000
```

> **Never commit `.env`.** It is already in `.gitignore`.

Start the server:

```bash
npm start
```

You should see:

```
Running on 0.0.0.0:3000
API key set: true
```

Open [http://localhost:3000](http://localhost:3000), click one of the example chips, and hit **Analyze Request**.

You can also hit the API directly:

```bash
curl "http://localhost:3000/analyze?message=The%20checkout%20stopped%20working"
```

```json
{
  "result": {
    "category":  { "id": "technical_issue", "label": "Technical Issue", "confidence": 99 },
    "priority":  { "id": "critical", "label": "Critical", "confidence": 100 },
    "team":      { "id": "developer", "label": "Developer", "confidence": 100 },
    "escalate":  { "value": true, "probability": 94 },
    "overallConfidence": 100
  },
  "usage": { "input_tokens": 705, "output_tokens": 177, "cost": 0.00002961 }
}
```

---

## Step 3 — Deploy to Cloudways

The steps below reflect the Cloudways Node.js hosting interface as tested with this app. Field names may evolve — check the [Cloudways documentation](https://support.cloudways.com) if something looks different.

### 3.1 Push this repo to your GitHub

Fork this repository, or create your own repo and push the code. A **private repo works fine** — Cloudways connects to it via GitHub authorization.

### 3.2 Create a Node.js application on Cloudways

1. Log in at [unified.cloudways.com](https://unified.cloudways.com).
2. Dashboard, on the left side bar, click on **Velocity**. Then Click **Add Server**. Here you need to chose the plan and click **Continue**
<img width="1905" height="902" alt="image" src="https://github.com/user-attachments/assets/95369bfa-3429-4ebe-b3a5-849f7b718259" /> 
3. Name the server and select the region where you want to deploy the server.
4. Now Click **Continue**. 
<img width="1670" height="727" alt="image" src="https://github.com/user-attachments/assets/86f20614-5f00-4159-bf30-8f7171a0d907" />
5. Your server will be deployed in few minutes with NodeJS application.

### 3.3 Connect your GitHub repository

1. Open your application → You can connect it with **GitHub**, **GitLab** and **Bitbucket**
2. Connect your GitHub account and select your repository.
3. Set the branch to **`main`**.
4. Enable **Auto-deployment** — every push to `main` will then deploy automatically. Click **Continue.**
<img width="1060" height="667" alt="image" src="https://github.com/user-attachments/assets/1b8049da-797e-4c86-874a-3adcd8b905c5" />

### 3.4 Configure the build settings

Go to **Deployment Management → Settings** and set:

| Field | Value |
|---|---|
| Framework Preset | `Express` |
| Branch | `main` |
| Node version | `18` or newer |
| Root Directory | `./` |
| Package Manager | `npm` |
| **Entry File** | **`src/server.js`** |

Click **Save & Redeploy**.

> ⚠️ **Entry File is the setting that trips people up.** The default value is `npm run start`, but this field expects a **file path**. Set it to `src/server.js`.

### 3.5 Add your environment variable

1. In the left sidebar, open **Environment Variables**.
2. Click **+ Add Variable** and add exactly one variable:

| Key | Value |
|---|---|
| `OPENROUTER_API_KEY` | `sk-or-v1-...` (your key) |

3. Save.

> ⚠️ **Do not add a `PORT` variable on Cloudways.** The platform manages the port itself and injects it into the process. The app reads `process.env.PORT || 3000`, which works in both environments. Setting `PORT` manually can conflict with the platform's webserver configuration.

### 3.6 Deploy and verify

1. Go to **Deployment Management → Deployments** and click **Redeploy** (or just push to `main` if auto-deploy is on).
2. Wait for the ✅ **Success** status. The build log should end with:

```
[info] Application started with PM2 (process 'node-app', port 3000) and enabled on boot.
Status : SUCCESS
```

3. Verify the app is alive by opening the health endpoint in your browser:

```
https://your-app-url.cloudwaysnodeapps.com/health
```

You should see: `{"ok":true}`

4. Open the app URL itself, click an example chip, and hit **Analyze Request**. If you see the result cards, the full stack is working:

```
Browser → Express on Cloudways → Jev on OpenRouter → Express → Browser
```

---
Here you can see the sample app that we built 
<img width="943" height="781" alt="image" src="https://github.com/user-attachments/assets/4da542bf-17a7-44e9-948d-b4e8952eb23c" />


## Step 4 — Test the application

Click each example chip, or paste your own client messages. Expected behavior:

| Test message | Category | Priority | Team | Escalate |
|---|---|---|---|---|
| "The checkout on our WooCommerce website stopped working. Customers can't complete their orders." | Technical Issue | Critical | Developer | **Yes** |
| "The client's website is completely down and they have a campaign launching in two hours." | Outage | Critical | Developer | **Yes** |
| "Can you change the button color on the homepage from blue to green?" | Design Change | Low | Designer | No |
| "The client wants us to add a booking form to the website." | New Feature | Medium | Developer / PM | No |
| "Several pages take more than 10 seconds to load." | Performance | High | Developer | Varies |

Also worth testing:

- **Empty input** → the Analyze button simply refocuses the textarea
- **A message over 4,000 characters** → friendly "message too long" error
- **API-level testing** → `GET /analyze?message=...` returns raw JSON; `GET /health` confirms the process is up

---
Here you can see the result based on the decision made by Jev
<img width="946" height="1470" alt="Agency Triage App" src="https://github.com/user-attachments/assets/aa42bf58-d593-4b11-9d75-223d9da8d40e" />

## Project structure

```
cloudways-jev-nodejs-demo/
│
├── public/
│   ├── index.html      ← Single-page frontend
│   ├── styles.css      ← All styles (dark SaaS-style dashboard)
│   └── app.js          ← Frontend logic (fetch, render)
│
├── src/
│   └── server.js       ← Express server + entire Jev integration
│
├── .env.example        ← Environment variable template
├── .gitignore          ← Excludes .env and node_modules
├── package.json        ← 2 dependencies: express, dotenv
├── LICENSE
└── README.md
```

The entire integration — questions, API call, response parsing, error handling — is one readable file: [`src/server.js`](src/server.js).

---

## What this demo proves

1. **A Node.js/Express application runs on [Cloudways Managed Node.js Hosting](https://www.cloudways.com/en/velocity.php).**
2. **The application communicates with Jev through the OpenRouter Decisions API.**
3. **Jev turns unstructured text into structured, typed decisions.**
4. **Application code can branch on those decisions** — display them, route a ticket, trigger a workflow.
5. **Another developer can clone this repo, add an API key, deploy to Cloudways, and have it working**

---

## License

MIT — see [LICENSE](LICENSE).

---

## Links

- [Jev on OpenRouter](https://openrouter.ai/docs/guides/community/jev)
- [Decisions API reference](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request)
- [Jev model page + pricing](https://openrouter.ai/typesafe/jev-1.13)
- [TypeSafe documentation](https://docs.typesafe.ai)
- [Cloudways Managed Node.js Hosting](https://www.cloudways.com/en/velocity.php)
- [OpenRouter API keys](https://openrouter.ai/settings/keys)

---

*Built by [Danish Naseer](https://www.linkedin.com/in/hdanishnaseer/)*

'use strict';

require('dotenv').config();

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json());

// ─── Health check ─────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', port: PORT, timestamp: new Date().toISOString() });
});

// ─── Jev integration ──────────────────────────────────────────────────────────

const JEV_ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
const JEV_MODEL = '~typesafe/jev-latest';

function buildQuestions() {
  return {
    category: {
      type: 'choice',
      instructions:
        'What is the primary category of this client request? ' +
        'Pick the single most appropriate option.',
      options: [
        { id: 'technical_issue', label: 'Technical Issue' },
        { id: 'design_change', label: 'Design Change' },
        { id: 'content_change', label: 'Content Change' },
        { id: 'new_feature', label: 'New Feature' },
        { id: 'performance', label: 'Performance' },
        { id: 'outage', label: 'Outage' },
        { id: 'other', label: 'Other' },
      ],
    },
    priority: {
      type: 'choice',
      instructions:
        'What is the urgency of this client request? ' +
        "Consider impact on the client's business and any deadlines mentioned.",
      options: [
        { id: 'low', label: 'Low' },
        { id: 'medium', label: 'Medium' },
        { id: 'high', label: 'High' },
        { id: 'critical', label: 'Critical' },
      ],
    },
    team: {
      type: 'choice',
      instructions: 'Which team or role should handle this request?',
      options: [
        { id: 'developer', label: 'Developer' },
        { id: 'designer', label: 'Designer' },
        { id: 'content', label: 'Content' },
        { id: 'project_manager', label: 'Project Manager' },
      ],
    },
    escalate: {
      type: 'noul',
      instructions:
        'Should this request be escalated to a senior team member or manager? ' +
        'Escalate if the issue is critical, affects revenue, involves a deadline, ' +
        'or is outside the normal scope of the assigned team.',
    },
  };
}

function parseAnswers(answers) {
  const category = answers.category;
  const priority = answers.priority;
  const team = answers.team;
  const escalate = answers.escalate;

  return {
    category: {
      id: category.choice,
      label: labelFor(category.choice),
      confidence: pct(category.confidence),
    },
    priority: {
      id: priority.choice,
      label: labelFor(priority.choice),
      confidence: pct(priority.confidence),
    },
    team: {
      id: team.choice,
      label: labelFor(team.choice),
      confidence: pct(team.confidence),
    },
    escalate: {
      value: escalate.noul >= 0.5,
      probability: pct(escalate.noul),
    },
    overallConfidence: Math.round(
      ((category.confidence + priority.confidence + team.confidence) / 3) * 100
    ),
  };
}

function labelFor(id) {
  return id
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function pct(n) {
  return Math.round(n * 100);
}

// ─── API route (GET so nginx passes it through) ───────────────────────────────
// The message is sent as a query parameter: /api/analyze?message=...
// We also support POST for local development.

async function handleAnalyze(req, res) {
  const message = req.method === 'GET'
    ? (req.query.message || '').trim()
    : (req.body.message || '').trim();

  if (!message) {
    return res.status(400).json({ error: 'Request message is required.' });
  }

  if (message.length > 4000) {
    return res.status(400).json({ error: 'Request message is too long (max 4000 characters).' });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey === 'your_openrouter_api_key_here') {
    console.error('[server] OPENROUTER_API_KEY is not configured.');
    return res.status(500).json({
      error:
        'The server is not configured with an API key. ' +
        'Set OPENROUTER_API_KEY in your environment.',
    });
  }

  const state =
    'You are triaging a client support request for a digital web agency. ' +
    'The client has sent the following message:\n\n' +
    message;

  const questions = buildQuestions();

  let jevResponse;
  try {
    const response = await fetch(JEV_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: JEV_MODEL, state, questions }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[server] Jev API error ${response.status}:`, body);
      if (response.status === 401) {
        return res.status(500).json({ error: 'Invalid API key. Check your OPENROUTER_API_KEY.' });
      }
      if (response.status === 429) {
        return res.status(429).json({ error: 'Rate limit reached. Please wait a moment and try again.' });
      }
      return res.status(502).json({ error: 'The decision API returned an error. Please try again.' });
    }

    jevResponse = await response.json();
  } catch (err) {
    console.error('[server] Network error calling Jev:', err.message);
    return res.status(502).json({ error: 'Could not reach the decision API. Check your network connection.' });
  }

  try {
    const result = parseAnswers(jevResponse.answers);
    return res.json({ result, usage: jevResponse.usage ?? null });
  } catch (err) {
    console.error('[server] Failed to parse Jev response:', err.message, jevResponse);
    return res.status(502).json({ error: 'Unexpected response from the decision API.' });
  }
}

// Register both GET and POST so it works on Cloudways (GET) and locally (POST)
app.get('/triage', handleAnalyze);
app.post('/triage', handleAnalyze);

// ─── Static files ─────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Agency Request Triage running on 0.0.0.0:${PORT}`);
  console.log(`API key configured: ${!!process.env.OPENROUTER_API_KEY}`);
});

'use strict';

require('dotenv').config();

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// ─── Jev integration ──────────────────────────────────────────────────────────

const JEV_ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
const JEV_MODEL = '~typesafe/jev-latest';

/**
 * Build the Jev questions for agency request triage.
 *
 * Jev supports three question primitives:
 *   Choice  — pick one option from a list you define
 *   Score   — place state on an ordered scale
 *   Noul    — calibrated yes/no probability (0–1)
 */
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
        'Consider impact on the client\'s business and any deadlines mentioned.',
      options: [
        { id: 'low', label: 'Low' },
        { id: 'medium', label: 'Medium' },
        { id: 'high', label: 'High' },
        { id: 'critical', label: 'Critical' },
      ],
    },

    team: {
      type: 'choice',
      instructions:
        'Which team or role should handle this request?',
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

/**
 * Parse the raw Jev answers into a clean object the frontend can render.
 * Jev returns typed answers keyed by question ID.
 */
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
    // Overall confidence: average of the three Choice confidences
    overallConfidence: Math.round(
      (category.confidence + priority.confidence + team.confidence) / 3 * 100
    ),
  };
}

/** Convert a snake_case id to a Title Case label as a fallback. */
function labelFor(id) {
  return id
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** Convert a 0–1 probability to an integer percentage. */
function pct(n) {
  return Math.round(n * 100);
}

// ─── API route ────────────────────────────────────────────────────────────────

app.post('/api/analyze', async (req, res) => {
  const { message } = req.body;

  // Validate input
  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'Request message is required.' });
  }

  if (message.trim().length > 4000) {
    return res.status(400).json({ error: 'Request message is too long (max 4000 characters).' });
  }

  // Validate API key presence (never expose the key itself)
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey === 'your_openrouter_api_key_here') {
    console.error('[server] OPENROUTER_API_KEY is not configured.');
    return res.status(500).json({
      error:
        'The server is not configured with an API key. ' +
        'Set OPENROUTER_API_KEY in your environment.',
    });
  }

  // Build the Jev state.
  // We give Jev clear context about the role it's evaluating for.
  const state =
    'You are triaging a client support request for a digital web agency. ' +
    'The client has sent the following message:\n\n' +
    message.trim();

  const questions = buildQuestions();

  // Call the Jev Decisions API
  let jevResponse;
  try {
    const response = await fetch(JEV_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: JEV_MODEL,
        state,
        questions,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      console.error(`[server] Jev API error ${response.status}:`, body);

      // Surface a friendly error without leaking API internals
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

  // Parse and return the structured result
  try {
    const result = parseAnswers(jevResponse.answers);
    return res.json({
      result,
      usage: jevResponse.usage ?? null,
    });
  } catch (err) {
    console.error('[server] Failed to parse Jev response:', err.message, jevResponse);
    return res.status(502).json({ error: 'Unexpected response from the decision API.' });
  }
});

// ─── Catch-all: serve the SPA ─────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Agency Request Triage running at http://localhost:${PORT}`);
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn('[server] Warning: OPENROUTER_API_KEY is not set. Set it in .env to enable Jev.');
  }
});

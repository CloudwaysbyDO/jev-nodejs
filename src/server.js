'use strict';

require('dotenv').config();

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true, port: PORT }));

const JEV_ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
const JEV_MODEL    = '~typesafe/jev-latest';

// Jev's Choice questions take `criteria` as a record: { id: description }
function buildQuestions() {
  return {
    category: {
      type: 'choice',
      instructions: 'What is the primary category of this client request?',
      criteria: {
        technical_issue: 'Technical Issue - something on the site is broken or malfunctioning',
        design_change:   'Design Change - visual or styling adjustments',
        content_change:  'Content Change - text, images, or copy updates',
        new_feature:     'New Feature - new functionality to be built',
        performance:     'Performance - the site is slow or resource-heavy',
        outage:          'Outage - the site or a critical service is completely down',
        other:           'Other - anything that does not fit the above',
      },
    },
    priority: {
      type: 'choice',
      instructions: 'What is the urgency of this client request? Consider business impact and deadlines.',
      criteria: {
        low:      'Low - cosmetic or minor, no business impact',
        medium:   'Medium - should be handled soon but nothing is broken',
        high:     'High - significant impact or an approaching deadline',
        critical: 'Critical - revenue is being lost or a hard deadline is at risk',
      },
    },
    team: {
      type: 'choice',
      instructions: 'Which team or role should handle this request?',
      criteria: {
        developer:       'Developer - code, bugs, technical work',
        designer:        'Designer - visual design and styling',
        content:         'Content - copywriting and content updates',
        project_manager: 'Project Manager - planning, scoping, coordination',
      },
    },
    escalate: {
      type: 'noul',
      instructions: 'Should this request be escalated to a senior team member? Escalate if critical, revenue-affecting, or deadline-driven.',
    },
  };
}

const LABELS = {
  technical_issue: 'Technical Issue',
  design_change:   'Design Change',
  content_change:  'Content Change',
  new_feature:     'New Feature',
  performance:     'Performance',
  outage:          'Outage',
  other:           'Other',
  low:      'Low',
  medium:   'Medium',
  high:     'High',
  critical: 'Critical',
  developer:       'Developer',
  designer:        'Designer',
  content:         'Content',
  project_manager: 'Project Manager',
};

function parseAnswers(answers) {
  const c   = answers.category;
  const p   = answers.priority;
  const t   = answers.team;
  const e   = answers.escalate;
  const pct = n  => Math.round(n * 100);
  const lbl = id => LABELS[id] || id;
  return {
    category: { id: c.choice, label: lbl(c.choice), confidence: pct(c.confidence) },
    priority: { id: p.choice, label: lbl(p.choice), confidence: pct(p.confidence) },
    team:     { id: t.choice, label: lbl(t.choice), confidence: pct(t.confidence) },
    escalate: { value: e.noul >= 0.5, probability: pct(e.noul) },
    overallConfidence: Math.round(((c.confidence + p.confidence + t.confidence) / 3) * 100),
  };
}

app.get('/analyzetest', async (req, res) => {
  try {
    const message = (req.query.message || '').trim();
    if (!message) return res.status(400).json({ error: 'Request message is required.' });
    if (message.length > 4000) return res.status(400).json({ error: 'Message too long.' });

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'API key not configured.' });

    const response = await fetch(JEV_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model:     JEV_MODEL,
        state:     'Client support request for a digital web agency: ' + message,
        questions: buildQuestions(),
      }),
    });

    const text = await response.text();

    if (!response.ok) {
      console.error('[jev] error', response.status, text.slice(0, 300));
      if (response.status === 401) return res.status(401).json({ error: 'Invalid API key.' });
      if (response.status === 429) return res.status(429).json({ error: 'Rate limit reached. Try again shortly.' });
      return res.status(502).json({ error: 'Jev error ' + response.status + ': ' + text.slice(0, 200) });
    }

    const json = JSON.parse(text);
    return res.json({ result: parseAnswers(json.answers), usage: json.usage ?? null });

  } catch (err) {
    console.error('[jev] exception:', err.message);
    return res.status(502).json({ error: err.message });
  }
});

app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('Running on 0.0.0.0:' + PORT);
  console.log('API key set: ' + !!process.env.OPENROUTER_API_KEY);
});

'use strict';

require('dotenv').config();

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true, port: PORT }));

const JEV_ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
const JEV_MODEL = '~typesafe/jev-latest';

function buildQuestions() {
  return {
    category: {
      type: 'choice',
      instructions: 'What is the primary category of this client request?',
      criteria: [
        { id: 'technical_issue', label: 'Technical Issue' },
        { id: 'design_change',   label: 'Design Change'   },
        { id: 'content_change',  label: 'Content Change'  },
        { id: 'new_feature',     label: 'New Feature'     },
        { id: 'performance',     label: 'Performance'     },
        { id: 'outage',          label: 'Outage'          },
        { id: 'other',           label: 'Other'           },
      ],
    },
    priority: {
      type: 'choice',
      instructions: 'What is the urgency of this client request?',
      criteria: [
        { id: 'low',      label: 'Low'      },
        { id: 'medium',   label: 'Medium'   },
        { id: 'high',     label: 'High'     },
        { id: 'critical', label: 'Critical' },
      ],
    },
    team: {
      type: 'choice',
      instructions: 'Which team or role should handle this request?',
      criteria: [
        { id: 'developer',       label: 'Developer'       },
        { id: 'designer',        label: 'Designer'        },
        { id: 'content',         label: 'Content'         },
        { id: 'project_manager', label: 'Project Manager' },
      ],
    },
    escalate: {
      type: 'noul',
      instructions: 'Should this request be escalated to a senior team member?',
    },
  };
}

function parseAnswers(answers) {
  const c = answers.category;
  const p = answers.priority;
  const t = answers.team;
  const e = answers.escalate;
  const pct   = n  => Math.round(n * 100);
  const label  = id => id.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  return {
    category:  { id: c.choice, label: label(c.choice), confidence: pct(c.confidence) },
    priority:  { id: p.choice, label: label(p.choice), confidence: pct(p.confidence) },
    team:      { id: t.choice, label: label(t.choice), confidence: pct(t.confidence) },
    escalate:  { value: e.noul >= 0.5, probability: pct(e.noul) },
    overallConfidence: Math.round(((c.confidence + p.confidence + t.confidence) / 3) * 100),
  };
}

async function handleAnalyze(req, res) {
  const message = (req.query.message || (req.body && req.body.message) || '').trim();
  if (!message) return res.status(400).json({ error: 'Request message is required.' });
  if (message.length > 4000) return res.status(400).json({ error: 'Message too long.' });

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey === 'your_openrouter_api_key_here') {
    return res.status(500).json({ error: 'API key not configured.' });
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 28000);

    const response = await fetch(JEV_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
        'HTTP-Referer':  'https://cloudways.com',
        'X-Title':       'Agency Request Triage',
      },
      body: JSON.stringify({
        model: JEV_MODEL,
        state: 'You are triaging a client support request for a digital web agency.\n\nClient message:\n\n' + message,
        questions: buildQuestions(),
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    const text = await response.text();
    console.log('[jev] status:', response.status);

    if (!response.ok) {
      if (response.status === 401) return res.status(401).json({ error: 'Invalid API key.' });
      if (response.status === 429) return res.status(429).json({ error: 'Rate limit. Try again shortly.' });
      return res.status(502).json({ error: `Jev error ${response.status}: ${text.slice(0, 200)}` });
    }

    const json = JSON.parse(text);
    return res.json({ result: parseAnswers(json.answers), usage: json.usage ?? null });

  } catch (err) {
    if (err.name === 'AbortError') return res.status(504).json({ error: 'Request timed out.' });
    console.error('[jev] error:', err.message);
    return res.status(502).json({ error: err.message });
  }
}

app.get('/analyze',  handleAnalyze);
app.post('/analyze', handleAnalyze);

app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Running on 0.0.0.0:${PORT}`);
  console.log(`API key set: ${!!process.env.OPENROUTER_API_KEY}`);
});

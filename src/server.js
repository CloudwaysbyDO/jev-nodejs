'use strict';
 
require('dotenv').config();
 
const express = require('express');
const path = require('path');
 
const app = express();
const PORT = process.env.PORT || 3000;
 
app.use(express.json());
 
app.get('/health', (req, res) => {
  res.json({ status: 'ok', port: PORT, key: !!process.env.OPENROUTER_API_KEY });
});
 
const JEV_ENDPOINT = 'https://openrouter.ai/api/alpha/decisions';
const JEV_MODEL = '~typesafe/jev-latest';
 
function buildQuestions() {
  return {
    category: {
      type: 'choice',
      instructions: 'What is the primary category of this client request?',
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
      instructions: 'What is the urgency of this client request?',
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
      instructions: 'Should this request be escalated to a senior team member?',
    },
  };
}
 
function parseAnswers(answers) {
  const category = answers.category;
  const priority = answers.priority;
  const team = answers.team;
  const escalate = answers.escalate;
  return {
    category: { id: category.choice, label: labelFor(category.choice), confidence: pct(category.confidence) },
    priority: { id: priority.choice, label: labelFor(priority.choice), confidence: pct(priority.confidence) },
    team: { id: team.choice, label: labelFor(team.choice), confidence: pct(team.confidence) },
    escalate: { value: escalate.noul >= 0.5, probability: pct(escalate.noul) },
    overallConfidence: Math.round(((category.confidence + priority.confidence + team.confidence) / 3) * 100),
  };
}
 
function labelFor(id) {
  return id.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
 
function pct(n) {
  return Math.round(n * 100);
}
 
async function handleAnalyze(req, res) {
  const message = req.method === 'GET'
    ? (req.query.message || '').trim()
    : (req.body.message || '').trim();
 
  if (!message) {
    return res.status(400).json({ error: 'Request message is required.' });
  }
 
  if (message.length > 4000) {
    return res.status(400).json({ error: 'Request message is too long.' });
  }
 
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey || apiKey === 'your_openrouter_api_key_here') {
    return res.status(500).json({ error: 'API key not configured.' });
  }
 
  const state =
    'You are triaging a client support request for a digital web agency. ' +
    'The client sent:\n\n' + message;
 
  try {
    // Use AbortController to set a 25-second timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
 
    const response = await fetch(JEV_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://cloudways.com',
        'X-Title': 'Agency Request Triage',
      },
      body: JSON.stringify({
        model: JEV_MODEL,
        state,
        questions: buildQuestions(),
      }),
      signal: controller.signal,
    });
 
    clearTimeout(timeout);
 
    const rawText = await response.text();
    console.log('[server] Jev status:', response.status);
    console.log('[server] Jev response:', rawText.slice(0, 500));
 
    if (!response.ok) {
      if (response.status === 401) return res.status(500).json({ error: 'Invalid API key.' });
      if (response.status === 429) return res.status(429).json({ error: 'Rate limit reached. Try again shortly.' });
      return res.status(502).json({ error: `Jev API error ${response.status}: ${rawText.slice(0, 200)}` });
    }
 
    const jevResponse = JSON.parse(rawText);
    const result = parseAnswers(jevResponse.answers);
    return res.json({ result, usage: jevResponse.usage ?? null });
 
  } catch (err) {
    if (err.name === 'AbortError') {
      console.error('[server] Jev request timed out');
      return res.status(504).json({ error: 'Request timed out. Jev took too long to respond.' });
    }
    console.error('[server] Error:', err.message);
    return res.status(502).json({ error: 'Could not reach Jev: ' + err.message });
  }
}
 
app.get('/triage', handleAnalyze);
app.post('/triage', handleAnalyze);
 
app.use(express.static(path.join(__dirname, '..', 'public')));
 
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});
 
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Agency Request Triage running on 0.0.0.0:${PORT}`);
  console.log(`API key configured: ${!!process.env.OPENROUTER_API_KEY}`);
});
 

'use strict';

const EXAMPLES = {
  checkout:    "The checkout on our WooCommerce website stopped working. Customers can't complete their orders and we're losing sales.",
  outage:      "The client's website is completely down and they have a campaign launching in two hours. We need to fix this immediately.",
  design:      "Can you change the button color on the homepage from blue to green? The client prefers green to match their new branding.",
  feature:     "The client wants us to add a booking form to the website so customers can schedule consultations directly online.",
  performance: "The website has become very slow and several pages take more than 10 seconds to load. Clients are complaining.",
};

const textarea         = document.getElementById('request-input');
const charCount        = document.getElementById('char-count');
const analyzeBtn       = document.getElementById('analyze-btn');
const retryBtn         = document.getElementById('retry-btn');
const exampleList      = document.getElementById('example-list');
const stateLoading     = document.getElementById('state-loading');
const stateError       = document.getElementById('state-error');
const stateResult      = document.getElementById('state-result');
const errorMessage     = document.getElementById('error-message');
const resCategory      = document.getElementById('res-category');
const resCategoryConf  = document.getElementById('res-category-conf');
const resPriority      = document.getElementById('res-priority');
const resPriorityConf  = document.getElementById('res-priority-conf');
const resPriorityBadge = document.getElementById('res-priority-badge');
const resTeam          = document.getElementById('res-team');
const resTeamConf      = document.getElementById('res-team-conf');
const resEscalate      = document.getElementById('res-escalate');
const resEscalateConf  = document.getElementById('res-escalate-conf');
const resConfidence    = document.getElementById('res-confidence');
const resConfidenceFill= document.getElementById('res-confidence-fill');

function showState(name) {
  stateLoading.classList.add('hidden');
  stateError.classList.add('hidden');
  stateResult.classList.add('hidden');
  if (name === 'loading') stateLoading.classList.remove('hidden');
  if (name === 'error')   stateError.classList.remove('hidden');
  if (name === 'result')  stateResult.classList.remove('hidden');
}

textarea.addEventListener('input', () => {
  charCount.textContent = `${textarea.value.length} / 4000`;
});

exampleList.addEventListener('click', (e) => {
  const chip = e.target.closest('.example-chip');
  if (!chip) return;
  const key = chip.dataset.example;
  if (EXAMPLES[key]) {
    textarea.value = EXAMPLES[key];
    charCount.textContent = `${textarea.value.length} / 4000`;
    showState(null);
    textarea.focus();
  }
});

analyzeBtn.addEventListener('click', analyze);
retryBtn.addEventListener('click', () => showState(null));
textarea.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') analyze();
});

async function analyze() {
  const message = textarea.value.trim();
  if (!message) { textarea.focus(); return; }

  analyzeBtn.disabled = true;
  showState('loading');

  try {
    const url = '/analyzetest?message=' + encodeURIComponent(message);
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    renderResult(data.result);
    showState('result');
  } catch (err) {
    errorMessage.textContent = err.message || 'Something went wrong. Please try again.';
    showState('error');
  } finally {
    analyzeBtn.disabled = false;
  }
}

function renderResult(r) {
  resCategory.textContent      = r.category.label;
  resCategoryConf.textContent  = `${r.category.confidence}% confidence`;
  resPriority.textContent      = r.priority.label;
  resPriorityConf.textContent  = `${r.priority.confidence}% confidence`;
  resPriorityBadge.className   = `priority-badge ${r.priority.id}`;
  resTeam.textContent          = r.team.label;
  resTeamConf.textContent      = `${r.team.confidence}% confidence`;
  resEscalate.textContent      = r.escalate.value ? 'Yes' : 'No';
  resEscalateConf.textContent  = `${r.escalate.probability}% probability`;
  resConfidence.textContent    = `${r.overallConfidence}%`;
  resConfidenceFill.style.width = '0%';
  requestAnimationFrame(() => setTimeout(() => {
    resConfidenceFill.style.width = `${r.overallConfidence}%`;
  }, 100));
}

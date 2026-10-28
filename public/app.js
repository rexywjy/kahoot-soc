import { captureLeaderboard, presentLeaderboard, resetCelebrations, stopCelebration } from './celebration.js';
import { XLSX_TYPE, readSpreadsheet, rowsToQuestions, templateWorkbook } from './import.js';

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icons = { bolt: 'ϟ', grid: '▦', play: '▶', plus: '+', arrow: '↗', clock: '◷', trophy: '♜', back: '←', check: '✓', close: '×', copy: '▣', settings: '⚙', people: '☺', spark: '✦' };
const icon = name => `<span class="icon" aria-hidden="true">${icons[name] || name}</span>`;
const colors = ['violet', 'pink', 'cyan', 'orange'];
const avatar = player => `<span class="avatar player-avatar" aria-hidden="true"><svg viewBox="0 0 40 40"><rect width="40" height="40" rx="11" fill="hsl(${Number(player.appearance.hue)} 75% 82%)"/></svg><span>${escape(player.appearance.icon)}</span></span>`;
let admin = false, quizzes = [], rooms = [], draft = null, activeQuestion = 0, stream = null, live = null, selected = [], liveKey = '', clockOffset = 0, sound = false, audioContext = null, navigating = 0;
const storage = { get(key) { try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; } }, set(key, value) { try { sessionStorage.setItem(key, JSON.stringify(value)); } catch {} } };
const draftStorage = { get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }, set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} }, remove(key) { try { localStorage.removeItem(key); } catch {} } };
let keepLeaderboard = draftStorage.get('soc-quiz-keep-leaderboard') === true;
let controlsHidden = false;
let roundProgressAnimation = null, roundProgressKey = '', renderedPanel = '';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let draftKey = '';
let pendingMaxPlayers = null, answering = false, pendingSkipRestPin = null;
// Single-choice answers submit on the first tap; multiple-answer questions
// wait for "Lock it in". Shows the locked screen without waiting for the
// server's broadcast so a second tap can't sneak in.
async function submitAnswer() {
  const pin = live.pin, index = live.index, choices = selected;
  await api(`/rooms/${pin}/answer`, { method: 'POST', token: storage.get('room:' + pin)?.token, data: { choices, index } });
  if (live?.pin === pin && live.index === index && live.phase === 'question' && !live.submitted) { live = { ...live, submitted: true, choices, answered: live.answered + 1 }; renderLive(false); }
}
const settingsOf = q => ({ duration: q.duration, points: q.points, negative: q.negative, penalty: q.penalty ?? q.points, penaltyMatchesPoints: q.penaltyMatchesPoints === true });
const penaltyAmount = q => q.penaltyMatchesPoints ? q.points : q.penalty ?? q.points;
function refreshPenaltyFields() {
  for (const [prefix, settings] of [['', draft.questions[activeQuestion]], ['all-', draft.defaults]]) {
    const input = $(`#${prefix}penalty`), match = $(`#${prefix}penalty-match`);
    const wasDisabled = input.disabled;
    input.disabled = !settings.negative || settings.penaltyMatchesPoints;
    if (settings.penaltyMatchesPoints || wasDisabled) input.value = penaltyAmount(settings);
    match.disabled = !settings.negative;
  }
}
function bulkSettings() {
  const d = draft.defaults;
  return `<section class="panel bulk-settings"><div class="bulk-heading"><div><h2>One setup. Every question.</h2><p>Defaults for new questions. Apply to all to update existing questions, too.</p></div><button class="button outline small" data-action="apply-settings">Apply to all questions</button></div><div class="bulk-fields"><div><label for="all-duration">Time limit (seconds)</label><input id="all-duration" type="number" min="5" max="300" required value="${d.duration}" aria-describedby="all-duration-note"><p id="all-duration-note" class="duration-note">Answer time only. Each question is shown for 1.5 seconds before choices appear; this preview does not use the answer time.</p></div><div><label for="all-points">Correct answer points</label><input id="all-points" type="number" min="0" max="10000" required value="${d.points}"></div><div><label for="all-penalty">Wrong-answer deduction</label><input id="all-penalty" type="number" min="0" max="10000" required value="${penaltyAmount(d)}" ${d.negative && !d.penaltyMatchesPoints ? '' : 'disabled'}></div><div><label for="quiz-max-players">Default player limit</label><input id="quiz-max-players" type="number" min="1" max="200" required value="${draft.maxPlayers}"></div></div><label class="bulk-toggle"><input id="all-negative" type="checkbox" ${d.negative ? 'checked' : ''}> Deduct points for wrong or missing answers</label><label class="bulk-toggle"><input id="all-penalty-match" type="checkbox" ${d.penaltyMatchesPoints ? 'checked' : ''} ${d.negative ? '' : 'disabled'}> Match deduction to correct-answer points</label><label class="bulk-toggle"><input id="quiz-shuffle" type="checkbox" ${draft.shuffleQuestions ? 'checked' : ''}> Shuffle question order every time this quiz is hosted</label><p class="settings-note">Matched deductions follow the base points, excluding speed bonuses. You can still customize individual questions. With deductions on, not answering costs the same as a wrong answer. Hosts can change the player limit and question shuffling in the lobby.</p></section>`;
}
function speedSettings() {
  const bonus = draft.speedBonus;
  return `<section class="panel speed-settings"><div class="speed-heading"><span class="speed-symbol" aria-hidden="true">⚡</span><div><h2>A little extra for quick thinking.</h2><p>Optional speed bonus · applies to every question in this quiz</p></div><label class="speed-toggle"><input id="speed-enabled" type="checkbox" ${bonus.enabled ? 'checked' : ''}> Enable speed bonus</label></div><div class="speed-options"><div><label for="speed-percent">Maximum bonus (% of question points)</label><input id="speed-percent" type="number" min="1" max="100" required value="${bonus.maxPercent}" ${bonus.enabled ? '' : 'disabled'}></div><p id="speed-example">${speedExample()}</p></div><p class="settings-note">Correct answers earn full base points plus a bonus that decreases with time remaining. Wrong and missing answers only use their configured deduction. Timing uses arrival at the server, so network delays can reduce the bonus. Leave this off for equal points on correct answers.</p></section>`;
}
function importSettings() {
  return `<section class="panel import-settings"><div><h2>Import questions from Excel</h2><p>Columns: <b>Soal</b> · <b>A</b> · <b>B</b> · <b>C</b> · <b>D</b> · <b>Jawaban Benar</b> (for example <b>A</b>, or <b>A,B</b> for multiple answers). Use 2–6 options (A–F). Imported questions use the defaults above.</p></div><div class="import-actions"><button class="button outline small" data-action="download-template">Download template</button><button class="button primary small" data-action="import">Import .xlsx / .csv</button><input id="import-file" type="file" accept=".xlsx,.csv,${XLSX_TYPE},text/csv" hidden></div></section>`;
}
async function importQuestions(file) {
  if (!file || !draft) return;
  syncDraft();
  try {
    const { questions, errors } = rowsToQuestions(await readSpreadsheet(file), settingsOf(draft.defaults));
    if (errors.length) { await choose('Some rows need fixing', `<p>Nothing was imported. Fix these rows in your file and import again.</p><ul class="import-errors">${errors.slice(0, 20).map(e => `<li>${escape(e)}</li>`).join('')}${errors.length > 20 ? `<li>…and ${errors.length - 20} more.</li>` : ''}</ul>`, [['ok', 'OK', 'primary']], '📝'); return; }
    const blank = draft.questions.every(q => !q.text.trim() && q.options.every(o => !o.trim()));
    const mode = blank ? 'replace' : await choose(`Import ${questions.length} question${questions.length === 1 ? '' : 's'}?`, `<p>This quiz already has ${draft.questions.length} question${draft.questions.length === 1 ? '' : 's'}. Add the imported questions to the end, or replace everything?</p>`, [['cancel', 'Cancel'], ['append', 'Add to the end'], ['replace', 'Replace all', 'primary']]);
    if (!['append', 'replace'].includes(mode)) return;
    const total = (mode === 'append' ? draft.questions.length : 0) + questions.length;
    if (total > 100) throw new Error(`A quiz can have up to 100 questions. This import would make ${total}.`);
    activeQuestion = mode === 'append' ? draft.questions.length : 0;
    draft.questions = mode === 'append' ? [...draft.questions, ...questions] : questions;
    draftStorage.set(draftKey, draft); editor(); toast(`${questions.length} question${questions.length === 1 ? '' : 's'} imported. Review them, then save the quiz.`);
  } catch (error) { toast(error.message); }
}
function speedExample() {
  const percent = draft.speedBonus.maxPercent;
  return `Example: a 1,000-point question can earn up to +${Math.floor(1000 * percent / 100).toLocaleString()} bonus. With half the time left: +${Math.floor(500 * percent / 100).toLocaleString()} bonus. Rounded down to whole points.`;
}
function speedLabel(state, question = null) {
  if (!state.speedBonus?.enabled) return 'Equal points for correct answers · speed bonus off';
  return question ? `⚡ Up to +${Math.floor(question.points * state.speedBonus.maxPercent / 100).toLocaleString()} speed bonus` : `⚡ Speed bonus on · up to +${state.speedBonus.maxPercent}% for correct answers`;
}
const removeButton = player => `<button class="icon-button delete" data-action="remove-player" data-id="${player.id}" aria-label="Remove ${escape(player.nickname)}" title="Remove player">×</button>`;
function hostPlayerControls(state) {
  if (['lobby', 'finished'].includes(state.phase)) return '';
  return `<details class="panel manage-players"><summary>Manage players (${state.playerCount}/${state.maxPlayers})</summary><div class="player-chips">${state.rankings.map(p => `<div class="player-chip">${avatar(p)}<strong>${escape(p.nickname)}</strong>${removeButton(p)}</div>`).join('') || '<p>No players remain. End this game to return to your library.</p>'}</div></details>`;
}
async function api(path, { method = 'GET', data, token } = {}) {
  const response = await fetch('/api' + path, { method, headers: { ...(data ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: data ? JSON.stringify(data) : undefined });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Unable to complete that request.'); return result;
}
let toastTimer;
function toast(message) { const element = $('#toast'); element.textContent = message; element.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => element.classList.remove('show'), 4500); }
function beep() { if (!sound) return; try { audioContext ||= new AudioContext(); const oscillator = audioContext.createOscillator(), gain = audioContext.createGain(); oscillator.connect(gain); gain.connect(audioContext.destination); oscillator.frequency.setValueAtTime(660, audioContext.currentTime); oscillator.frequency.exponentialRampToValueAtTime(990, audioContext.currentTime + .15); gain.gain.setValueAtTime(.07, audioContext.currentTime); gain.gain.exponentialRampToValueAtTime(.001, audioContext.currentTime + .3); oscillator.start(); oscillator.stop(audioContext.currentTime + .3); } catch {} }
const logo = () => `<a href="#/" class="logo" aria-label="Seekers of Christ QUIZ home"><span class="logo-mark">ϟ</span><span class="logo-text">Seekers of Christ<b>QUIZ</b></span><sup>✦</sup></a>`;
function themeButton(extraClass = '') {
  const dark = document.documentElement.dataset.theme === 'dark';
  return `<button class="button outline small theme-toggle ${extraClass}" data-theme-toggle aria-label="Dark mode" aria-pressed="${dark}" title="Switch to ${dark ? 'light' : 'dark'} mode"><span data-theme-icon aria-hidden="true">${dark ? '☀' : '☾'}</span><span data-theme-label>${dark ? 'Light mode' : 'Dark mode'}</span></button>`;
}
function shell(content, section = 'play') {
  return `<div class="app-shell"><aside class="sidebar">${logo()}${themeButton('mobile-theme-toggle')}<div class="sidebar-caption">LET’S MAKE IT FUN</div><nav><a class="nav-item ${section === 'play' ? 'active' : ''}" href="#/">${icon('play')} Join a game</a><a class="nav-item ${section === 'library' ? 'active' : ''}" href="#/admin">${icon('grid')} My quizzes</a><a class="nav-item ${section === 'editor' ? 'active' : ''}" href="#/edit/new">${icon('plus')} Create a quiz</a></nav><div class="sidebar-bottom"><div class="tiny-art">✦ <span>☺</span> ✧</div><strong>Good questions.<br>Great memories.</strong><p>Bring your people together,<br>one question at a time.</p><span class="mini-tag">MADE FOR YOUR CREW</span></div><div class="sidebar-footer"><span class="status-dot"></span> A little friendly competition.</div></aside><div class="workspace"><header class="topbar"><span class="breadcrumb">Your daily dose of <strong>“I knew that!”</strong> ✨</span><div class="top-actions">${themeButton()}<a href="#/" class="button small subtle">${icon('play')} Join game</a>${admin ? `<button class="profile-button" data-action="logout" title="Sign out of admin"><span class="profile-avatar">A</span><span>Quiz master<small>Admin · sign out</small></span></button>` : `<a class="button small outline" href="#/admin">Host a quiz ${icon('arrow')}</a>`}</div></header><main class="content">${content}</main><footer class="page-footer"><span>Seekers of Christ QUIZ © ${new Date().getFullYear()}</span><span>A little curiosity goes a long way. ✦</span></footer></div></div>`;
}
function home() {
  $('#app').innerHTML = shell(`<div class="eyebrow"><span class="status-dot"></span> REAL PEOPLE. REAL-TIME FUN.</div><div class="page-heading"><div><h1>Big questions.<br><span class="purple-text">Bigger energy.</span><span class="heading-spark">✳</span></h1><p>Your crew. A little competition. A whole lot of <em>let’s go.</em></p></div><span class="hand-note">Ready when you are ↴</span></div><section class="join-hero"><div class="hero-copy"><span class="pill light">✦ THE NEXT ROUND STARTS WITH YOU</span><h2>Less scrolling.<br>More <span>showing off.</span></h2><p>Jump into a live quiz and put that big brain to work.<br>No account. No downloads. Just your best guess.</p><div class="hero-social"><div class="avatar-stack"><span>🐸</span><span>🦊</span><span>🐼</span></div><div><strong>Better with your people</strong><small>From classroom crews to game-night legends</small></div></div></div><div class="hero-doodle d1">✳</div><div class="hero-doodle d2">✦</div><div class="join-card"><div class="join-card-icon">🎮</div><h3>You’re in the right place.</h3><p>Got a game PIN? Let’s make some noise.</p><form id="join-form"><label for="pin">GAME PIN</label><input id="pin" name="pin" class="pin-input" placeholder="ABCDEF" autocomplete="off" autocapitalize="characters" pattern="[A-Za-z]{6}" maxlength="6" minlength="6" required value="${escape(new URLSearchParams(location.search).get('pin')?.toUpperCase() || '')}"><label for="nickname">YOUR NICKNAME · OPTIONAL</label><input id="nickname" name="nickname" placeholder="Surprise me! (random name)" maxlength="20" autocomplete="nickname"><p class="random-name-note">Leave blank for a random name. Your unique icon and color are chosen when you join.</p><button class="button primary full" type="submit">Let’s play ${icon('arrow')}</button><p class="form-error" role="alert"></p></form><span class="join-footnote">No sign-up. Just show up. ✌️</span></div></section><div class="section-title"><h2>Small setup. Big main-character energy.</h2><span>HOW IT WORKS ${icon('spark')}</span></div><div class="steps"><article><span class="step-icon violet">01 <span>⌨</span></span><h3>Drop the PIN</h3><p>Get the six-letter code from your host and pick a nickname that’s so you.</p></article><article><span class="step-icon pink">02 <span>ϟ</span></span><h3>Trust your brain</h3><p>Pick your answers before the clock runs out. Every round is a fresh chance.</p></article><article><span class="step-icon orange">03 <span>♜</span></span><h3>Chase the podium</h3><p>Watch the leaderboard after every question. A comeback is always on the cards.</p></article></div><section class="host-banner"><span class="host-banner-icon">🧠</span><div><h3>Got a question for the group?</h3><p>Make it a whole game. Create your own quiz and take the host seat.</p></div><a href="#/edit/new" class="button outline">Create a quiz ${icon('plus')}</a></section>`);
}
function login() {
  $('#app').innerHTML = shell(`<div class="login-layout"><div class="eyebrow">THE HOST SEAT IS YOURS</div><h1>Hey, quiz master. <span>👋</span></h1><p class="muted">Sign in to create quizzes and get your crew playing.</p><form id="login-form" class="panel login-panel"><div class="login-emoji">🔑</div><h2>Admin access</h2><label for="password">Admin password</label><input id="password" name="password" type="password" autocomplete="current-password" required placeholder="Enter your admin password"><button class="button primary full">Let’s make a quiz ${icon('arrow')}</button><p class="form-error" role="alert"></p></form><a href="#/" class="text-link">Here to play? Join with a PIN →</a></div>`, 'library');
}
function quizCard(q) { return `<article class="quiz-card"><div class="quiz-cover ${q.color}"><span class="cover-dot one"></span><span class="cover-dot two"></span><span class="cover-spark">✦</span><span class="cover-emoji">${q.emoji}</span><span class="cover-label">${q.questions.length} QUESTIONS</span></div><div class="quiz-card-body"><span class="quiz-category">YOUR NEXT GREAT GAME</span><h3>${escape(q.title)}</h3><p>${escape(q.description || 'A fresh challenge for your favorite people.')}</p><div class="quiz-meta"><span>${icon('clock')} ${Math.ceil(q.questions.reduce((s, x) => s + x.duration, 0) / 60)} min</span><span>${icon('bolt')} ${q.questions.reduce((s, x) => s + x.points, 0).toLocaleString()} pts</span></div><div class="quiz-card-actions"><button class="button primary small" data-action="host" data-id="${q.id}">${icon('play')} Host live</button><a class="button small outline" href="#/edit/${q.id}">Edit</a><button class="icon-button" data-action="duplicate" data-id="${q.id}" aria-label="Duplicate ${escape(q.title)}" title="Duplicate quiz">${icon('copy')}</button><button class="icon-button delete" data-action="delete" data-id="${q.id}" aria-label="Delete ${escape(q.title)}" title="Delete quiz">${icon('close')}</button></div></div></article>`; }
function library() {
  $('#app').innerHTML = shell(`<div class="page-heading compact"><div><div class="eyebrow">YOUR IDEAS, THEIR NEXT OBSESSION</div><h1>Let’s play it your way. <span class="wave">✌️</span></h1><p>A room full of people. A quiz full of possibilities.</p></div><a href="#/edit/new" class="button primary">${icon('plus')} Create a quiz</a></div><section class="library-banner"><div><span class="pill light">YOU BRING THE QUESTIONS. WE BRING THE FUN.</span><h2>Turn “wait, I know this!”<br>into a whole event.</h2><p>Pick a quiz, share your PIN, and let the friendly rivalry begin.</p></div><div class="banner-illustration"><span class="orb small-orb">✦</span><span class="brain-orb">🧠</span><span class="orb bolt-orb">ϟ</span><span class="floating-note">100% good energy</span></div></section>${rooms.length ? `<section class="active-rooms"><h2><span class="status-dot"></span> Your live rooms</h2>${rooms.map(r => `<a class="room-link" href="#/host/${r.pin}"><strong>${escape(r.title)}</strong><span>${r.players} players · ${escape(r.phase)}</span><b>${r.pin}</b>${icon('arrow')}</a>`).join('')}</section>` : ''}<div class="section-title library-title"><h2>My quizzes <span class="count-badge">${quizzes.length}</span></h2><div class="search-wrap">⌕ <input id="quiz-search" type="search" placeholder="Find your next game…" aria-label="Search quizzes"></div></div><div class="quiz-grid" id="quiz-grid">${quizzes.map(quizCard).join('')}<a class="create-card" href="#/edit/new"><span>+</span><h3>A little idea. A great game.</h3><p>Start with a question.<br>See where the fun takes you.</p><b>Create a new quiz →</b></a></div><p class="no-results hidden" id="no-results">No quizzes match that search.</p>`, 'library');
}
const newQuestion = (settings = { duration: 15, points: 100, negative: true, penalty: 25, penaltyMatchesPoints: false }) => ({ text: '', type: 'single', options: ['', '', '', ''], correct: [0], ...settings });
function syncDraft() {
  if (!draft || !$('#quiz-title')) return;
  draft.title = $('#quiz-title').value; draft.description = $('#quiz-description').value;
  const q = draft.questions[activeQuestion]; q.text = $('#question-text').value; q.duration = Number($('#duration').value); q.points = Number($('#points').value); q.negative = $('#negative').checked;
  q.penalty = $('#penalty').disabled ? q.penalty ?? q.points : Number($('#penalty').value);
  q.penaltyMatchesPoints = $('#penalty-match').checked;
  draft.defaults = { duration: Number($('#all-duration').value), points: Number($('#all-points').value), negative: $('#all-negative').checked, penalty: $('#all-penalty').disabled ? draft.defaults.penalty : Number($('#all-penalty').value), penaltyMatchesPoints: $('#all-penalty-match').checked };
  refreshPenaltyFields();
  draft.maxPlayers = Number($('#quiz-max-players').value); draft.shuffleQuestions = $('#quiz-shuffle').checked;
  draft.speedBonus = { enabled: $('#speed-enabled').checked, maxPercent: Number($('#speed-percent').value) };
  $('#speed-example').textContent = speedExample();
  q.options = $$('.option-text').map(i => i.value); q.correct = $$('.correct-input:checked').map(i => Number(i.value));
  const currentTab = $('.question-tab.selected');
  if (currentTab) {
    $('strong', currentTab).textContent = q.text || 'Your next big question';
    $('small', currentTab).textContent = `${q.type === 'single' ? 'Single choice' : 'Multiple answers'} · ${q.duration}s`;
  }
  draftStorage.set(draftKey, draft);
}
function editor() {
  draft.defaults ||= settingsOf(draft.questions[0]); draft.maxPlayers ??= 200;
  draft.speedBonus ??= { enabled: false, maxPercent: 50 };
  const q = draft.questions[activeQuestion];
  $('#app').innerHTML = shell(`<div class="editor-header"><a class="text-link" href="#/admin">← My quizzes</a><div><span class="draft-note">Draft saved on this device</span><button class="button primary" data-action="save">${icon('check')} Save quiz</button></div></div><div class="editor-title"><div class="emoji-picker"><label for="quiz-emoji" class="sr-only">Quiz icon</label><select id="quiz-emoji">${['⚡', '🚀', '🧠', '🌍', '🎮', '✨', '📖', '🎵'].map(e => `<option ${draft.emoji === e ? 'selected' : ''}>${e}</option>`).join('')}</select></div><div><label for="quiz-title" class="sr-only">Quiz title</label><input id="quiz-title" class="title-input" placeholder="Give your quiz a great name…" maxlength="100" value="${escape(draft.title)}"><label for="quiz-description" class="sr-only">Quiz description</label><input id="quiz-description" class="description-input" placeholder="What’s the vibe? Add a short description." maxlength="240" value="${escape(draft.description)}"></div><div class="color-picker" aria-label="Quiz cover color">${colors.map(c => `<button class="color-swatch ${c} ${draft.color === c ? 'chosen' : ''}" data-action="color" data-color="${c}" aria-label="${c} cover" aria-pressed="${draft.color === c}">${draft.color === c ? '✓' : ''}</button>`).join('')}</div></div>${bulkSettings()}${speedSettings()}${importSettings()}<div class="builder"><aside class="question-list"><div class="question-list-title">QUESTIONS <span>${draft.questions.length}</span></div>${draft.questions.map((item, i) => `<button class="question-tab ${activeQuestion === i ? 'selected' : ''}" data-action="select-question" data-index="${i}"><span>${String(i + 1).padStart(2, '0')}</span><div><strong>${escape(item.text || 'Your next big question')}</strong><small>${item.type === 'single' ? 'Single choice' : 'Multiple answers'} · ${item.duration}s</small></div></button>`).join('')}<button class="button dashed full" data-action="add-question">+ Add question</button></aside><section class="question-editor panel"><div class="question-toolbar"><span class="eyebrow">QUESTION ${activeQuestion + 1}</span><div><button class="icon-button" data-action="move-up" ${activeQuestion === 0 ? 'disabled' : ''} title="Move question up" aria-label="Move question up">↑</button><button class="icon-button" data-action="move-down" ${activeQuestion === draft.questions.length - 1 ? 'disabled' : ''} title="Move question down" aria-label="Move question down">↓</button><button class="icon-button" data-action="copy-question" title="Duplicate question" aria-label="Duplicate question">▣</button><button class="icon-button delete" data-action="remove-question" ${draft.questions.length === 1 ? 'disabled' : ''} title="Remove question" aria-label="Remove question">×</button></div></div><label for="question-type">Question type</label><select id="question-type"><option value="single" ${q.type === 'single' ? 'selected' : ''}>Single choice — one correct answer</option><option value="multiple" ${q.type === 'multiple' ? 'selected' : ''}>Multiple answers — select all correct options</option></select><label for="question-text">Make them think <span>✦</span></label><textarea id="question-text" rows="3" maxlength="500" placeholder="What’s your question?">${escape(q.text)}</textarea><div class="answer-label"><label>Answer options</label><span>Mark ${q.type === 'single' ? 'the correct answer' : 'all correct answers'} ${icon('check')}</span></div><div class="editor-options">${q.options.map((option, i) => `<div class="editor-option option-${i}"><label class="correct-label" title="Mark answer ${i + 1} as correct"><input class="correct-input" type="${q.type === 'single' ? 'radio' : 'checkbox'}" name="correct" value="${i}" ${q.correct.includes(i) ? 'checked' : ''} aria-label="Answer ${i + 1} is correct"><span>${'ABCDEF'[i]}</span></label><input class="option-text" aria-label="Answer ${i + 1}" maxlength="200" placeholder="Answer ${i + 1}" value="${escape(option)}"><button class="icon-button" data-action="remove-option" data-index="${i}" ${q.options.length <= 2 ? 'disabled' : ''} aria-label="Remove answer ${i + 1}">×</button></div>`).join('')}</div><button class="text-link add-option" data-action="add-option" ${q.options.length >= 6 ? 'disabled' : ''}>+ Add an option <small>(${q.options.length}/6)</small></button><div class="question-settings"><div><label for="duration">${icon('clock')} Time limit (seconds)</label><input id="duration" type="number" min="5" max="300" value="${q.duration}" aria-describedby="duration-note"><p id="duration-note" class="duration-note">Players see the question for 1.5 seconds first. Choices and the full answer timer start together afterward.</p></div><div><label for="points">${icon('bolt')} Question points</label><input id="points" type="number" min="0" max="10000" value="${q.points}"></div></div><label class="penalty-setting" for="negative"><span><strong>Raise the stakes ${icon('bolt')}</strong><small>Wrong answer or no answer? Subtract the deduction set below.</small></span><input id="negative" type="checkbox" role="switch" ${q.negative ? 'checked' : ''}></label><label for="penalty">Wrong-answer deduction</label><input id="penalty" type="number" min="0" max="10000" required value="${penaltyAmount(q)}" ${q.negative && !q.penaltyMatchesPoints ? '' : 'disabled'}><label class="bulk-toggle"><input id="penalty-match" type="checkbox" ${q.penaltyMatchesPoints ? 'checked' : ''} ${q.negative ? '' : 'disabled'}> Match deduction to correct-answer points</label><p class="settings-note">When checked, the deduction follows this question’s base points, excluding speed bonuses.</p><div class="editor-tip">${icon('spark')} ${q.type === 'multiple' ? 'Players must select every correct answer, and no incorrect ones, to earn points.' : 'Every correct answer earns full points. Let knowledge do the talking.'}</div></section></div>`, 'editor');
}
function soundButton() {
  return `<button class="icon-button" data-action="sound" aria-label="${sound ? 'Mute' : 'Enable'} sound" title="${sound ? 'Mute' : 'Enable'} sound">${sound ? '🔊' : '🔇'}</button>`;
}
function liveHeader(state, host) {
  const connection = '<div id="connection" class="connection hidden" role="status">Reconnecting… your place is saved.</div>';
  if (!host) return `<header class="live-header">${logo()}<div class="live-header-info">${themeButton()}<span class="pill">${avatar(state.me)} ${escape(state.me.nickname)}</span><span class="pin-mini">PIN <b>${state.pin}</b></span>${soundButton()}</div></header>${connection}`;
  return `<header class="live-header host-header"><div class="host-identity"><strong>${escape(state.title)}</strong><span class="pin-mini">PIN <b>${state.pin}</b></span></div><div class="host-display-actions"><button class="button outline small" data-action="toggle-controls" title="Hide controls (H)">Hide controls</button><button class="button primary small" data-action="fullscreen" title="Toggle fullscreen (F)">${document.fullscreenElement ? 'Exit fullscreen' : '⛶ Fullscreen'}</button></div><div class="host-settings" id="host-settings">${state.phase !== 'finished' ? `<button class="button small outline live-setting-toggle leaderboard-toggle" data-action="toggle-leaderboard" role="switch" aria-checked="${keepLeaderboard}"><span class="switch-track" aria-hidden="true"></span>Keep leaderboard visible</button><button class="button small outline live-setting-toggle" data-action="toggle-skip-rest" role="switch" aria-checked="${state.skipRestTime === true}" title="Automatically continue together after all answers or timeout." ${pendingSkipRestPin === state.pin ? 'disabled' : ''}><span class="switch-track" aria-hidden="true"></span>Auto next question</button>` : ''}${themeButton()}${soundButton()}${state.phase !== 'finished' ? '<button class="button small outline" data-action="end">End game</button>' : ''}</div></header><button class="restore-controls icon-button" data-action="toggle-controls" aria-label="Show host controls" title="Show controls (H)">${icon('settings')}</button>${connection}`;
}
function applyPresentation() {
  $('.host-shell')?.classList.toggle('controls-hidden', controlsHidden);
  $$('[data-action="fullscreen"]').forEach(button => { button.textContent = document.fullscreenElement ? 'Exit fullscreen' : '⛶ Fullscreen'; });
}
function toggleControls() {
  controlsHidden = !controlsHidden;
  if (controlsHidden) { clearTimeout(toastTimer); $('#toast').classList.remove('show'); }
  applyPresentation();
  $(controlsHidden ? '.restore-controls' : '.host-display-actions [data-action="toggle-controls"]')?.focus({ preventScroll: true });
}
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else {
      if (!document.documentElement.requestFullscreen) throw new Error('Fullscreen is unavailable in this browser. You can still hide the controls.');
      await document.documentElement.requestFullscreen();
      controlsHidden = true;
      clearTimeout(toastTimer); $('#toast').classList.remove('show');
      applyPresentation();
      $('.restore-controls')?.focus({ preventScroll: true });
    }
  } catch (error) { toast(error.message || 'Unable to enter fullscreen. Try your browser’s fullscreen control.'); }
}
document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) controlsHidden = false;
  applyPresentation();
});
document.addEventListener('keydown', event => {
  if (!location.hash.startsWith('#/host/') || !live || event.repeat || event.ctrlKey || event.metaKey || event.altKey || $('#modal').open || event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (event.key.toLowerCase() === 'h') { event.preventDefault(); toggleControls(); }
  if (event.key.toLowerCase() === 'f') { event.preventDefault(); toggleFullscreen(); }
});

function leaderboard(state) {
  const before = new Map((state.previousRankings ?? []).map(p => [p.id, p.rank]));
  return `<div class="leaderboard-list">${state.rankings.map(p => {
    const change = (before.get(p.id) ?? p.rank) - p.rank;
    const movement = state.phase === 'leaderboard' && change ? `<span class="rank-change ${change > 0 ? 'up' : 'down'}" aria-label="${change > 0 ? 'Up' : 'Down'} ${Math.abs(change)} places">${change > 0 ? '↑' : '↓'} ${Math.abs(change)}</span>` : '';
    return `<div class="leaderboard-row ${p.id === state.me?.id ? 'is-you' : ''}" data-player-id="${p.id}"><span class="rank">${p.rank <= 3 ? ['🥇', '🥈', '🥉'][p.rank - 1] : String(p.rank).padStart(2, '0')}</span>${avatar(p)}<strong>${escape(p.nickname)} ${p.id === state.me?.id ? '<small>YOU</small>' : ''}</strong>${movement}<b aria-label="${p.score} points"><span class="leaderboard-score" data-score="${p.score}" data-display-score="${p.score}" aria-hidden="true">${p.score.toLocaleString()}</span> <small aria-hidden="true">pts</small></b></div>`;
  }).join('')}</div>`;
}
function leaderboardPanel(state) {
  const completed = state.phase === 'leaderboard' ? state.index + 1 : state.index;
  return `<aside class="host-leaderboard panel" aria-labelledby="host-leaderboard-title"><div class="leaderboard-heading"><h2 id="host-leaderboard-title">Leaderboard</h2><span>${state.playerCount} PLAYERS</span></div><p class="leaderboard-note">${completed > 0 ? `Standings after round ${completed}` : 'Starting scores · first round in progress'}<span>Updates after each completed round</span></p><div class="host-leaderboard-scroll" tabindex="0" role="region" aria-label="Player standings">${leaderboard(state)}${state.rankings.length ? '' : '<p class="muted">No players in this room.</p>'}</div></aside>`;
}
function roundContent(state, host) {
  const q = state.question, preview = state.phase === 'preview';
  const answers = preview ? '' : !host && state.submitted ? `<div class="locked-answer"><span>✓</span><h2>Answer saved</h2><p>Waiting for all answers or the timer.</p><span class="waiting-pill">${state.answered} / ${state.playerCount} answered</span></div>` : `<div class="live-options">${q.options.map((option, i) => `<button class="answer-card option-${i} ${selected.includes(i) ? 'picked' : ''}" data-action="answer-choice" data-index="${i}" ${host || answering ? 'disabled' : ''} aria-pressed="${selected.includes(i)}"><span class="answer-letter">${'ABCDEF'[i]}</span><strong>${escape(option)}</strong>${host ? '' : `<span class="answer-check">${selected.includes(i) ? '✓' : q.type === 'multiple' ? '□' : '○'}</span>`}</button>`).join('')}</div>`;
  return `<section class="question-stage is-${state.phase}" data-round-key="${state.pin}:${state.index}" aria-labelledby="live-question-title"><div class="round-meta"><span class="round-number">Question <b>${state.index + 1}</b><span> / ${state.total}</span></span><span class="round-instruction">${preview ? 'Read the question' : q.type === 'single' ? 'Choose one answer' : 'Select all correct answers'}</span><div class="timer-slot">${preview ? '' : '<div class="timer" id="timer" aria-label="Seconds remaining"></div>'}</div></div><div class="round-progress" role="progressbar" aria-label="${preview ? 'Time until answers open' : 'Time remaining'}" aria-valuemin="0" aria-valuemax="${preview ? state.previewDuration / 1000 : q.duration}"><span class="round-progress-fill"></span></div><div class="question-heading"><h1 class="live-question" id="live-question-title">${escape(q.text)}</h1></div><div class="round-answers"><div class="round-answers-inner">${answers}</div></div><div class="question-bottom">${preview ? '<span class="sr-only" role="status">Answers open after the question preview.</span>' : `<span><b>${state.answered} / ${state.playerCount}</b> answered</span>${host ? '' : `<span class="round-scoring">${q.points.toLocaleString()} pts${q.negative ? ` · Wrong / missed: −${q.penalty}` : ''}${state.speedBonus?.enabled ? ` · ${speedLabel(state, q)}` : ''}</span>`}${!host && !state.submitted && q.type === 'multiple' ? `<button class="button primary large" data-action="submit-answer" ${selected.length && !answering ? '' : 'disabled'}>Lock it in ${icon('check')}</button>` : ''}`}</div></section>`;
}
// Keep the question DOM in place across the preview and answer phases. CSS
// can then move and resize the same heading without a page replacement.
function patchRound(state, host, content, split) {
  const stage = $('.question-stage'), main = $('.live-content');
  if (!stage || stage.dataset.roundKey !== `${state.pin}:${state.index}` || !['preview', 'question'].includes(state.phase) || main.classList.contains('host-split') !== split) return false;
  const template = document.createElement('template'); template.innerHTML = content;
  const next = template.content.firstElementChild;
  for (const selector of ['.round-meta', '.round-answers-inner', '.question-bottom']) {
    const target = $(selector, stage), source = $(selector, next);
    if (target.innerHTML !== source.innerHTML) target.innerHTML = source.innerHTML;
  }
  const progress = $('.round-progress', stage), nextProgress = $('.round-progress', next);
  for (const name of ['aria-label', 'aria-valuemax']) progress.setAttribute(name, nextProgress.getAttribute(name));
  if (stage.classList.contains('is-preview') && state.phase === 'question') void stage.offsetHeight;
  stage.className = next.className;
  main.className = `live-content ${state.phase}${split ? ' host-split' : ''}`;
  const header = document.createElement('template'); header.innerHTML = liveHeader(state, host);
  $('.live-header').replaceWith(header.content.firstElementChild);
  // Replacing an unchanged panel would cut short its overtaking animation.
  if (split && leaderboardPanel(state) !== renderedPanel) { renderedPanel = leaderboardPanel(state); $('.host-leaderboard').outerHTML = renderedPanel; }
  if (host) {
    const details = $('.manage-players'), open = details?.open;
    if (details) { details.outerHTML = hostPlayerControls(state); $('.manage-players').open = open; }
  }
  return true;
}
function syncRoundProgress() {
  const fill = $('.round-progress-fill');
  const end = live?.phase === 'preview' ? live.previewEndsAt : live?.deadline;
  const key = `${live?.pin}:${live?.index}:${live?.phase}:${end}`;
  if (fill && roundProgressKey === key && roundProgressAnimation?.effect?.target === fill) return;
  roundProgressAnimation?.cancel(); roundProgressAnimation = null; roundProgressKey = key;
  if (!fill || !['preview', 'question'].includes(live.phase)) return;
  const duration = live.phase === 'preview' ? live.previewDuration : live.question.duration * 1000;
  const remaining = Math.max(0, end - (Date.now() + clockOffset));
  const fraction = Math.min(1, remaining / duration);
  fill.style.transform = `scaleX(${fraction})`;
  if (!reducedMotion.matches) roundProgressAnimation = fill.animate([{ transform: `scaleX(${fraction})` }, { transform: 'scaleX(0)' }], { duration: remaining, easing: 'linear', fill: 'forwards' });
}
reducedMotion.addEventListener('change', () => { roundProgressKey = ''; syncRoundProgress(); });
function renderLive(host) {
  const s = live; if (!s) return;
  const oldPositions = captureLeaderboard();
  const previousRound = $('.live-content')?.dataset.round;
  const leaderboardScroll = $('.host-leaderboard-scroll')?.scrollTop ?? 0;
  const split = host && keepLeaderboard && ['preview', 'question', 'leaderboard'].includes(s.phase);
  let content = '';
  if (s.phase === 'lobby') {
    content = `${host ? '' : `<div class="lobby-top"><h1>You’re in, ${escape(s.me.nickname)}!</h1><p>${escape(s.title)}</p></div>`}<section class="lobby-pin panel"><span>${host ? 'Join at' : 'YOUR GAME PIN'}</span>${host ? `<strong class="join-url">${escape(location.host)}</strong>` : ''}<div class="big-pin">${s.pin}</div>${host ? `<button class="button subtle" data-action="copy-link">${icon('copy')} Copy invite link</button>` : `<span class="waiting-pill"><span class="status-dot"></span> Waiting for the host to start…</span>`}</section>${host ? `<form id="room-settings-form" class="room-settings"><label for="room-max-players">Maximum players</label><input id="room-max-players" name="maxPlayers" type="number" min="${Math.max(1, s.playerCount)}" max="200" required value="${escape(pendingMaxPlayers ?? s.maxPlayers)}"><button class="button outline small" type="submit">Update limit</button><label class="shuffle-toggle"><input id="room-shuffle" type="checkbox" ${s.shuffleQuestions ? 'checked' : ''}> Shuffle question order</label><p class="form-error" role="alert"></p></form>` : ''}<div class="lobby-players"><div class="section-title"><h2>${icon('people')} Players <span class="count-badge">${s.playerCount}/${s.maxPlayers}</span></h2></div><div class="player-chips">${s.rankings.map((p, i) => `<div class="player-chip">${avatar(p)}<strong>${escape(p.nickname)}</strong>${host ? removeButton(p) : ''}</div>`).join('') || '<div class="empty-players"><span>👀</span><h3>Waiting for your first legend…</h3><p>Share the PIN and watch your crew roll in.</p></div>'}</div></div>${host ? `<div class="host-controls"><span>${s.total} questions · ${s.playerCount} ${s.playerCount === 1 ? 'player' : 'players'} ready</span><button class="button primary large" data-action="next" ${s.playerCount ? '' : 'disabled'}>Start game ${icon('play')}</button></div>` : ''}`;
  } else if (['preview', 'question'].includes(s.phase)) {
    content = roundContent(s, host);
  } else {
    const final = s.phase === 'finished', q = s.question, result = s.result;
    content = `<div class="results-title"><span class="result-emoji host-decoration">${final ? '🏆' : host ? '🔥' : result?.correct ? '🎉' : result?.missed ? '⏰' : '💪'}</span><div class="eyebrow host-decoration">${final ? 'THAT’S A WRAP' : `ROUND ${s.index + 1} COMPLETE`}</div><h1>${final ? 'Final results' : host ? `Round ${s.index + 1} complete` : result?.correct ? 'You nailed it!' : result?.missed ? 'Time flew by!' : 'Comeback loading…'}</h1><p class="${host ? 'host-decoration' : ''}">${final ? `Thanks for playing ${escape(s.title)}.` : host ? '' : `${result?.delta > 0 ? '+' : ''}${result?.delta ?? 0} points this round. ${result?.correct ? 'Keep that energy going.' : 'There’s always something new to learn.'}`}</p>${!final && result?.correct && s.speedBonus.enabled ? `<div class="score-breakdown"><span>+${result.basePoints.toLocaleString()} base</span><span>⚡ +${result.bonus.toLocaleString()} speed bonus</span></div>` : ''}</div>${q && !final ? `<section class="answer-reveal panel"><span class="eyebrow">THE CORRECT ${q.correct.length > 1 ? 'ANSWERS' : 'ANSWER'}</span><h3>${escape(q.text)}</h3><div>${q.correct.map(i => `<span class="correct-pill">✓ ${escape(q.options[i])}</span>`).join('')}</div>${host && s.distribution ? `<div class="distribution">${q.options.map((o, i) => `<span>${'ABCDEF'[i]}: <b>${s.distribution[i]}</b> votes</span>`).join('')}</div>` : ''}</section>` : ''}${final && s.rankings.length ? `<div class="winner-callout"><span>👑</span><strong>${s.rankings.filter(p => p.rank === 1).map(p => escape(p.nickname)).join(' & ')}</strong><span>${s.rankings.filter(p => p.rank === 1).length > 1 ? 'share the crown!' : 'takes the crown!'}</span></div>` : ''}${split ? '' : `<div class="leaderboard-heading"><h2>${final ? 'Final standings' : 'Leaderboard'}</h2><span>${s.playerCount} PLAYERS</span></div>${leaderboard(s)}`}<div class="host-controls">${final ? `<a href="#/${host ? 'admin' : ''}" class="button primary large">${host ? 'Back to my quizzes' : 'Play another game'} ${icon('arrow')}</a>${host ? '<button class="button outline host-utility" data-action="export">Download results ↓</button>' : ''}${!host || reducedMotion.matches ? '' : `<button class="stop-confetti icon-button" data-action="stop-confetti" ${storage.get('confetti-stopped:' + s.pin) ? 'disabled aria-label="Confetti stopped" title="Confetti stopped"' : 'aria-label="Stop confetti" title="Stop confetti"'}><span aria-hidden="true">🎉</span></button>`}` : host ? `<span>${s.index + 1} of ${s.total} rounds played</span><button class="button primary large" data-action="next" ${s.playerCount ? '' : 'disabled'}>${s.index + 1 === s.total ? 'Show final results 🏆' : 'Next question →'}</button>` : `<span class="waiting-pill"><span class="status-dot"></span> ${s.index + 1 === s.total ? 'Waiting for the final results…' : 'Waiting for the next round…'}</span>`}</div>`;
  }
  if (!patchRound(s, host, content, split)) $('#app').innerHTML = `<div class="live-shell ${host ? 'host-shell' : ''}">${liveHeader(s, host)}<main data-round="${s.index}" class="live-content ${s.phase}${split ? ' host-split' : ''}">${split ? `<section class="host-round" aria-label="Current round">${content}${hostPlayerControls(s)}</section>${renderedPanel = leaderboardPanel(s)}` : `${content}${host ? hostPlayerControls(s) : ''}`}</main></div>`;
  applyPresentation();
  if ($('.host-leaderboard-scroll')) $('.host-leaderboard-scroll').scrollTop = leaderboardScroll;
  if (s.phase === 'preview' && previousRound !== String(s.index)) window.scrollTo({ top: 0, behavior: 'instant' });
  syncRoundProgress();
  updateTimer();
  if (storage.get('confetti-stopped:' + s.pin)) stopCelebration(s.pin);
  // Confetti is for the projector; player phones show the standings only.
  presentLeaderboard(s, oldPositions, host);
}
function updateTimer() {
  if (!live || !['preview', 'question'].includes(live.phase)) return;
  const preview = live.phase === 'preview';
  const remaining = Math.max(0, (preview ? live.previewEndsAt : live.deadline) - (Date.now() + clockOffset));
  if ($('#timer')) { $('#timer').textContent = Math.ceil(remaining / 1000); $('#timer').classList.toggle('urgent', remaining < 5000); }
  $('.round-progress')?.setAttribute('aria-valuenow', String(Math.ceil(remaining / 1000)));
  if (reducedMotion.matches && $('.round-progress-fill')) $('.round-progress-fill').style.transform = `scaleX(${Math.min(1, remaining / (preview ? live.previewDuration : live.question.duration * 1000))})`;
}
setInterval(updateTimer, 100);
async function connectRoom(pin, host) {
  const secret = host ? null : storage.get('room:' + pin)?.token;
  if (!host && !secret) { location.hash = '/'; toast('Enter your PIN and nickname to join.'); return; }
  const state = await api(`/rooms/${pin}/state`, { token: secret });
  if (location.hash !== `#/${host ? 'host' : 'room'}/${pin}`) return;
  live = state; clockOffset = live.serverTime - Date.now(); liveKey = `${live.index}:${live.phase}`; selected = live.choices; renderLive(host);
  stream = new EventSource(`/api/rooms/${pin}/events${secret ? `?token=${encodeURIComponent(secret)}` : ''}`);
  stream.onmessage = event => {
    const next = JSON.parse(event.data), key = `${next.index}:${next.phase}`;
    clockOffset = next.serverTime - Date.now();
    if (JSON.stringify({ ...next, serverTime: 0 }) === JSON.stringify({ ...live, serverTime: 0 })) return;
    if (key !== liveKey) { selected = next.choices; if (next.phase !== 'preview') beep(); } liveKey = key; clockOffset = next.serverTime - Date.now(); live = next; renderLive(host);
  };
  stream.addEventListener('removed', () => {
    resetCelebrations();
    stream?.close(); stream = null; live = null; storage.set('room:' + pin, null);
    $('#app').innerHTML = shell('<div class="error-page"><span>👋</span><h1>You left the room.</h1><p>The host removed you from this game.</p><a href="#/" class="button primary">Back to home</a></div>');
  });
  stream.onerror = () => { $('#connection')?.classList.remove('hidden'); };
  stream.onopen = () => { $('#connection')?.classList.add('hidden'); };
}
async function route() {
  const version = ++navigating;
  roundProgressAnimation?.cancel(); roundProgressAnimation = null;
  if (!location.hash.startsWith('#/host/') && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  resetCelebrations();
  syncDraft(); draft = null; stream?.close(); stream = null; live = null; selected = []; pendingMaxPlayers = null;
  const parts = location.hash.replace(/^#\/?/, '').split('/'), page = parts[0];
  try {
    if (!page) { home(); return; }
    if (['admin', 'edit', 'host'].includes(page)) {
      admin = (await api('/auth')).admin; if (version !== navigating) return;
      if (!admin) { login(); return; }
    }
    if (page === 'admin' || page === 'edit') {
      const data = await api('/quizzes'); if (version !== navigating) return; quizzes = data.quizzes; rooms = data.rooms;
      if (page === 'admin') library(); else {
        const original = parts[1] === 'new' ? { title: '', description: '', emoji: '⚡', color: 'violet', questions: [newQuestion()] } : quizzes.find(q => q.id === parts[1]);
        if (!original) throw new Error('That quiz could not be found.');
        draftKey = 'soc-quiz-draft:' + parts[1]; draft = draftStorage.get(draftKey) || structuredClone(original); activeQuestion = 0; editor();
      }
    } else if (['host', 'room'].includes(page)) { await connectRoom(parts[1], page === 'host'); }
    else { location.hash = '/'; }
  } catch (error) { if (version !== navigating) return; $('#app').innerHTML = shell(`<div class="error-page"><span>😵‍💫</span><h1>Small plot twist.</h1><p>${escape(error.message)}</p><a href="#/" class="button primary">Back to home</a></div>`); }
}
document.addEventListener('submit', async event => {
  const form = event.target; if (!['join-form', 'login-form', 'room-settings-form'].includes(form.id)) return;
  event.preventDefault(); const button = $('button[type="submit"], button', form); button.disabled = true; $('.form-error', form).textContent = '';
  try {
    if (form.id === 'room-settings-form') { await api(`/rooms/${live.pin}/settings`, { method: 'POST', data: { maxPlayers: Number(form.maxPlayers.value) } }); pendingMaxPlayers = null; toast('Player limit updated.'); }
    else if (form.id === 'login-form') { await api('/login', { method: 'POST', data: { password: form.password.value } }); admin = true; await route(); }
    else { const pin = form.pin.value.trim().toUpperCase(); const result = await api(`/rooms/${pin}/join`, { method: 'POST', data: { nickname: form.nickname.value.trim() } }); storage.set('room:' + pin, result); location.hash = `/room/${pin}`; }
  } catch (error) { $('.form-error', form).textContent = error.message; } finally { button.disabled = false; }
});
document.addEventListener('input', event => {
  if (event.target.id === 'room-max-players') pendingMaxPlayers = event.target.value;
  if (event.target.id === 'pin') event.target.value = event.target.value.toUpperCase().replace(/[^A-Z]/g, '');
  if (event.target.id === 'quiz-search') { const search = event.target.value.toLowerCase(); let count = 0; $$('.quiz-card').forEach((card, i) => { const visible = (quizzes[i].title + ' ' + quizzes[i].description).toLowerCase().includes(search); card.classList.toggle('hidden', !visible); if (visible) count++; }); $('#no-results').classList.toggle('hidden', !!count || !search); }
  if (draft) syncDraft();
});
document.addEventListener('change', event => {
  if (event.target.id === 'room-shuffle') {
    const checkbox = event.target, shuffleQuestions = checkbox.checked;
    api(`/rooms/${live.pin}/settings`, { method: 'POST', data: { shuffleQuestions } }).then(() => toast(shuffleQuestions ? 'Questions will be shuffled when the game starts.' : 'Questions will play in their saved order.'), error => { checkbox.checked = !shuffleQuestions; toast(error.message); });
    return;
  }
  if (event.target.id === 'import-file') { const [file] = event.target.files; event.target.value = ''; importQuestions(file); return; }
  if (!draft) return; syncDraft();
  if (event.target.id === 'speed-enabled') $('#speed-percent').disabled = !event.target.checked;
  if (event.target.id === 'question-type') { const q = draft.questions[activeQuestion]; q.type = event.target.value; if (q.type === 'single') q.correct = [q.correct[0] ?? 0]; editor(); }
  if (event.target.id === 'quiz-emoji') draft.emoji = event.target.value;
  draftStorage.set(draftKey, draft);
});
// Resolves with the clicked button's value, or '' when dismissed with Escape.
function choose(title, body, buttons, emoji = '🤔') {
  const dialog = $('#modal'); dialog.returnValue = ''; dialog.innerHTML = `<form method="dialog"><span class="modal-emoji">${emoji}</span><h2>${escape(title)}</h2>${body}<div class="modal-actions">${buttons.map(([value, label, style = 'outline']) => `<button class="button ${style}" value="${value}">${escape(label)}</button>`).join('')}</div></form>`; dialog.showModal();
  return new Promise(resolve => dialog.addEventListener('close', () => resolve(dialog.returnValue), { once: true }));
}
const confirmation = async (title, message, label = 'Confirm') => await choose(title, `<p>${escape(message)}</p>`, [['cancel', 'Cancel'], ['confirm', label, 'primary']]) === 'confirm';
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action]'); if (!button || button.disabled) return;
  const action = button.dataset.action, index = Number(button.dataset.index), id = button.dataset.id;
  if (action === 'toggle-controls') { toggleControls(); return; }
  if (action === 'fullscreen') { await toggleFullscreen(); return; }
  if (action === 'stop-confetti' && live?.phase === 'finished') {
    storage.set('confetti-stopped:' + live.pin, true); stopCelebration(live.pin);
    button.disabled = true; button.title = 'Confetti stopped'; button.setAttribute('aria-label', 'Confetti stopped'); return;
  }
  if (action === 'toggle-leaderboard' && live && location.hash.startsWith('#/host/')) {
    keepLeaderboard = !keepLeaderboard;
    draftStorage.set('soc-quiz-keep-leaderboard', keepLeaderboard);
    renderLive(true);
    $('[data-action="toggle-leaderboard"]')?.focus({ preventScroll: true });
    return;
  }
  if (action === 'toggle-skip-rest' && live && location.hash.startsWith('#/host/')) {
    if (pendingSkipRestPin) return;
    const pin = live.pin, skipRestTime = !live.skipRestTime;
    pendingSkipRestPin = pin; button.disabled = true;
    try {
      await api(`/rooms/${pin}/settings`, { method: 'POST', data: { skipRestTime } });
      toast(skipRestTime ? 'Auto next question on · everyone continues together after all answers or timeout.' : 'Auto next question off · pause after the current question.');
    } catch (error) { toast(error.message); }
    finally {
      pendingSkipRestPin = null;
      const toggle = $('[data-action="toggle-skip-rest"]');
      if (toggle) toggle.disabled = false;
    }
    return;
  }
  if (draft) syncDraft();
  // Handled before the editor re-renders, which would replace the file input.
  if (action === 'import') { $('#import-file').click(); return; }
  if (action === 'download-template') { const url = URL.createObjectURL(new Blob([templateWorkbook()], { type: XLSX_TYPE })), a = document.createElement('a'); a.href = url; a.download = 'soc-quiz-questions-template.xlsx'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return; }
  button.disabled = true;
  try {
    if (action === 'logout') { await api('/logout', { method: 'POST', data: {} }); admin = false; if (location.hash === '#/' || !location.hash) await route(); else location.hash = '/'; }
    if (action === 'host') { const room = await api('/rooms', { method: 'POST', data: { quizId: id } }); location.hash = `/host/${room.pin}`; }
    if (action === 'duplicate') { const quiz = structuredClone(quizzes.find(q => q.id === id)); quiz.title = (quiz.title.slice(0, 90) + ' (copy)'); await api('/quizzes', { method: 'POST', data: quiz }); toast('A fresh copy, just for you.'); await route(); }
    if (action === 'delete' && await confirmation('Delete this quiz?', 'This removes the saved quiz. Any game already in progress will keep running.', 'Delete quiz')) { await api(`/quizzes/${id}`, { method: 'DELETE', data: {} }); draftStorage.remove('soc-quiz-draft:' + id); await route(); toast('Quiz deleted.'); }
    if (action === 'save') {
      const saved = await api('/quizzes' + (draft.id ? '/' + draft.id : ''), { method: draft.id ? 'PUT' : 'POST', data: draft });
      draftStorage.remove(draftKey); draft = null; toast(`“${saved.title}” is ready to play!`); location.hash = '/admin';
    }
    if (draft) {
      const q = draft.questions[activeQuestion];
      if (action === 'select-question') activeQuestion = index;
      if (action === 'add-question' || action === 'copy-question') { if (draft.questions.length >= 100) throw new Error('A quiz can have up to 100 questions.'); draft.questions.splice(activeQuestion + 1, 0, action === 'copy-question' ? structuredClone(q) : newQuestion(draft.defaults)); activeQuestion++; }
      if (action === 'remove-question') { draft.questions.splice(activeQuestion, 1); activeQuestion = Math.max(0, activeQuestion - 1); }
      if (action === 'move-up' || action === 'move-down') { const next = activeQuestion + (action === 'move-up' ? -1 : 1); [draft.questions[activeQuestion], draft.questions[next]] = [draft.questions[next], draft.questions[activeQuestion]]; activeQuestion = next; }
      if (action === 'add-option') q.options.push('');
      if (action === 'remove-option') { q.options.splice(index, 1); q.correct = q.correct.filter(n => n !== index).map(n => n > index ? n - 1 : n); }
      if (action === 'apply-settings') {
        if (!['#all-duration', '#all-points', '#all-penalty'].every(selector => $(selector).reportValidity())) return;
        const d = draft.defaults;
        if (await confirmation('Apply settings to every question?', `${draft.questions.length} questions will use ${d.duration} seconds, +${d.points} for correct answers, and ${d.negative ? '−' + penaltyAmount(d) : '0'} for wrong answers. Individual settings will be replaced.`, 'Apply to all')) {
          draft.questions.forEach(question => Object.assign(question, d)); toast('Settings applied to every question.');
        }
      }
      if (action === 'color') draft.color = button.dataset.color;
      draftStorage.set(draftKey, draft); editor();
    }
    if (action === 'sound') { sound = !sound; if (sound) { audioContext ||= new AudioContext(); await audioContext.resume(); beep(); } renderLive(location.hash.startsWith('#/host/')); }
    if (action === 'copy-link') { const link = `${location.origin}/?pin=${live.pin}`; try { await navigator.clipboard.writeText(link); toast('Invite link copied. Send it to your crew!'); } catch { toast(`Invite your crew: ${link}`); } }
    if (action === 'remove-player') {
      const pin = live.pin, player = live.rankings.find(p => p.id === id);
      if (player && await confirmation(`Remove ${player.nickname}?`, 'Their seat, answers, and score will be removed from this game.', 'Remove player')) await api(`/rooms/${pin}/remove`, { method: 'POST', data: { playerId: id } });
    }
    if (action === 'next') await api(`/rooms/${live.pin}/next`, { method: 'POST', data: {} });
    if (action === 'end' && await confirmation('End this game?', 'The game will finish for everyone. Only completed rounds count toward the final scores.', 'End game')) await api(`/rooms/${live.pin}/end`, { method: 'POST', data: {} });
    if (action === 'answer-choice' && live?.phase === 'question' && !live.submitted && live.question.type === 'single' && !answering) {
      selected = [index]; answering = true; renderLive(false);
      try { await submitAnswer(); } finally { answering = false; if (live?.phase === 'question' && !live.submitted) renderLive(false); }
    }
    else if (action === 'answer-choice' && live?.phase === 'question' && !live.submitted && live.question.type === 'multiple') { selected = selected.includes(index) ? selected.filter(n => n !== index) : [...selected, index]; renderLive(false); }
    if (action === 'submit-answer') await submitAnswer();
    if (action === 'export') {
      const csvCell = value => '"' + String(value).replace(/^[=+@\-\t\r]/, "'$&").replace(/"/g, '""') + '"';
      const csv = ['Rank,Nickname,Points', ...live.rankings.map(p => [p.rank, p.nickname, p.score].map(csvCell).join(','))].join('\r\n');
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), a = document.createElement('a'); a.href = url; a.download = `soc-quiz-${live.pin}-results.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  } catch (error) { toast(error.message); } finally { button.disabled = false; }
});
window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', () => { if (draft) syncDraft(); });
try { admin = (await api('/auth')).admin; } catch { /* The route will show retryable errors. */ }
route();

import { randomInt, randomUUID, randomBytes } from 'node:crypto';
import { randomIdentity } from './identity.js';

export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const token = () => randomBytes(32).toString('hex');
export const QUESTION_PREVIEW_MS = 1500;
const fail = (condition, message) => { if (condition) throw new AppError(message); };

export function validateSettings(settings) {
  fail(!settings || typeof settings !== 'object', 'Question settings are required.');
  const { duration, points } = settings, penalty = settings.penalty ?? points;
  fail(!Number.isInteger(duration) || duration < 5 || duration > 300, 'Question duration must be 5–300 seconds.');
  fail(!Number.isInteger(points) || points < 0 || points > 10000, 'Points must be 0–10,000.');
  fail(!Number.isInteger(penalty) || penalty < 0 || penalty > 10000, 'Wrong-answer deduction must be 0–10,000.');
  fail(settings.penaltyMatchesPoints !== undefined && typeof settings.penaltyMatchesPoints !== 'boolean', 'Match penalty to points must be enabled or disabled.');
  return { duration, points, negative: settings.negative === true, penalty, penaltyMatchesPoints: settings.penaltyMatchesPoints === true };
}

export const penaltyAmount = question => question.penaltyMatchesPoints ? question.points : question.penalty ?? question.points;

export function validateMaxPlayers(value) {
  fail(!Number.isInteger(value) || value < 1 || value > 200, 'Player limit must be a whole number from 1 to 200.');
  return value;
}

export function validateSpeedBonus(value = { enabled: false, maxPercent: 50 }) {
  fail(!value || typeof value !== 'object' || Array.isArray(value), 'Speed bonus settings must be an object.');
  fail(typeof value.enabled !== 'boolean', 'Speed bonus must be enabled or disabled.');
  fail(!Number.isInteger(value.maxPercent) || value.maxPercent < 1 || value.maxPercent > 100, 'Maximum speed bonus must be 1–100%.');
  return { enabled: value.enabled, maxPercent: value.maxPercent };
}

const validateShuffle = value => { fail(typeof value !== 'boolean', 'Shuffle questions must be on or off.'); return value; };
const shuffle = items => { for (let i = items.length - 1; i > 0; i--) { const j = randomInt(i + 1); [items[i], items[j]] = [items[j], items[i]]; } };

export function validateQuiz(input) {
  fail(!input || typeof input !== 'object', 'A quiz is required.');
  const title = String(input.title ?? '').trim();
  fail(!title || title.length > 100, 'Give your quiz a title (1–100 characters).');
  fail(!Array.isArray(input.questions) || !input.questions.length || input.questions.length > 100, 'Add between 1 and 100 questions.');
  const questions = input.questions.map((q, i) => {
    fail(!q || typeof q !== 'object', `Question ${i + 1} is invalid.`);
    const text = String(q.text ?? '').trim();
    fail(!text || text.length > 500, `Question ${i + 1} needs text (up to 500 characters).`);
    fail(!['single', 'multiple'].includes(q.type), `Choose a question type for question ${i + 1}.`);
    fail(!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 6, `Question ${i + 1} needs 2–6 options.`);
    const options = q.options.map(o => String(o ?? '').trim());
    fail(options.some(o => !o || o.length > 200), `Fill in every option for question ${i + 1} (up to 200 characters).`);
    fail(new Set(options.map(o => o.toLowerCase())).size !== options.length, `Use distinct options for question ${i + 1}.`);
    fail(!Array.isArray(q.correct) || !q.correct.length || q.correct.some(n => !Number.isInteger(n) || n < 0 || n >= options.length) || new Set(q.correct).size !== q.correct.length, `Mark the correct answer(s) for question ${i + 1}.`);
    fail(q.type === 'single' && q.correct.length !== 1, `Question ${i + 1} must have exactly one correct answer.`);
    return { id: randomUUID(), text, type: q.type, options, correct: q.correct, ...validateSettings(q) };
  });
  return { title, description: String(input.description ?? '').trim().slice(0, 240), color: ['violet', 'pink', 'cyan', 'orange'].includes(input.color) ? input.color : 'violet', emoji: ['⚡', '🚀', '🧠', '🌍', '🎮', '✨', '📖', '🎵'].includes(input.emoji) ? input.emoji : '⚡', questions, defaults: validateSettings(input.defaults ?? questions[0]), maxPlayers: validateMaxPlayers(input.maxPlayers ?? 200), speedBonus: validateSpeedBonus(input.speedBonus), shuffleQuestions: validateShuffle(input.shuffleQuestions ?? false) };
}

export class Game {
  constructor(quiz, pin, { now = Date.now, schedule = setTimeout, cancel = clearTimeout, changed = () => {}, maxPlayers = quiz.maxPlayers ?? 200, shuffleQuestions = quiz.shuffleQuestions ?? false } = {}) {
    this.quiz = structuredClone(quiz); this.pin = pin; this.now = now; this.schedule = schedule; this.cancel = cancel; this.changed = changed;
    this.players = new Map(); this.phase = 'lobby'; this.index = -1; this.deadline = null; this.previewEndsAt = null; this.answers = new Map(); this.createdAt = now(); this.updatedAt = now();
    this.maxPlayers = validateMaxPlayers(maxPlayers); this.shuffleQuestions = validateShuffle(shuffleQuestions); this.revokedTokens = new Set(); this.joinSequence = 0;
    this.quiz.speedBonus = validateSpeedBonus(quiz.speedBonus); this.previousRankings = []; this.skipRestTime = false;
  }
  notify() { this.updatedAt = this.now(); this.changed(this); }
  join(nickname = '') {
    fail(this.phase !== 'lobby', 'This game has already started. Join the next one!');
    fail(typeof nickname !== 'string' || nickname.trim().length > 20, 'Choose a nickname with up to 20 characters.');
    nickname = nickname.trim();
    fail([...this.players.values()].some(p => p.nickname.toLowerCase() === nickname.toLowerCase()), 'That nickname is taken. Try another!');
    fail(this.players.size >= this.maxPlayers, `This room is full (${this.maxPlayers} players).`);
    const player = { id: randomUUID(), token: token(), ...randomIdentity(this.players, nickname), score: 0, joined: this.joinSequence++ };
    this.players.set(player.id, player); this.notify(); return player;
  }
  playerFor(secret) { return [...this.players.values()].find(p => p.token === secret); }
  setMaxPlayers(value) {
    fail(this.phase !== 'lobby', 'Change the player limit before starting the game.');
    validateMaxPlayers(value);
    fail(value < this.players.size, 'Remove players before lowering the limit below the current player count.');
    this.maxPlayers = value; this.notify();
  }
  setShuffleQuestions(value) {
    fail(this.phase !== 'lobby', 'Change the question order before starting the game.');
    this.shuffleQuestions = validateShuffle(value); this.notify();
  }
  setSkipRestTime(value) {
    fail(this.phase === 'finished', 'This game has already finished.');
    fail(typeof value !== 'boolean', 'Auto next question must be on or off.');
    this.skipRestTime = value;
    // Turning this on during a break continues the game immediately.
    if (!this.continueWithoutRest()) this.notify();
  }
  continueWithoutRest() {
    if (!this.skipRestTime || this.phase !== 'leaderboard') return false;
    // The final standings are a reveal the host triggers, even with auto next on.
    if (this.index + 1 >= this.quiz.questions.length || !this.players.size) return false;
    this.next();
    return true;
  }
  removePlayer(id) {
    fail(this.phase === 'finished', 'This game has already finished.');
    const player = this.players.get(id);
    fail(!player, 'Player not found.');
    this.revokedTokens.add(player.token); this.players.delete(id); this.answers.delete(id);
    if (this.phase === 'question' && this.answers.size === this.players.size) this.finishQuestion();
    else this.notify();
  }
  next() {
    fail(!['lobby', 'leaderboard'].includes(this.phase), 'Wait until this question is finished.');
    fail(!this.players.size, 'Wait for at least one player to join.');
    // Shuffling when the game starts gives every hosted session a fresh order.
    if (this.phase === 'lobby' && this.shuffleQuestions) shuffle(this.quiz.questions);
    if (this.index + 1 >= this.quiz.questions.length) { this.phase = 'finished'; this.notify(); return; }
    this.previousRankings = this.rankings();
    this.index++; this.answers.clear(); this.phase = 'preview';
    this.deadline = null;
    this.previewEndsAt = this.now() + QUESTION_PREVIEW_MS;
    const index = this.index;
    this.timer = this.schedule(() => this.startQuestion(index), QUESTION_PREVIEW_MS);
    this.notify();
  }
  startQuestion(index) {
    if (this.phase !== 'preview' || this.index !== index) return;
    this.cancel(this.timer);
    const remaining = this.previewEndsAt - this.now();
    if (remaining > 0) {
      this.timer = this.schedule(() => this.startQuestion(index), remaining);
      return;
    }
    this.phase = 'question'; this.previewEndsAt = null;
    // The full answer time (and speed-bonus window) starts when answers open,
    // even if the server's preview timer was delayed.
    const duration = this.quiz.questions[index].duration * 1000;
    this.deadline = this.now() + duration;
    this.timer = this.schedule(() => { if (this.index === index) this.finishQuestion(); }, duration);
    this.notify();
  }
  answer(player, choices, questionIndex) {
    const receivedAt = this.now();
    if (this.phase === 'preview' && receivedAt >= this.previewEndsAt) this.startQuestion(this.index);
    if (this.phase === 'question' && receivedAt >= this.deadline) this.finishQuestion();
    fail(this.phase === 'preview', 'Read the question first. Answers open after the 1.5-second preview.');
    fail(this.phase !== 'question', 'This question has ended.');
    fail(questionIndex !== this.index, 'That answer belongs to an earlier question.');
    fail(!player || !this.players.has(player.id), 'Join this room first.');
    fail(this.answers.has(player.id), 'Your answer is already locked in.');
    const q = this.quiz.questions[this.index];
    fail(!Array.isArray(choices) || !choices.length || choices.some(n => !Number.isInteger(n) || n < 0 || n >= q.options.length) || new Set(choices).size !== choices.length, 'Choose valid answers.');
    fail(q.type === 'single' && choices.length !== 1, 'Choose one answer.');
    const correct = choices.length === q.correct.length && choices.every(n => q.correct.includes(n));
    const basePoints = correct ? q.points : q.negative ? -penaltyAmount(q) : 0;
    const remainingFraction = Math.max(0, Math.min(1, (this.deadline - receivedAt) / (q.duration * 1000)));
    const bonus = correct && this.quiz.speedBonus.enabled ? Math.floor(q.points * this.quiz.speedBonus.maxPercent / 100 * remainingFraction) : 0;
    this.answers.set(player.id, { choices, correct, basePoints, bonus, delta: basePoints + bonus });
    if (this.answers.size === this.players.size) this.finishQuestion(); else this.notify();
  }
  finishQuestion() {
    if (this.phase !== 'question') return;
    this.cancel(this.timer); this.phase = 'leaderboard';
    // With deductions on, giving no answer costs the same as a wrong answer.
    for (const [id, player] of this.players) player.score += this.answers.get(id)?.delta ?? this.missedDelta();
    // Publish the next question with the completed scores in one update,
    // so players do not briefly see a result screen between questions.
    if (!this.continueWithoutRest()) this.notify();
  }
  missedDelta() { const q = this.quiz.questions[this.index]; return q?.negative ? -penaltyAmount(q) : 0; }
  end() { this.cancel(this.timer); this.previewEndsAt = null; this.phase = 'finished'; this.notify(); }
  rankings() {
    const sorted = [...this.players.values()].sort((a, b) => b.score - a.score || a.joined - b.joined);
    return sorted.map(p => ({ id: p.id, nickname: p.nickname, appearance: p.appearance, score: p.score, rank: sorted.findIndex(other => other.score === p.score) + 1 }));
  }
  snapshot(player = null, host = false) {
    if (this.phase === 'preview' && this.now() >= this.previewEndsAt) this.startQuestion(this.index);
    if (this.phase === 'question' && this.now() >= this.deadline) this.finishQuestion();
    const q = this.quiz.questions[this.index];
    const revealed = ['leaderboard', 'finished'].includes(this.phase);
    const rankings = this.rankings();
    const ownAnswer = player && this.answers.get(player.id);
    return {
      pin: this.pin, title: this.quiz.title, phase: this.phase, index: this.index, total: this.quiz.questions.length,
      serverTime: this.now(), deadline: this.deadline, answered: this.answers.size, playerCount: this.players.size, maxPlayers: this.maxPlayers, shuffleQuestions: this.shuffleQuestions, skipRestTime: this.skipRestTime, rankings,
      previewEndsAt: this.previewEndsAt, previewDuration: QUESTION_PREVIEW_MS,
      speedBonus: this.quiz.speedBonus, previousRankings: revealed ? this.previousRankings.filter(p => this.players.has(p.id)) : [],
      me: player ? { id: player.id, nickname: player.nickname, appearance: player.appearance, score: player.score } : null,
      question: q ? { text: q.text, type: q.type, options: this.phase === 'preview' ? [] : q.options, duration: q.duration, points: q.points, negative: q.negative, penalty: penaltyAmount(q), penaltyMatchesPoints: q.penaltyMatchesPoints === true, ...(revealed ? { correct: q.correct } : {}) } : null,
      submitted: !!ownAnswer, choices: ownAnswer?.choices ?? [],
      result: revealed && player ? ownAnswer ?? { choices: [], correct: false, basePoints: this.missedDelta(), bonus: 0, delta: this.missedDelta(), missed: true } : null,
      distribution: host && revealed && q ? q.options.map((_, i) => [...this.answers.values()].filter(a => a.choices.includes(i)).length) : null
    };
  }
}

export function createPin(rooms) {
  let pin;
  do { pin = Array.from({ length: 6 }, () => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'[randomInt(26)]).join(''); } while (rooms.has(pin));
  return pin;
}

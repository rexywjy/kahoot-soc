import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, AppError, QUESTION_PREVIEW_MS, createPin, validateQuiz } from '../lib/game.js';

const question = (overrides = {}) => ({ text: 'Which answers?', type: 'single', options: ['A', 'B', 'C'], correct: [0], duration: 10, points: 100, negative: false, ...overrides });
const quiz = (...questions) => ({ title: 'Test quiz', questions: questions.length ? questions : [question()] });
function room(...questions) {
  let now = 1000, callback;
  const game = new Game(quiz(...questions), 'ABCDEF', { now: () => now, schedule: fn => { callback = fn; }, cancel: () => {} });
  return { game, expire: () => { now += 10000; callback(); }, advance: ms => { now += ms; } };
}
// Starts the next question and skips its read-only preview so answers are open.
function start(game) {
  game.next();
  if (game.phase === 'preview') { game.previewEndsAt = game.now(); game.startQuestion(game.index); }
}

test('quiz validation checks answer cardinality, options, numeric bounds and normalization', () => {
  assert.equal(validateQuiz({ ...quiz(), title: '  Hello  ' }).title, 'Hello');
  for (const overrides of [{ correct: [] }, { correct: [0, 1] }, { correct: [99] }, { correct: [0, 0] }, { options: ['a', ' A '] }, { duration: 0 }, { duration: 301 }, { points: -1 }, { points: '100' }, { text: '' }, { options: ['a'] }]) {
    assert.throws(() => validateQuiz(quiz(question(overrides))), AppError);
  }
  assert.doesNotThrow(() => validateQuiz(quiz(question({ type: 'multiple', correct: [0, 1], points: 0 }))));
});

test('PINs are six uppercase letters and unique among existing rooms', () => {
  const rooms = new Map(); for (let i = 0; i < 2000; i++) { const pin = createPin(rooms); assert.match(pin, /^[A-Z]{6}$/); assert.ok(!rooms.has(pin)); rooms.set(pin, true); }
});

test('lobby rejects duplicate nicknames and joining after start', () => {
  const { game } = room(); assert.throws(() => game.next(), /at least one/);
  game.join(' Nova '); assert.throws(() => game.join('nova'), /taken/); assert.throws(() => game.join(123), /nickname/);
  start(game); assert.throws(() => game.join('Other'), /already started/);
});

test('all submissions end the round; scores and correct answers remain hidden until then', () => {
  const { game } = room(); const a = game.join('A'), b = game.join('B'); start(game);
  assert.equal(game.snapshot(a).question.correct, undefined); assert.equal(game.snapshot(null, true).question.correct, undefined);
  game.answer(a, [0], 0); assert.equal(game.phase, 'question'); assert.equal(a.score, 0); assert.equal(game.snapshot(a).result, null);
  assert.throws(() => game.answer(a, [1], 0), /already locked/);
  game.answer(b, [1], 0); assert.equal(game.phase, 'leaderboard'); assert.equal(a.score, 100); assert.equal(b.score, 0);
  assert.deepEqual(game.snapshot(a).question.correct, [0]); game.finishQuestion(); assert.equal(a.score, 100);
  start(game); assert.equal(game.phase, 'finished'); assert.throws(() => game.next());
});

test('multi-answer scoring requires the exact set, independent of order', () => {
  const { game } = room(question({ type: 'multiple', correct: [0, 2], negative: true }));
  const a = game.join('A'), b = game.join('B'), c = game.join('C'); start(game);
  game.answer(a, [2, 0], 0); game.answer(b, [0], 0); game.answer(c, [0, 1, 2], 0);
  assert.equal(a.score, 100); assert.equal(b.score, -100); assert.equal(c.score, -100);
  assert.equal(game.snapshot(b).result.delta, -100);
});

test('timer ends unanswered rounds; with deductions on, missing answers cost the same as wrong ones', () => {
  const { game, expire } = room(question({ negative: true }), question()); const a = game.join('A'), b = game.join('B'); start(game); game.answer(a, [2], 0); expire();
  assert.equal(game.phase, 'leaderboard'); assert.equal(a.score, -100); assert.equal(b.score, -100);
  assert.deepEqual(game.snapshot(b).result, { choices: [], correct: false, basePoints: -100, bonus: 0, delta: -100, missed: true });
  assert.throws(() => game.answer(b, [0], 0), /ended/);
  start(game); expire();
  assert.equal(b.score, -100, 'no deduction when the setting is off'); assert.equal(game.snapshot(b).result.delta, 0);
  start(game); assert.equal(game.phase, 'finished');
});

test('each question opens with a preview: options hidden, answers rejected, then the full timer starts', () => {
  const { game, advance } = room(); const p = game.join('A'); game.next();
  const preview = game.snapshot(p);
  assert.equal(preview.phase, 'preview'); assert.deepEqual(preview.question.options, []); assert.equal(preview.deadline, null);
  assert.equal(preview.previewEndsAt - preview.serverTime, QUESTION_PREVIEW_MS);
  advance(QUESTION_PREVIEW_MS - 1); assert.throws(() => game.answer(p, [0], 0), /preview/);
  advance(1); const open = game.snapshot(p);
  assert.equal(open.phase, 'question'); assert.deepEqual(open.question.options, ['A', 'B', 'C']); assert.equal(open.deadline - open.serverTime, 10000);
  game.answer(p, [0], 0); assert.equal(p.score, 100);
});

test('ending a game mid-question does not deduct for missing answers', () => {
  const { game } = room(question({ negative: true })); const a = game.join('A'); start(game); game.end();
  assert.equal(a.score, 0);
});

test('late answers are rejected even if the scheduled timer has not fired', () => {
  const { game, advance } = room(); const p = game.join('A'); start(game); advance(10000);
  assert.throws(() => game.answer(p, [0], 0), /ended/); assert.equal(game.phase, 'leaderboard'); assert.equal(p.score, 0);
});

test('replayed answers from previous rounds and malformed answers cannot earn points', () => {
  const { game } = room(question(), question()); const p = game.join('A'); start(game);
  for (const choices of [[], [0, 0], [99], ['0'], [0, 1]]) assert.throws(() => game.answer(p, choices, 0));
  game.answer(p, [0], 0); start(game); assert.throws(() => game.answer(p, [0], 0), /earlier/); assert.equal(game.answers.size, 0);
  game.answer(p, [0], 1); assert.equal(p.score, 200);
});

test('snapshots never expose player tokens and ties share a rank', () => {
  const { game } = room(); const a = game.join('A'), b = game.join('B'), c = game.join('C'); start(game);
  game.answer(a, [0], 0); game.answer(b, [0], 0); game.answer(c, [2], 0);
  const snapshot = game.snapshot(a, false); assert.deepEqual(snapshot.rankings.map(p => p.rank), [1, 1, 3]);
  assert.ok(!JSON.stringify(snapshot).includes(a.token)); assert.ok(!JSON.stringify(snapshot).includes(b.token));
  assert.equal(game.playerFor(a.token), a);
});

test('a hosted quiz is a frozen copy and ending early keeps completed scores only', () => {
  const original = quiz(question()); const game = new Game(original, 'ABCDEF');
  original.questions[0].correct = [1]; const a = game.join('A'), b = game.join('B'); start(game); game.answer(a, [0], 0); game.end();
  assert.equal(a.score, 0); assert.equal(b.score, 0); assert.deepEqual(game.quiz.questions[0].correct, [0]); assert.equal(game.phase, 'finished');
});

test('quiz-wide defaults, player limits and custom penalties are validated and preserved', () => {
  const defaults = { duration: 40, points: 1000, negative: true, penalty: 250 };
  const saved = validateQuiz({ ...quiz(question({ penalty: 25 })), defaults, maxPlayers: 40 });
  assert.deepEqual(saved.defaults, { ...defaults, penaltyMatchesPoints: false }); assert.equal(saved.maxPlayers, 40); assert.equal(saved.questions[0].penalty, 25);
  assert.equal(validateQuiz(quiz(question({ negative: true }))).questions[0].penalty, 100);
  for (const penalty of [-1, 10001, '250', 0.5]) assert.throws(() => validateQuiz(quiz(question({ penalty }))));
  for (const maxPlayers of [0, 201, '20', 1.5]) assert.throws(() => validateQuiz({ ...quiz(), maxPlayers }));
  assert.throws(() => validateQuiz({ ...quiz(), defaults: { ...defaults, duration: 0 } }));
});

test('wrong answers deduct the configured amount, independent of correct-answer points', () => {
  const { game } = room(question({ points: 1000, negative: true, penalty: 250 }));
  const a = game.join(), b = game.join(); start(game); game.answer(a, [0], 0); game.answer(b, [1], 0);
  assert.equal(a.score, 1000); assert.equal(b.score, -250); assert.equal(game.snapshot(b).question.penalty, 250);
});

test('matched deductions persist and follow base points instead of custom deductions or speed bonuses', () => {
  const settings = { duration: 15, points: 100, negative: true, penalty: 25, penaltyMatchesPoints: true };
  const saved = validateQuiz({ ...quiz(question(settings)), defaults: settings, speedBonus: { enabled: true, maxPercent: 50 } });
  assert.deepEqual(saved.defaults, settings); assert.equal(saved.questions[0].penaltyMatchesPoints, true);
  saved.questions[0].points = 200;
  const game = new Game(saved, 'ABCDEF', { now: () => 1000, schedule: () => {}, cancel: () => {} });
  const right = game.join(), wrong = game.join(); start(game);
  assert.equal(game.snapshot(wrong).question.penalty, 200);
  game.answer(right, [0], 0); game.answer(wrong, [1], 0);
  assert.equal(right.score, 300); assert.equal(wrong.score, -200);
  assert.equal(game.snapshot(wrong).result.bonus, 0);
  assert.throws(() => validateQuiz(quiz(question({ penaltyMatchesPoints: 'true' }))), /Match penalty/);
});

test('matched deductions respect the penalty toggle and allow zero base points', () => {
  for (const overrides of [{ points: 100, negative: false }, { points: 0, negative: true }]) {
    const { game } = room(question({ ...overrides, penalty: 25, penaltyMatchesPoints: true }));
    const p = game.join(); start(game); game.answer(p, [1], 0); assert.equal(p.score, 0);
  }
});

test('a full room has distinct random names, icons and colors stable across rankings', () => {
  const { game } = room();
  const players = Array.from({ length: 200 }, () => game.join());
  assert.equal(new Set(players.map(p => p.nickname)).size, 200);
  assert.equal(new Set(players.map(p => p.appearance.icon)).size, 200);
  assert.equal(new Set(players.map(p => p.appearance.hue)).size, 200);
  for (const a of players.slice(0, 4)) for (const b of players.slice(0, 4)) if (a !== b) {
    const distance = Math.abs(a.appearance.hue - b.appearance.hue);
    assert.ok(Math.min(distance, 360 - distance) >= 89.9);
  }
  assert.ok(players.every(p => p.nickname.length <= 20));
  assert.throws(() => game.join(), /full/);
  const first = structuredClone(players[0].appearance); players[0].score = 500;
  assert.deepEqual(game.snapshot(players[0]).rankings[0].appearance, first);
  assert.deepEqual(game.snapshot(players[0]).me.appearance, first);
  game.removePlayer(players[1].id); game.join('');
  assert.equal(new Set([...game.players.values()].map(p => p.appearance.icon)).size, 200);
});

test('host capacity changes respect joined players and lock after starting', () => {
  const { game } = room(); game.setMaxPlayers(2);
  game.join(); game.join(); assert.throws(() => game.join(), /full/);
  assert.throws(() => game.setMaxPlayers(1), /Remove players/);
  for (const limit of [0, 201, 2.5]) assert.throws(() => game.setMaxPlayers(limit));
  game.setMaxPlayers(3); game.join(); assert.equal(game.snapshot(null, true).maxPlayers, 3);
  start(game); assert.throws(() => game.setMaxPlayers(4), /before starting/); game.end();
});

test('removing a waiting player revokes their token and completes an answered round', () => {
  const { game } = room(); const a = game.join(), b = game.join(); start(game); game.answer(a, [0], 0);
  game.removePlayer(b.id); assert.equal(game.phase, 'leaderboard'); assert.equal(a.score, 100);
  assert.ok(game.revokedTokens.has(b.token)); assert.equal(game.playerFor(b.token), undefined);
  assert.equal(game.snapshot(a).playerCount, 1); assert.throws(() => game.removePlayer(b.id), /not found/);
});

test('removing a submitted player discards their answer and removing everyone safely ends a round', () => {
  const { game } = room(); const a = game.join(), b = game.join(); start(game); game.answer(a, [0], 0);
  game.removePlayer(a.id); assert.equal(game.phase, 'question'); assert.equal(game.answers.size, 0);
  game.removePlayer(b.id); assert.equal(game.phase, 'leaderboard'); assert.equal(game.snapshot().rankings.length, 0);
  game.end(); assert.throws(() => game.removePlayer(a.id), /finished/);
});

test('speed bonus is opt-in, validates its percentage, and is frozen for a hosted game', () => {
  assert.deepEqual(validateQuiz(quiz()).speedBonus, { enabled: false, maxPercent: 50 });
  for (const speedBonus of [null, true, [], { enabled: 'true', maxPercent: 50 }, { enabled: true, maxPercent: 0 }, { enabled: false, maxPercent: 101 }, { enabled: true, maxPercent: 1.5 }]) {
    assert.throws(() => validateQuiz({ ...quiz(), speedBonus }), /Speed bonus|speed bonus/);
  }
  const original = { ...quiz(), speedBonus: { enabled: true, maxPercent: 25 } };
  const game = new Game(original, 'ABCDEF'); original.speedBonus.maxPercent = 100;
  assert.deepEqual(game.snapshot().speedBonus, { enabled: true, maxPercent: 25 });
});

function speedRoom(settings = { enabled: true, maxPercent: 50 }, overrides = {}) {
  let now = 1000;
  const game = new Game({ ...quiz(question({ points: 1000, negative: true, penalty: 250, ...overrides })), speedBonus: settings }, 'ABCDEF', { now: () => now, schedule: () => {}, cancel: () => {} });
  return { game, advance: ms => { now += ms; } };
}

test('speed bonus follows server receipt time and decreases to zero, with exact integer breakdowns', () => {
  const { game, advance } = speedRoom();
  const fast = game.join('Fast'), middle = game.join('Middle'), last = game.join('Last'), wrong = game.join('Wrong'), missed = game.join('Missed');
  start(game); game.answer(fast, [0], 0); game.answer(wrong, [1], 0);
  assert.equal(game.snapshot(fast).result, null); assert.equal(fast.score, 0);
  advance(5000); game.answer(middle, [0], 0); advance(4999); game.answer(last, [0], 0);
  advance(1); assert.throws(() => game.answer(missed, [0], 0), /ended/);
  assert.deepEqual([fast.score, middle.score, last.score, wrong.score, missed.score], [1500, 1250, 1000, -250, -250]);
  assert.equal(game.snapshot(middle).result.basePoints, 1000); assert.equal(game.snapshot(middle).result.bonus, 250);
  assert.equal(game.snapshot(wrong).result.bonus, 0); assert.equal(game.snapshot(missed).result.bonus, 0);
  assert.throws(() => game.answer(fast, [0], 0), /ended/); assert.equal(fast.score, 1500);
});

test('disabled speed bonuses preserve equal scores at different response times', () => {
  const { game, advance } = speedRoom({ enabled: false, maxPercent: 100 });
  const a = game.join(), b = game.join(); start(game); game.answer(a, [0], 0); advance(9000); game.answer(b, [0], 0);
  assert.equal(a.score, 1000); assert.equal(b.score, 1000); assert.equal(game.snapshot(a).result.bonus, 0);
});

test('speed bonus respects exact-set answers, zero points, and whole-point rounding', () => {
  const { game, advance } = speedRoom({ enabled: true, maxPercent: 25 }, { type: 'multiple', correct: [0, 2], points: 101 });
  const a = game.join(), b = game.join(); start(game); advance(5000); game.answer(a, [2, 0], 0); game.answer(b, [0], 0);
  assert.equal(a.score, 113); assert.equal(game.snapshot(a).result.bonus, 12); assert.equal(b.score, -250);
  const zero = speedRoom({ enabled: true, maxPercent: 100 }, { points: 0 }).game;
  const p = zero.join(); start(zero); zero.answer(p, [0], 0); assert.equal(p.score, 0);
});

test('previous standings preserve stable IDs, positions and scores across rounds for animations', () => {
  const { game } = room(question(), question({ points: 200 })); const a = game.join('A'), b = game.join('B');
  start(game); game.answer(a, [0], 0); game.answer(b, [1], 0);
  const first = game.snapshot(a); assert.deepEqual(first.previousRankings.map(p => p.score), [0, 0]);
  start(game); assert.deepEqual(game.snapshot(a).previousRankings, []);
  game.answer(a, [1], 1); game.answer(b, [0], 1);
  const second = game.snapshot(a); assert.deepEqual(second.rankings.map(p => p.id), [b.id, a.id]);
  assert.deepEqual(second.previousRankings.map(p => [p.id, p.score, p.rank]), [[a.id, 100, 1], [b.id, 0, 2]]);
  assert.ok(!JSON.stringify(second.previousRankings).includes(a.token));
  game.removePlayer(a.id); assert.deepEqual(game.snapshot(b).previousRankings.map(p => p.id), [b.id]);
});

test('question shuffling is a validated quiz default the host can change in the lobby, applied once at start', () => {
  assert.equal(validateQuiz(quiz()).shuffleQuestions, false);
  assert.equal(validateQuiz({ ...quiz(), shuffleQuestions: true }).shuffleQuestions, true);
  assert.throws(() => validateQuiz({ ...quiz(), shuffleQuestions: 'yes' }), /Shuffle/);
  const texts = Array.from({ length: 30 }, (_, i) => `Q${i}`), original = { ...quiz(...texts.map(text => question({ text }))), shuffleQuestions: true };
  const order = game => game.quiz.questions.map(q => q.text);
  const plain = new Game(original, 'ABCDEF', { schedule: () => {}, cancel: () => {} });
  plain.setShuffleQuestions(false); plain.join('A'); start(plain);
  assert.deepEqual(order(plain), texts);
  assert.throws(() => plain.setShuffleQuestions(true), /before starting/);
  const shuffled = new Game(original, 'ABCDEG', { schedule: () => {}, cancel: () => {} });
  assert.equal(shuffled.snapshot().shuffleQuestions, true);
  shuffled.join('A'); start(shuffled);
  const first = order(shuffled), current = shuffled.snapshot(null, true).question.text;
  assert.notDeepEqual(first, texts);
  assert.deepEqual([...first].sort(), [...texts].sort());
  assert.equal(current, first[0]);
  shuffled.finishQuestion(); start(shuffled);
  assert.deepEqual(order(shuffled), first, 'order stays fixed after the game starts');
  assert.deepEqual(original.questions.map(q => q.text), texts, 'the saved quiz is untouched');
});

test('auto next continues between rounds but waits for the host to reveal the final standings', () => {
  const { game } = room(question(), question()); const p = game.join('A');
  game.setSkipRestTime(true); start(game); game.answer(p, [0], 0);
  assert.equal(game.phase, 'preview'); assert.equal(game.index, 1); assert.equal(p.score, 100);
  game.previewEndsAt = game.now(); game.startQuestion(1); game.answer(p, [0], 1);
  assert.equal(game.phase, 'leaderboard'); assert.equal(p.score, 200);
  game.setSkipRestTime(false); game.setSkipRestTime(true); assert.equal(game.phase, 'leaderboard');
  game.next(); assert.equal(game.phase, 'finished');
});

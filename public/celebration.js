const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const shownBoards = new Map();
const stoppedCelebrations = new Set();
const rowAnimations = new Set();
let scoreFrame = 0, confettiFrame = 0, burstTimer = 0, canvas = null, particles = [], animatedList = null;

function stopRows() {
  for (const animation of rowAnimations) animation.cancel();
  rowAnimations.clear(); cancelAnimationFrame(scoreFrame);
  for (const score of document.querySelectorAll('.leaderboard-score')) {
    score.textContent = Number(score.dataset.score).toLocaleString();
    score.dataset.displayScore = score.dataset.score;
  }
}
function stopConfetti() {
  clearInterval(burstTimer); cancelAnimationFrame(confettiFrame);
  burstTimer = 0; confettiFrame = 0; canvas?.remove(); canvas = null; particles = [];
}
export function stopCelebration(pin) { stoppedCelebrations.add(pin); stopConfetti(); }
export function resetCelebrations() { stopRows(); stopConfetti(); }
reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) resetCelebrations(); });
window.addEventListener('pagehide', resetCelebrations);

// Measure before replacing the screen, so live removals can move from the
// currently visible positions, including an animation already in progress.
export function captureLeaderboard() {
  const list = document.querySelector('.leaderboard-list');
  if (!list) return new Map();
  const top = list.getBoundingClientRect().top;
  return new Map([...list.children].map(row => [row.dataset.playerId, {
    top: row.getBoundingClientRect().top - top,
    score: Number(row.querySelector('.leaderboard-score').dataset.displayScore),
  }]));
}

export function presentLeaderboard(state, positions = new Map(), confetti = true) {
  const list = document.querySelector('.leaderboard-list');
  // Standings only change between rounds, so a phase change alone does not
  // replay the reorder (for example the host's side panel during a question).
  const signature = JSON.stringify(state.rankings.map(p => [p.id, p.score, p.rank]));
  const isNew = shownBoards.get(state.pin) !== signature;
  shownBoards.set(state.pin, signature);
  // Updates that keep the same list on screen let a running reorder finish.
  if (isNew || !list || list !== animatedList) {
    stopRows(); animatedList = null;
    if (isNew && list && !reducedMotion.matches) animateRows(state, positions);
  }
  if (confetti && state.phase === 'finished' && state.rankings.length && !stoppedCelebrations.has(state.pin)) celebrate();
  else stopConfetti();
}

function animateRows(state, positions) {
  const list = document.querySelector('.leaderboard-list');
  animatedList = list;
  const rows = new Map([...list.children].map(row => [row.dataset.playerId, row]));
  const top = list.getBoundingClientRect().top;
  const measurements = new Map([...rows].map(([id, row]) => [id, { top: row.getBoundingClientRect().top - top, height: row.getBoundingClientRect().height }]));
  if (!positions.size && state.phase === 'leaderboard') {
    // The question screen has no rows to measure. Reconstruct the old order
    // using server-provided standings from before this round.
    let y = 0;
    const gap = parseFloat(getComputedStyle(list).rowGap) || 0;
    for (const player of state.previousRankings ?? []) {
      const measure = measurements.get(player.id); if (!measure) continue;
      positions.set(player.id, { top: y, score: player.score }); y += measure.height + gap;
    }
  }
  const counters = [];
  for (const [id, row] of rows) {
    const before = positions.get(id), after = measurements.get(id);
    if (!before) continue;
    const distance = before.top - after.top;
    if (Math.abs(distance) > 1) {
      // A player who climbs lifts out of the list and passes over the rows
      // they overtake, which dip back while being passed.
      const climbing = distance > 0, timing = { duration: 1200, delay: 300 };
      row.style.zIndex = climbing ? 2 : 1;
      const move = row.animate([{ translate: `0 ${distance}px` }, { translate: '0 0' }], { ...timing, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'backwards' });
      const shadow = getComputedStyle(row).boxShadow;
      const lift = row.animate(climbing
        ? [{ scale: 1, boxShadow: shadow }, { scale: 1.06, boxShadow: '0 16px 34px rgb(30 10 80 / .28)', offset: .5 }, { scale: 1, boxShadow: shadow }]
        : [{ scale: 1, opacity: 1 }, { scale: .95, opacity: .65, offset: .5 }, { scale: 1, opacity: 1 }], { ...timing, easing: 'ease-in-out' });
      for (const animation of [move, lift]) {
        rowAnimations.add(animation);
        animation.onfinish = animation.oncancel = () => { rowAnimations.delete(animation); if (animation === move) row.style.zIndex = ''; };
      }
    }
    const score = row.querySelector('.leaderboard-score'), target = Number(score.dataset.score);
    if (before.score !== target) {
      score.textContent = before.score.toLocaleString(); score.dataset.displayScore = before.score;
      counters.push({ element: score, from: before.score, to: target });
    }
  }
  if (!counters.length) return;
  const start = performance.now();
  const tick = now => {
    const progress = Math.min(1, Math.max(0, (now - start - 300) / 1200)), eased = 1 - (1 - progress) ** 3;
    for (const counter of counters) {
      const value = Math.round(counter.from + (counter.to - counter.from) * eased);
      counter.element.textContent = value.toLocaleString(); counter.element.dataset.displayScore = value;
    }
    if (progress < 1) scoreFrame = requestAnimationFrame(tick);
  };
  scoreFrame = requestAnimationFrame(tick);
}

// While the final leaderboard is on screen, confetti cannons on the left and
// right edges fire a burst immediately and then every 5 seconds.
function celebrate() {
  if (canvas || reducedMotion.matches) return;
  canvas = document.createElement('canvas'); canvas.className = 'confetti-canvas'; canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d'); if (!ctx) { canvas = null; return; }
  document.body.append(canvas);
  const palette = ['#713cf3', '#ff81b8', '#b1e45b', '#ffbc57', '#53c9bc', '#bba0ff'];
  let width = 0, height = 0, previous = 0;
  const resize = () => {
    if (width === innerWidth && height === innerHeight) return;
    width = innerWidth; height = innerHeight; const scale = Math.min(devicePixelRatio || 1, 2);
    canvas.width = width * scale; canvas.height = height * scale; ctx.setTransform(scale, 0, 0, scale, 0, 0);
  };
  const burst = () => {
    if (!canvas) return;
    resize();
    const count = width < 600 ? 60 : 110;
    for (const side of [-1, 1]) {
      for (let i = 0; i < count; i++) particles.push({
        x: side < 0 ? -10 : width + 10, y: height * (.6 + Math.random() * .3),
        vx: -side * width * (.25 + Math.random() * .45), vy: -height * (.85 + Math.random() * .7),
        angle: Math.random() * 6.28, spin: (Math.random() - .5) * 12, wobble: Math.random() * 6.28, age: 0, life: 4 + Math.random() * 2,
        width: 5 + Math.random() * 7, height: 4 + Math.random() * 5, color: palette[Math.floor(Math.random() * palette.length)],
      });
    }
    if (!confettiFrame) { previous = performance.now(); confettiFrame = requestAnimationFrame(draw); }
  };
  const draw = now => {
    if (!canvas) return;
    if (reducedMotion.matches) { stopConfetti(); return; }
    resize();
    const dt = Math.min((now - previous) / 1000, .05); previous = now;
    ctx.clearRect(0, 0, width, height);
    particles = particles.filter(p => p.age < p.life && p.y < height + 30);
    for (const p of particles) {
      p.age += dt; p.vx *= Math.exp(-1.6 * dt); p.vy = Math.min(p.vy + height * 1.6 * dt, height * .3);
      p.wobble += dt * 4; p.x += (p.vx + Math.sin(p.wobble) * 40) * dt; p.y += p.vy * dt; p.angle += p.spin * dt;
      ctx.save(); ctx.globalAlpha = Math.min(1, (p.life - p.age) / .8); ctx.translate(p.x, p.y);
      ctx.rotate(p.angle); ctx.fillStyle = p.color;
      ctx.fillRect(-p.width / 2, -p.height / 2, p.width, p.height); ctx.restore();
    }
    confettiFrame = particles.length ? requestAnimationFrame(draw) : 0;
  };
  burst(); burstTimer = setInterval(burst, 5000);
}

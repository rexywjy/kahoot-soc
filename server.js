import http from 'node:http';
import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { AppError, Game, createPin, token, validateQuiz } from './lib/game.js';
import { starterQuiz } from './lib/seed.js';

const root = path.dirname(fileURLToPath(import.meta.url));
export async function createApp({ dataDir = path.join(root, 'data'), password = token().slice(0, 16), now = Date.now } = {}) {
  await mkdir(dataDir, { recursive: true });
  const quizFile = path.join(dataDir, 'quizzes.json');
  let quizzes;
  try { quizzes = JSON.parse(await readFile(quizFile, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; quizzes = [{ ...starterQuiz, updatedAt: new Date().toISOString() }]; }
  let writes = Promise.resolve();
  const persist = () => {
    const data = JSON.stringify(quizzes, null, 2);
    const write = writes.catch(() => {}).then(async () => { await writeFile(quizFile + '.tmp', data); await rename(quizFile + '.tmp', quizFile); });
    writes = write; return write;
  };
  await persist();
  const rooms = new Map(), sessions = new Map(), limits = new Map(), streams = new Set();
  const digest = s => createHash('sha256').update(s).digest();
  const sessionId = req => /(?:^|; )soc_quiz_admin=([a-f0-9]+)/.exec(req.headers.cookie ?? '')?.[1];
  const isAdmin = req => (sessions.get(sessionId(req)) ?? 0) > now();
  const admin = req => { if (!isAdmin(req)) throw new AppError('Sign in as admin to continue.', 401); };
  const send = (res, data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  const broadcast = game => {
    for (const stream of streams) if (stream.pin === game.pin) {
      if (stream.player && !game.players.has(stream.player.id)) {
        stream.res.write('event: removed\ndata: {"message":"The host removed you from this game."}\n\n');
        stream.res.end(); streams.delete(stream); continue;
      }
      if (stream.host && (sessions.get(stream.session) ?? 0) <= now()) { stream.res.end(); streams.delete(stream); continue; }
      stream.res.write(`data: ${JSON.stringify(game.snapshot(stream.player, stream.host))}\n\n`);
    }
  };
  const rateLimit = (req, category, maximum) => {
    const key = category + req.socket.remoteAddress, old = limits.get(key), limit = old && old.until > now() ? old : { count: 0, until: now() + 60000 };
    limit.count++; limits.set(key, limit);
    if (limit.count > maximum) throw new AppError('Too many attempts. Try again in a minute.', 429);
  };
  async function body(req) {
    const chunks = []; let length = 0;
    for await (const chunk of req) { length += chunk.length; if (length > 250000) throw new AppError('Request is too large.', 413); chunks.push(chunk); }
    try { const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error(); return parsed; } catch { throw new AppError('Invalid JSON request.'); }
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost'), route = url.pathname, method = req.method;
      if (!['GET', 'HEAD'].includes(method)) {
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw new AppError('Cross-origin requests are not allowed.', 403);
        if (!req.headers['content-type']?.startsWith('application/json')) throw new AppError('Use application/json.', 415);
      }
      if (route === '/api/auth' && method === 'GET') return send(res, { admin: isAdmin(req) });
      if (route === '/api/login' && method === 'POST') {
        rateLimit(req, 'login', 10); const input = await body(req);
        if (typeof input.password !== 'string' || !timingSafeEqual(digest(input.password), digest(password))) throw new AppError('That admin password is incorrect.', 401);
        const secret = token(); sessions.set(secret, now() + 12 * 3600000);
        res.setHeader('Set-Cookie', `soc_quiz_admin=${secret}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`);
        return send(res, { ok: true });
      }
      if (route === '/api/logout' && method === 'POST') {
        const id = sessionId(req); sessions.delete(id);
        for (const stream of streams) if (stream.session === id) { stream.res.end(); streams.delete(stream); }
        res.setHeader('Set-Cookie', 'soc_quiz_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'); return send(res, { ok: true });
      }
      if (route === '/api/quizzes') {
        admin(req);
        if (method === 'GET') return send(res, { quizzes, rooms: [...rooms.values()].filter(r => r.phase !== 'finished').map(r => ({ pin: r.pin, title: r.quiz.title, phase: r.phase, players: r.players.size })) });
        if (method === 'POST') { const quiz = { ...validateQuiz(await body(req)), id: randomUUID(), updatedAt: new Date().toISOString() }; quizzes.push(quiz); await persist(); return send(res, quiz, 201); }
      }
      const quizRoute = /^\/api\/quizzes\/([^/]+)$/.exec(route);
      if (quizRoute) {
        admin(req); const index = quizzes.findIndex(q => q.id === quizRoute[1]);
        if (index < 0) throw new AppError('Quiz not found.', 404);
        if (method === 'PUT') { const quiz = { ...validateQuiz(await body(req)), id: quizzes[index].id, updatedAt: new Date().toISOString() }; quizzes[index] = quiz; await persist(); return send(res, quiz); }
        if (method === 'DELETE') { quizzes.splice(index, 1); await persist(); return send(res, { ok: true }); }
      }
      if (route === '/api/rooms' && method === 'POST') {
        admin(req); const { quizId, maxPlayers } = await body(req), quiz = quizzes.find(q => q.id === quizId);
        if (!quiz) throw new AppError('Quiz not found.', 404);
        if (rooms.size >= 500) throw new AppError('Room limit reached. Try again later.', 429);
        const pin = createPin(rooms), game = new Game(quiz, pin, { changed: broadcast, ...(maxPlayers !== undefined ? { maxPlayers } : {}) }); rooms.set(pin, game); return send(res, { pin }, 201);
      }
      const roomRoute = /^\/api\/rooms\/([A-Z]{6})\/(join|events|state|answer|next|end|settings|remove)$/.exec(route);
      if (roomRoute) {
        const [, pin, action] = roomRoute, game = rooms.get(pin);
        if (!game) throw new AppError('Room not found. Check your six-letter PIN.', 404);
        if (action === 'join' && method === 'POST') { rateLimit(req, 'join', 300); const player = game.join((await body(req)).nickname); return send(res, { token: player.token, pin }, 201); }
        const host = !url.searchParams.has('token') && !req.headers.authorization && isAdmin(req);
        const secret = url.searchParams.get('token') ?? req.headers.authorization?.replace(/^Bearer /, '');
        if (game.revokedTokens.has(secret)) throw new AppError('The host removed you from this game.', 403);
        const player = game.playerFor(secret);
        if (!host && !player) throw new AppError('Please join the room again.', 401);
        if (['settings', 'remove'].includes(action) && method === 'POST') {
          admin(req); const input = await body(req);
          if (action === 'settings') { if (input.maxPlayers !== undefined) game.setMaxPlayers(input.maxPlayers); if (input.shuffleQuestions !== undefined) game.setShuffleQuestions(input.shuffleQuestions); if (input.skipRestTime !== undefined) game.setSkipRestTime(input.skipRestTime); }
          else game.removePlayer(input.playerId);
          return send(res, { ok: true });
        }
        if (action === 'state' && method === 'GET') return send(res, game.snapshot(player, host));
        if (action === 'events' && method === 'GET') {
          if ([...streams].filter(s => s.pin === pin && (host ? s.host : s.player?.id === player.id)).length >= 5) throw new AppError('Too many open connections.', 429);
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
          const stream = { pin, player, host, session: host ? sessionId(req) : null, res }; streams.add(stream);
          res.write(`data: ${JSON.stringify(game.snapshot(player, host))}\n\n`);
          const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20000);
          req.on('close', () => { clearInterval(heartbeat); streams.delete(stream); }); return;
        }
        if (action === 'answer' && method === 'POST') { if (!player) throw new AppError('Players only.', 403); const input = await body(req); game.answer(player, input.choices, input.index); return send(res, { ok: true }); }
        if (['next', 'end'].includes(action) && method === 'POST') { admin(req); if (action === 'next') game.next(); else game.end(); return send(res, { ok: true }); }
      }
      if (route.startsWith('/api/')) throw new AppError('Not found.', 404);
      if (!['GET', 'HEAD'].includes(method)) throw new AppError('Method not allowed.', 405);
      const files = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/theme.js': ['theme.js', 'text/javascript'], '/celebration.js': ['celebration.js', 'text/javascript'], '/import.js': ['import.js', 'text/javascript'], '/styles.css': ['styles.css', 'text/css'], '/favicon.svg': ['favicon.svg', 'image/svg+xml'] };
      const file = files[route]; if (!file) throw new AppError('Not found.', 404);
      const data = await readFile(path.join(root, 'public', file[0])); res.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8`, 'Cache-Control': 'no-cache' }); res.end(method === 'HEAD' ? undefined : data);
    } catch (error) { if (!error.status) console.error(error); if (!res.headersSent) send(res, { error: error.status ? error.message : 'Something went wrong. Please try again.' }, error.status ?? 500); else res.end(); }
  });
  const cleanup = setInterval(() => {
    for (const [id, expires] of sessions) if (expires <= now()) sessions.delete(id);
    for (const [key, limit] of limits) if (limit.until <= now()) limits.delete(key);
    for (const [pin, game] of rooms) if (now() - game.updatedAt > 6 * 3600000) { game.end(); rooms.delete(pin); for (const stream of streams) if (stream.pin === pin) { stream.res.end(); streams.delete(stream); } }
  }, 60000); cleanup.unref();
  const close = async () => { clearInterval(cleanup); for (const game of rooms.values()) game.cancel(game.timer); for (const stream of streams) stream.res.end(); await writes; await new Promise(resolve => server.close(resolve)); };
  return { server, close, rooms };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const password = process.env.ADMIN_PASSWORD || token().slice(0, 16);
  const app = await createApp({ password, dataDir: process.env.DATA_DIR || path.join(root, 'data') });
  const port = Number(process.env.PORT || 3000);
  app.server.listen(port, process.env.HOST || '0.0.0.0', () => {
    console.log(`\n  ⚡ Seekers of Christ QUIZ is ready at http://localhost:${port}\n  Players on your Wi-Fi can use http://<your-LAN-IP>:${port}\n`);
    if (!process.env.ADMIN_PASSWORD) console.log(`  Temporary admin password: ${password}\n  Set ADMIN_PASSWORD to keep a consistent password.\n`);
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await app.close(); process.exit(0); });
}

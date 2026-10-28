# backlogs
1. ada soal multiple answer ga ko?
2. kalau jawab salah kan minus, kalau ga jawab sampai waktu habis minus ga?

# ⚡ Seekers of Christ QUIZ

A colorful, live multiplayer quiz app for classrooms, youth groups, and game nights. Players need only a six-letter room PIN; a unique nickname is generated if they leave the nickname field blank. Built with Node.js and plain JavaScript; no third-party runtime dependencies or build step.

## Run it

Requires **Node.js 22 or newer**.

```bash
npm start
```

Open **http://localhost:3000**. The terminal prints a temporary admin password on startup. Click **My quizzes** to sign in. A five-question starter quiz is included.

To choose a persistent admin password:

```bash
ADMIN_PASSWORD='your-long-private-password' npm start
```

Use `npm run dev` for automatic server restarts during development. Restarting clears active games, so use `npm start` while hosting an event.

## Play with a group

1. Sign in to **My quizzes**, then create a quiz or use the starter quiz.
2. Click **Host live**. The server generates a random six-letter PIN.
3. Players on the same network open `http://YOUR_COMPUTER_LAN_IP:3000`, enter the PIN, and optionally choose a nickname. Leave it blank for a random name. Each player receives a random icon and color. Allow inbound connections to port 3000 if your firewall requires it. `localhost` works only on the host’s own computer. The host can also open the LAN address so **Copy invite link** produces a link other devices can reach.
4. Once players join, click **Let’s go!** Show the host screen on a projector; players see the question and answer options on their own devices.
5. The round ends automatically when everyone submits or the time runs out. Everyone sees the correct answers and leaderboard. The host advances to the next question.
6. After the last question, reveal the final podium and optionally download the results as CSV.

For an offline event setup (laptop hotspot, phone hotspot, firewall, and a day-of checklist), see [local-run-app.md](local-run-app.md).

Guest Wi-Fi or access-point isolation can prevent devices from reaching one another. For players outside your network, deploy the server to a Node-compatible host with a public HTTPS URL.

## Features

- Password-protected admin library with create, edit, duplicate, and delete.
- Dynamic quizzes with up to 100 questions and 2–6 answer options per question.
- Single-choice and multiple-answer questions, customizable duration (5–300 seconds), and points (0–10,000).
- New quizzes start with **15 seconds per question**, **100 correct-answer points**, and an enabled **25-point wrong-answer deduction**. Existing saved quizzes and browser drafts retain their own settings.
- Import questions from Excel (`.xlsx`) or CSV in the quiz editor, with columns **Soal, A, B, C, D, Jawaban Benar** (2–6 options, A–F; `A,B` marks multiple correct answers). **Download template** provides a ready-made sheet. Imported questions use the quiz defaults; time, points, and other game settings stay in the UI. Invalid rows are listed by spreadsheet row number and nothing is imported until they are fixed. Parsing runs in the browser with no extra libraries, so it works offline. Legacy `.xls` files must be re-saved as `.xlsx`.
- Quiz-wide defaults for time, correct-answer points, and optional wrong-answer deductions, with **Apply to all questions** and individual question overrides. New questions inherit the defaults; duplicated questions retain their original settings.
- Per-question custom deductions, question duplication/reordering, cover colors, and emoji icons.
- Optional question shuffling: a saved per-quiz default (**Shuffle question order every time this quiz is hosted**) that hosts can switch on or off in the lobby. The order is shuffled once when the game starts, so every hosted session gets a fresh order; the saved quiz keeps its original order.
- Optional quiz-wide speed bonuses, configured when creating or editing a quiz. Off by default, with a configurable maximum of 1–100% of each question’s base points.
- Editor drafts saved in the browser; saved quizzes persist on the server in `data/quizzes.json`.
- Real-time lobby, synchronized server-owned timers, locked submissions (single-choice answers submit on the first tap; multiple-answer questions use **Lock it in**), answer reveals, and leaderboards using server-sent events.
- Player reconnection after refreshing the same browser tab, live-room recovery from the admin library, and a host-configurable capacity of 1–200 players (capacity limit, not a load-tested guarantee).
- Server-generated random names, icons, and colors unique among active players in a room. Exact colors are distinct; large rooms can contain visually similar shades. Identities remain stable across rankings and refreshes.
- Host removal of players from the lobby or an ongoing game, with immediate token revocation and live removal notifications.
- Responsive phone, tablet, and projector layouts; optional round-transition sounds; reduced-motion support.
- Animated leaderboard position changes: a player who overtakes others lifts out of the list and passes over them, including in the host's side leaderboard while the next question previews. Score counters and up/down rank indicators update with it. Final standings celebrate with confetti bursting in from the left and right edges of the screen every 5 seconds while the final leaderboard is shown. Use the small struck-through 🎉 **Stop confetti** button in the bottom-left corner of the final results (it fades once used) to stop the effect on that screen, including after refresh. Animations and confetti respect reduced-motion preferences.
- Shared ranking for tied scores and CSV results export.

## Scoring rules

- Correct answers earn the question’s full configured base points. With speed bonuses off (the default), response speed does not affect the awarded points. With bonuses on, a correct answer can also earn the time-based bonus described below.
- Multiple-answer questions require the exact set of correct options; there is no partial credit.
- Wrong answers earn zero unless **Raise the stakes** is enabled, in which case the configured **Wrong-answer deduction** is subtracted. New quizzes enable this with a default of **−25**. Check **Match deduction to correct-answer points** to keep the deduction equal to that question’s current base points (excluding any speed bonus). Older quizzes without a separate deduction keep their original behavior (deduct the question’s points). Scores can go below zero.
- Unanswered questions earn zero, unless **Raise the stakes** is enabled: then not answering subtracts the same deduction as a wrong answer, so guessing is never worse than staying silent.
- Points are applied only when a round finishes. Ending a game mid-question discards that unfinished round’s scoring.
- Players cannot join after a game starts. Disconnected players remain in the room; a round waits for their answer or the timer. Reloading the same tab restores their seat.

### Optional speed bonus

In the quiz editor, enable **Enable speed bonus** and choose the **Maximum bonus (% of question points)** from 1–100. This is a game-wide setting, independent of **Apply to all questions**. Click **Save quiz** to persist it; editing a saved quiz changes future games, not an already hosted game.

For a correct answer received before the deadline:

```text
bonus = floor(base points × maximum bonus percentage / 100 × remaining time / question duration)
round score = base points + bonus
```

Remaining time is bounded between zero and the question’s full duration. The server calculates it at answer receipt; the client cannot supply a bonus or trusted timestamp. Bonus points are rounded down to whole points. A 1,000-point question with a 50% maximum can award up to +500 bonus; with half the time remaining, it awards +250 bonus for a total of 1,250. The player’s round result shows base points and speed bonus separately.

Wrong answers never receive a speed bonus. Their deduction remains exactly the configured amount, e.g. **−250** even if a correct answer could earn **1,000 + bonus**. Unanswered questions get the same deduction as wrong answers (or **0** when deductions are off). Partial selections on multiple-answer questions count as wrong answers, as before.

## Quiz-wide settings and host controls

In the editor, **One setup. Every question.** controls defaults for new questions. **Apply to all questions** asks you to confirm before replacing the time, points, and penalty settings on every existing question. You can then adjust individual questions. Click **Save quiz** to persist changes. The default player limit is saved with the quiz.

**Match deduction to correct-answer points** is available both in these shared settings and on individual questions. Applying shared settings copies the matching option to every question. With matching enabled, changing a question’s base points from 100 to 200 also changes its deduction from 100 to 200. Unchecking the option restores its custom deduction. The matching option has no scoring effect when deductions are disabled.

In the lobby, set **Maximum players** and click **Update limit**. The capacity cannot be lower than the current player count; remove players first if needed. Capacity is locked after the game begins.

Use the **×** beside a lobby player, or open **Manage players** during a round or leaderboard, to remove someone. Their seat, score, and submitted answer are removed. If all remaining players have answered, the round ends immediately. If everyone is removed, the host can end the game. Completed games cannot be modified.

Removal revokes the player’s current room token; it is not an identity ban. Because players have no accounts, someone may join the lobby again as a new player while it is open. Names, icons, and colors from removed seats may be reused.

## Different network speeds

With **speed bonus off**, every correct answer accepted before the deadline gets the same configured points. With **speed bonus on**, a slower connection can reduce the bonus because the answer reaches the server later. Leave the option off when equal rewards for correct answers matter more than response speed.

Latency still matters. A slow connection can delay delivery of a question, reduce the effective answering time, and cause a submitted answer to arrive after the deadline. The **server’s receipt time** determines whether an answer is accepted; the countdown on a device is an approximate display. Client timestamps are not trusted, and there is no per-player grace period or latency compensation. The game cannot guarantee equal effective answering time across different networks.

For a group event, use a stable shared LAN where possible, give players comfortable question durations (e.g. 30–60 seconds), and encourage submitting before the last second. Reconnecting in the same tab restores the seat and current game state, but does not extend the timer. Unanswered questions earn zero without a penalty.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Listen interface; permits LAN access |
| `ADMIN_PASSWORD` | Random at startup | Shared admin password; generated value appears in the terminal |
| `DATA_DIR` | `./data` | Persistent quiz storage directory |
| `COOKIE_SECURE` | unset | Set to `true` when serving over HTTPS |

There is one shared admin role, with 12-hour sessions. Player tokens remain in browser session storage; admin sessions use HttpOnly, SameSite cookies. Admin operations are checked on the server, and correct answers stay hidden until a round ends. Login and join attempts are rate-limited.

For deployment, use **one persistent Node.js process**, a writable persistent data volume, an HTTPS reverse proxy, `COOKIE_SECURE=true`, and your own `ADMIN_PASSWORD`. Keep reverse-proxy buffering disabled for `/api/rooms/*/events`, and allow long-lived SSE connections. Preserve the public `Host` header. This app is not designed for static-only hosting or multiple server replicas.

Saved quizzes survive restarts. Live rooms, scores, and admin sessions are held in memory and reset on restart; rooms expire after six hours without game activity. Back up `data/quizzes.json` for your quiz library. Production multi-instance hosting would require shared database/session storage and cross-instance event delivery.

## Verify

```bash
npm run check
npm test
```

Tests cover quiz/default validation, speed-bonus opt-in/validation/timing/rounding, unchanged penalties, previous-round standings, unique identities at full capacity, capacity changes, player removal/token revocation, PIN generation, exact-set scoring, unanswered questions, late/duplicate/stale answers, answer secrecy, tied rankings, authentication, SSE broadcasts, real timer expiry, quiz persistence, and deletion. The HTTP integration test starts a loopback server and needs permission to bind a local port.

## Project layout

```text
server.js             HTTP API, authentication, storage, and SSE
lib/game.js           Quiz validation and authoritative game state
lib/identity.js       Unique random player names, icons, and colors
lib/seed.js           Starter quiz
public/index.html     Application entry
public/app.js         Admin editor and multiplayer UI
public/celebration.js Leaderboard movement, score counters, and confetti
public/import.js      Excel/CSV question import and template workbook
public/styles.css     Responsive visual design
test/                 Node.js unit and HTTP integration tests
```

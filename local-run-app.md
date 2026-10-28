# Running Seekers of Christ QUIZ Locally (No Internet)

This guide covers running the game on a **laptop** while players join from their phones over **local Wi-Fi**. No internet connection is needed at all.

## Why run locally?

- Traffic only travels **player's phone → Wi-Fi/hotspot → laptop**. It never goes through the internet.
- Differences in players' mobile carriers or 4G signal don't matter. The game keeps working even if the internet is down.
- LAN latency is usually only 5–50 ms. Its effect on the speed bonus is about ±1 point, compared with ~7–15 points over a slow internet connection.

What **still** matters: each phone's Wi-Fi signal strength (distance and walls) and how many devices the Wi-Fi/hotspot can handle.

---

## 1. Choose a Wi-Fi network

| Option | Capacity | Survives a power outage? | Notes |
|---|---|---|---|
| **A. Laptop as hotspot** | Depends on the driver; needs testing | ✅ (laptop battery) | Free, IP is always `10.42.0.1`. **Try this first.** |
| **B. Travel router + power bank** | Dozens of devices | ✅ | Most reliable for 20–50+ players |
| **C. Wi-Fi router + mini DC UPS** | Dozens of devices | ✅ | If you already own a router |
| **D. Android phone hotspot** | ~10 devices (the laptop counts as one) | ✅ (phone battery) | Fine for small groups |
| **E. Chained hotspots** | +9 per extra phone | ✅ | Emergency fallback only |

### A. Laptop as hotspot (try this first)

This laptop's Wi-Fi card supports hotspot (AP) mode.

```bash
# Turn on the hotspot (this disconnects the laptop from its current Wi-Fi)
nmcli device wifi hotspot ifname wlp0s20f3 ssid "SoC-Quiz" password "your-password"

# Turn the hotspot off when you're done
nmcli connection down Hotspot
```

- The laptop automatically gets IP **`10.42.0.1`**, and it's always the same. Players open **`http://10.42.0.1:3000`**.
- You can put this address on a slide or a QR code well in advance.
- If the `ufw` firewall is active, players' phones may fail to get an IP. See [Firewall](#3-firewall).

### B / C. Mini router, or router + UPS

- A USB-powered **travel router** (e.g. TP-Link TL-WR802N or TL-MR3020), around Rp200–350k, plugged into a power bank.
- Or connect an existing Wi-Fi router to a **mini DC UPS** (around Rp150–250k).
- The router doesn't need an internet connection.

### D. Phone hotspot

1. Turn on the phone's hotspot. **Mobile data on the phone can be turned off.**
2. Connect the laptop to that hotspot.
3. Players connect to the same hotspot.

> ⚠️ Give players the **laptop's IP**, not the phone's. The phone only acts as the "router".

### E. Chained hotspots

```
Laptop ── Phone A hotspot ── Phone B (connected to A + running its own hotspot) ── players' phones
```

- Only works on phones with **"Wi-Fi sharing"**, meaning they can share a Wi-Fi connection through their own hotspot. This is common on Samsung, Xiaomi, and Oppo/Realme.
- **The IP stays the same.** Players on phone B still open `http://<laptop-IP>:3000`.
- The server handles this fine. All players behind phone B appear as one IP, and the per-IP join limit is 300 per minute.
- Downsides:
  - Each extra phone adds only ~9 slots.
  - Connections are slightly slower.
  - If phone B dies, every player connected to it drops out.

---

## 2. Find the laptop's IP

Skip this step if you use option A, because the IP is always `10.42.0.1`.

After the laptop connects to the Wi-Fi/hotspot you'll use:

```bash
hostname -I
```

Use the **first** IP. It usually looks like:

- `192.168.43.xx` (Android hotspot)
- `172.20.10.x` (iPhone hotspot)
- `192.168.x.x` (router)

Ignore `172.17.x`, `172.18.x`, `172.19.x`, and similar addresses. Those belong to Docker.

> The IP changes whenever you switch networks. **Check it again on event day** after the laptop connects to the network you'll actually use.

---

## 3. Firewall

The firewall is the laptop's "security guard" that decides which incoming connections are allowed. If port 3000 is blocked, players' phones just keep loading and then time out. Meanwhile `localhost:3000` still works on the laptop, so this problem often goes unnoticed.

```bash
sudo ufw status
```

- `Status: inactive`: you're fine, nothing to do.
- `Status: active`: allow the game port:

  ```bash
  sudo ufw allow 3000/tcp
  ```

  If you use the **laptop as a hotspot** (option A), allow all traffic from the hotspot instead. This includes DHCP, which players' phones need to get an IP:

  ```bash
  sudo ufw allow in on wlp0s20f3
  ```

---

## 4. Start the server

```bash
ADMIN_PASSWORD='a-long-admin-password' npm start
```

- Use `npm start`, **not** `npm run dev`. Dev mode can restart automatically and wipe the games in progress.
- On the laptop, open **`http://<laptop-IP>:3000`** rather than `localhost`. That way **Copy invite link** produces a link other phones can open.
- Sign in via **My quizzes** → pick a quiz → **Host live** → show the host screen on the projector.
- Optional: enable **Auto next question** on the host screen to move all players to the next question together when time expires or everyone has answered, without the host clicking **Next question**. A player who answers early stays on the waiting screen until one of those conditions is met. You can toggle it in the lobby or during play. Enabling it during a results break starts the next preview immediately; disabling it during a question restores the pause after that question. Scores still update each round. After the last question the game waits on that round's results until the host clicks **Show final results 🏆**, so the winner reveal is yours to time. Each new room starts with this option off.
- Use **Fullscreen** on the host screen for the projector. It automatically hides the settings and uses large question, answer, timer, and leaderboard text. **Hide controls** also works without entering fullscreen. Click the small gear button or press **H** to show/hide controls; **F** toggles fullscreen and **Esc** exits it. Start/Next question controls remain available during manual play.
- Every question starts with a synchronized **1.5-second preview**: the question appears large and centered on the same game screen, while answer choices stay hidden. It then moves up and shrinks smoothly as the choices appear. Choices appear and the full answer timer starts together after the preview. For example, a 15-second question gives players 1.5 seconds to read, then 15 full seconds to answer. This applies to the first question, manual progression, and automatic progression.
- Players open `http://<laptop-IP>:3000` and enter the PIN.

---

## 5. Instructions for players

Share these before starting:

1. Connect to the **SoC-Quiz** Wi-Fi, or whatever hotspot/router name you use.
2. **Turn off mobile data.** If a *"Wi-Fi has no internet"* notification appears, choose **stay connected**.
   - iPhone: turn off **Wi-Fi Assist** (Settings → Cellular).
   - Android: turn off **Switch to mobile data / Adaptive Wi-Fi** if present.
3. Open `http://<laptop-IP>:3000` in a browser. Make sure to type **`http://`**, not `https://`.
4. Enter the PIN and a nickname. The nickname can be left blank to get a random name.

---

## 6. Checklist

### Day before (test run)

- [ ] Turn on the network you'll use, **with internet turned off**.
- [ ] Connect the laptop and as many phones as possible (borrow some from friends).
- [ ] Check the firewall (`sudo ufw status`).
- [ ] Play one full game through to the final leaderboard. Use the small struck-through 🎉 button in the bottom-left corner to stop the confetti on that screen (it fades once used); it stays stopped after refresh.
- [ ] Note the laptop's IP and prepare a slide or QR code with the address.

### Event day

- [ ] Plug the laptop and the hotspot phone/router into a charger or power bank.
- [ ] On the phone, turn off battery saver and **auto turn off hotspot**.
- [ ] Set the laptop so it **doesn't sleep** and the screen doesn't turn off during the event.
- [ ] Place the hotspot/router in the **middle of the room**, not in a corner.
- [ ] Check the laptop's IP again (`hostname -I`) after connecting.
- [ ] `ADMIN_PASSWORD='...' npm start`.

---

## 7. Troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| Players' phones keep loading / time out | Firewall is blocking port 3000 | See [Firewall](#3-firewall) |
| Phones can't connect to the laptop hotspot | `ufw` is blocking DHCP | `sudo ufw allow in on wlp0s20f3` |
| Page won't open even though Wi-Fi is connected | Phone switched to mobile data | Turn off mobile data on the player's phone |
| Works on the laptop but not on phones | Using `localhost` or the wrong IP | Use the IP from `hostname -I` |
| No devices can reach each other on guest/public Wi-Fi | *Client isolation* on the router | Use your own hotspot/router |
| The 10th+ player can't join the Wi-Fi | Phone hotspot device limit | Use option A, B/C, or E |
| All players suddenly disconnect | Hotspot turned off / laptop went to sleep | Disable hotspot auto-off and laptop sleep |
| Admin login asks for the password again | Server restarted (admin sessions are cleared) | Sign in again with `ADMIN_PASSWORD` |

import { randomInt } from 'node:crypto';

// Each active player gets their own icon and exact color, even in a full room.
export const playerIcons = `🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐨 🐯 🦁 🐮 🐷 🐸 🐵 🐔 🐧 🐦 🐤 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🐛 🦋 🐌 🐞 🐜 🪲 🦗 🕷️ 🦂 🐢 🐍 🦎 🦖 🦕 🐙 🦑 🦐 🦞 🦀 🐡 🐠 🐟 🐬 🐳 🦈 🐊 🐅 🐆 🦓 🦍 🦧 🦣 🐘 🦛 🦏 🐪 🐫 🦒 🦘 🦬 🐃 🐂 🐄 🐎 🐖 🐏 🐑 🦙 🐐 🦌 🐕 🐩 🦮 🐈 🪶 🦃 🦤 🦚 🦜 🦢 🦩 🕊️ 🐇 🦝 🦨 🦡 🦫 🦦 🦥 🐁 🐀 🐿️ 🦔 🐉 🐲 🌵 🎄 🌲 🌳 🌴 🪵 🌱 🌿 ☘️ 🍀 🎍 🪴 🎋 🍃 🍂 🍁 🍄 🐚 🪨 🌾 💐 🌷 🌹 🥀 🪷 🌺 🌸 🌼 🌻 🌞 🌝 🌛 🌜 🌚 🌕 🌖 🌗 🌘 🌑 🌒 🌓 🌔 🌙 🌎 🌍 🌏 🪐 💫 ⭐ 🌟 ✨ ⚡ ☄️ 💥 🔥 🌪️ 🌈 ☀️ 🌤️ ⛅ 🌥️ ☁️ 🌦️ 🌧️ ⛈️ 🌩️ 🌨️ ❄️ ☃️ ⛄ 🌬️ 💨 💧 💦 🫧 ☔ 🌊 🍏 🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🥦 🥬 🥒 🌶️ 🫑 🌽 🥕 🫒 🧄 🧅 🥔 🍠 🥐 🥯 🍞 🥖 🧀 🥨 🥚 🍳 🧇 🥞 🥓 🥩 🍗 🍖 🌭 🍔 🍟 🍕 🥪 🥙 🧆 🌮 🌯 🫔 🥗 🥘 🫕 🥫 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🦪 🍤 🍙 🍚 🍘 🍥 🥠 🥮 🍢 🍡 🍧 🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🎮 🚀 🧠 🤖 👾 🎸 🎺 🎻 🎲 🎯 🏀 ⚽ 🏈 🏓 🏸 🥏 🛹 🛼 🛴 🚲 🎨 🧩 🪁 🎈 🎁 🧸`.split(/\s+/u);
const adjectives = ['Cosmic', 'Lucky', 'Neon', 'Happy', 'Brave', 'Quick', 'Chill', 'Sunny', 'Epic', 'Bouncy', 'Clever', 'Mighty', 'Funky', 'Turbo', 'Magic', 'Daring', 'Jolly', 'Nifty', 'Zippy', 'Super'];
const animals = ['Panda', 'Fox', 'Otter', 'Tiger', 'Koala', 'Owl', 'Frog', 'Lynx', 'Lion', 'Gecko', 'Falcon', 'Whale', 'Bunny', 'Duck', 'Crab', 'Dolphin', 'Penguin', 'Badger', 'Lemur', 'Robin'];
const names = adjectives.flatMap(a => animals.map(b => `${a} ${b}`));
export function randomIdentity(players, nickname) {
  const active = [...players.values()];
  if (!nickname) {
    const used = new Set(active.map(p => p.nickname.toLowerCase()));
    const available = names.filter(n => !used.has(n.toLowerCase()));
    nickname = available[randomInt(available.length)];
  }
  const icons = playerIcons.filter(icon => !active.some(p => p.appearance.icon === icon));
  const hues = Array.from({ length: 200 }, (_, i) => i * 1.8).filter(hue => !active.some(p => p.appearance.hue === hue));
  // Spread early arrivals around the color wheel instead of giving neighbors
  // almost identical shades. Randomize ties while keeping every hue unique.
  const distances = hues.map(hue => active.length ? Math.round(10 * Math.min(...active.map(p => {
    const difference = Math.abs(hue - p.appearance.hue);
    return Math.min(difference, 360 - difference);
  }))) : 0);
  const furthest = Math.max(...distances), candidates = hues.filter((_, i) => distances[i] === furthest);
  return { nickname, appearance: { icon: icons[randomInt(icons.length)], hue: candidates[randomInt(candidates.length)] } };
}

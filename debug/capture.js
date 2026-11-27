// Verification harness, loaded only when ISLET_DEBUG=1. Never runs in normal use.
// Captures the real window in each state, checks that the click-through region
// matches what is drawn, and reports text contrast against a white wallpaper.
const fs = require('node:fs');
const path = require('node:path');

const OUT = path.join(__dirname, '..', '.debug');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const SAMPLE_TRACK = {
  player: 'Music',
  playing: true,
  title: 'Yellow',
  artist: 'Coldplay',
  album: 'Parachutes',
  duration: 267,
  position: 62,
  authError: false,
  artwork:
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5b6076"/><stop offset=".55" stop-color="#8a6a55"/><stop offset="1" stop-color="#16161d"/></linearGradient></defs><rect width="160" height="160" fill="url(#g)"/><circle cx="112" cy="46" r="34" fill="#ffffff" opacity=".16"/><circle cx="38" cy="120" r="46" fill="#000000" opacity=".24"/></svg>',
    ),
};

const IDLE = {
  player: null,
  playing: false,
  title: '',
  artist: '',
  album: '',
  duration: 0,
  position: 0,
  artwork: null,
  authError: true,
};

const GRADIENT = 'linear-gradient(145deg,#c9d7e4,#e9d9c8 48%,#aebccb 100%)';
const NEAR_WHITE = '#f4f3f1';

const EXPANDED = `document.getElementById('island').classList.contains('expanded')`;

const RECT = `(() => {
  const r = document.getElementById('island').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
})()`;

const LAYOUT = `(() => {
  const panel = document.querySelector('.panel');
  return {
    island: [document.getElementById('island').offsetWidth, document.getElementById('island').offsetHeight],
    overflow: panel.scrollHeight - panel.clientHeight,
    islandBottom: Math.round(document.getElementById('island').getBoundingClientRect().bottom),
    windowHeight: window.innerHeight,
  };
})()`;

// Worst case for a light theme is a white wallpaper: the translucent card
// composites to white, so blending each text colour over white is the floor.
const CONTRAST = `(() => {
  const channel = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  const parse = (color) => color.match(/[\\d.]+/g).map(Number);
  const overWhite = (rgba) => {
    const a = rgba.length > 3 ? rgba[3] : 1;
    return [0, 1, 2].map((i) => rgba[i] * a + 255 * (1 - a));
  };
  const ratio = (fg) => {
    const a = luminance(fg);
    const b = luminance([255, 255, 255]);
    const [hi, lo] = a > b ? [a, b] : [b, a];
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  };
  const targets = {
    title: '#title',
    subtitle: '#sub',
    date: '#date',
    time: '#time',
    lyricInactive: '.lyrics .line',
    hint: '.shelf-hint',
  };
  const out = {};
  for (const [key, selector] of Object.entries(targets)) {
    const el = document.querySelector(selector);
    out[key] = el ? ratio(overWhite(parse(getComputedStyle(el).color))) : null;
  }
  return out;
})()`;

async function shoot(win, name) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${name}.png`), (await win.capturePage()).toPNG());
}

const evaluate = (win, expression) => win.webContents.executeJavaScript(expression);

module.exports = async function capture({ app, win, hover, hitbox, stopPolling, stopHover }) {
  await sleep(3500);
  stopHover();

  // Hold mode leaves the card expanded with sample content and keeps the window
  // open (no page backdrop) so a real screen capture can show native vibrancy.
  if (process.env.ISLET_HOLD) {
    stopPolling();
    win.webContents.send('media', SAMPLE_TRACK);
    hover(true);
    await sleep(2500);
    const bounds = win.getBounds();
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'bounds.json'), JSON.stringify(bounds));
    console.error('[hold]', JSON.stringify(bounds));
    return;
  }

  const report = {};

  const states = [];
  hover(false);
  await sleep(200);
  states.push({ inside: false, expanded: await evaluate(win, EXPANDED) });
  hover(true);
  await sleep(500);
  states.push({ inside: true, expanded: await evaluate(win, EXPANDED) });
  hover(false);
  await sleep(500);
  states.push({ inside: false, expanded: await evaluate(win, EXPANDED) });
  hover(true);
  await sleep(500);
  report.hover = states;

  await evaluate(win, `document.body.style.background='${GRADIENT}'`);
  await shoot(win, 'real');

  stopPolling();
  win.webContents.send('media', SAMPLE_TRACK);
  await sleep(2500);

  report.layout = await evaluate(win, LAYOUT);

  const rect = await evaluate(win, RECT);
  const box = hitbox();
  const host = win.getBounds();
  report.hitboxMatchesCard =
    Math.abs(box.width - Math.round(rect.w)) <= 1 &&
    Math.abs(box.height - Math.round(rect.h)) <= 1 &&
    Math.abs(box.x - (host.x + Math.round(rect.x))) <= 1;

  report.contrastOnWhite = await evaluate(win, CONTRAST);
  await shoot(win, 'expanded');

  await evaluate(win, `document.body.style.background='${NEAR_WHITE}'`);
  await sleep(300);
  await shoot(win, 'light');

  hover(false);
  await sleep(700);
  await shoot(win, 'collapsed-playing');

  win.webContents.send('media', IDLE);
  hover(true);
  await sleep(900);
  await shoot(win, 'expanded-idle');

  console.error('[capture]', JSON.stringify(report));
  app.quit();
};

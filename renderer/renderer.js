const $ = (id) => document.getElementById(id);

const island = $('island');
const pillArt = $('pillArt');
const pillTitle = $('pillTitle');
const eq = $('eq');
const panelArt = $('panelArt');
const titleEl = $('title');
const sub = $('sub');
const bar = $('bar');
const fill = $('fill');
const elapsed = $('elapsed');
const total = $('total');
const lyricsBox = $('lyrics');

let media = { authError: false };
let mediaAt = 0;
let scrubbing = false;
let scrubPosition = 0;
let lyricKey = '';
let synced = [];
let activeIndex = -1;

/* ------------------------------------------------------------ expansion */

let reportedState = '';

function publishState() {
  const state = !media.title ? 'idle' : synced.length ? 'roomy' : 'base';
  if (state === reportedState) return;
  reportedState = state;
  window.islet.reportState(state);
}

window.islet.onExpand((on) => {
  island.classList.toggle('expanded', on);
});

sub.addEventListener('click', () => {
  if (!media.title && media.authError) window.islet.openAutomation();
});

document.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  window.islet.menu();
});

/* -------------------------------------------------------- clock & power */

function clockText(now) {
  return now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function tickClock() {
  const now = new Date();
  $('date').textContent = now.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  $('time').textContent = clockText(now);
  if (!media || !media.title) pillTitle.textContent = clockText(now);
}

let battery = null;

async function initBattery() {
  if (!navigator.getBattery) return;
  try {
    battery = await navigator.getBattery();
  } catch {
    return;
  }
  const paint = () => {
    const el = $('battery');
    el.textContent = `${Math.round(battery.level * 100)}%`;
    el.classList.toggle('charging', battery.charging);
  };
  battery.addEventListener('levelchange', paint);
  battery.addEventListener('chargingchange', paint);
  paint();
}

/* ---------------------------------------------------------------- media */

function format(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function livePosition() {
  const base = Number(media.position) || 0;
  if (!media.playing) return base;
  return base + (performance.now() - mediaAt) / 1000;
}

function paintArtwork(url) {
  const style = url ? `url("${url}")` : '';
  pillArt.style.backgroundImage = style;
  panelArt.style.backgroundImage = style;
  pillArt.classList.toggle('hidden', !url);
}

function render() {
  const hasMedia = Boolean(media && media.title);
  const playing = Boolean(hasMedia && media.playing);

  eq.classList.toggle('on', playing);
  island.classList.toggle('playing', hasMedia);
  island.classList.toggle('idle', !hasMedia);
  paintArtwork(hasMedia ? media.artwork : null);

  if (hasMedia) pillTitle.textContent = media.title;
  else pillTitle.textContent = $('time').textContent || clockText(new Date());

  titleEl.textContent = hasMedia
    ? media.title
    : media.authError
      ? 'Allow playback access'
      : 'Nothing playing';

  sub.textContent = hasMedia
    ? [media.artist, media.album].filter(Boolean).join(' · ')
    : media.authError
      ? 'Privacy & Security → Automation'
      : '';
  sub.classList.toggle('action', Boolean(!hasMedia && media.authError));

  $('playIcon').innerHTML = playing
    ? '<path d="M4.3 2.6h2.8v10.8H4.3zM8.9 2.6h2.8v10.8H8.9z"/>'
    : '<path d="M4.2 2.7 13 8l-8.8 5.3z"/>';

  for (const id of ['prev', 'play', 'next']) {
    $(id).disabled = !hasMedia;
  }

  total.textContent = format(hasMedia ? media.duration : 0);

  if (hasMedia) loadLyrics();
  else renderLyrics();
  publishState();
}

function setProgress(position) {
  const duration = media && media.duration ? media.duration : 0;
  const ratio = duration ? Math.min(1, Math.max(0, position / duration)) : 0;
  fill.style.width = `${ratio * 100}%`;
  elapsed.textContent = format(position);
}

function frame() {
  if (media && media.title) {
    const position = scrubbing ? scrubPosition : livePosition();
    setProgress(position);
    syncLyrics(position);
  }
  requestAnimationFrame(frame);
}

window.islet.onMedia((state) => {
  const previous = media;
  media = state;
  mediaAt = performance.now();
  if (!previous || previous.title !== state.title || previous.artist !== state.artist) {
    activeIndex = -1;
  }
  render();
  setProgress(livePosition());
});

/* ------------------------------------------------------------- controls */

$('play').addEventListener('click', () => window.islet.control('playpause'));
$('prev').addEventListener('click', () => window.islet.control('previous'));
$('next').addEventListener('click', () => window.islet.control('next'));

function ratioAt(event) {
  const rect = bar.getBoundingClientRect();
  return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
}

bar.addEventListener('pointerdown', (event) => {
  if (!media || !media.title) return;
  scrubbing = true;
  bar.setPointerCapture(event.pointerId);
  scrubPosition = ratioAt(event) * (media.duration || 0);
  setProgress(scrubPosition);
});

bar.addEventListener('pointermove', (event) => {
  if (!scrubbing) return;
  scrubPosition = ratioAt(event) * (media.duration || 0);
  setProgress(scrubPosition);
});

bar.addEventListener('pointerup', (event) => {
  if (!scrubbing) return;
  scrubbing = false;
  window.islet.control('seek', ratioAt(event) * (media.duration || 0));
});

/* --------------------------------------------------------------- lyrics */

function parseLrc(text) {
  const stamp = /\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const stamps = [...raw.matchAll(stamp)];
    if (!stamps.length) continue;
    const words = raw.replace(stamp, '').trim();
    if (!words) continue;
    for (const match of stamps) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fraction = match[3] ? Number(match[3].padEnd(3, '0')) / 1000 : 0;
      out.push([minutes * 60 + seconds + fraction, words]);
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

function emptyLine(text, onClick) {
  const div = document.createElement('div');
  div.className = 'empty';
  div.textContent = text;
  if (onClick) {
    div.classList.add('action');
    div.addEventListener('click', onClick);
  }
  return div;
}

function renderLyrics() {
  lyricsBox.replaceChildren();
  if (!media.title) {
    lyricsBox.append(
      media.authError
        ? emptyLine('Let Islet read playback to show lyrics', () => window.islet.openAutomation())
        : emptyLine('Lyrics appear here while a track plays'),
    );
    return;
  }
  if (!synced.length) {
    island.classList.remove('roomy');
    lyricsBox.append(emptyLine('No synced lyrics for this track'));
    publishState();
    return;
  }
  island.classList.add('roomy');
  publishState();
  synced.forEach(([time, words]) => {
    const line = document.createElement('div');
    line.className = 'line';
    line.textContent = words;
    line.addEventListener('click', () => window.islet.control('seek', time));
    lyricsBox.append(line);
  });
  activeIndex = -1;
}

async function loadLyrics() {
  const key = `${media.title}|${media.artist}|${Math.round(media.duration || 0)}`;
  if (key === lyricKey) return;
  lyricKey = key;
  synced = [];
  renderLyrics();

  const result = await window.islet.lyrics({
    title: media.title,
    artist: media.artist,
    album: media.album,
    duration: media.duration,
  });

  if (lyricKey !== key) return;
  synced = result && result.synced ? parseLrc(result.synced) : [];
  renderLyrics();
}

function syncLyrics(position) {
  if (!synced.length) return;
  let index = -1;
  for (let i = 0; i < synced.length; i += 1) {
    if (synced[i][0] <= position + 0.15) index = i;
    else break;
  }
  if (index === activeIndex) return;
  activeIndex = index;

  const lines = lyricsBox.children;
  for (let i = 0; i < lines.length; i += 1) {
    lines[i].classList?.toggle('active', i === index);
  }

  const current = lines[index];
  if (current && island.classList.contains('expanded')) {
    current.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

/* ---------------------------------------------------------------- shelf */

const shelf = [];

function renderShelf() {
  const chips = $('chips');
  chips.replaceChildren();
  for (const item of shelf) {
    const chip = document.createElement('div');
    chip.className = 'chip';
    chip.draggable = true;

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = item.name;

    const remove = document.createElement('button');
    remove.className = 'x';
    remove.textContent = '×';
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      const at = shelf.findIndex((entry) => entry.path === item.path);
      if (at >= 0) shelf.splice(at, 1);
      renderShelf();
    });

    chip.append(name, remove);
    chip.addEventListener('click', () => window.islet.reveal(item.path));
    chip.addEventListener('dragstart', (event) => {
      event.preventDefault();
      window.islet.startDrag(item.path);
    });
    chips.append(chip);
  }
  $('clearShelf').hidden = shelf.length === 0;
}

document.addEventListener('dragover', (event) => {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
  island.classList.add('dropping');
});

document.addEventListener('dragleave', (event) => {
  if (!event.relatedTarget) island.classList.remove('dropping');
});

document.addEventListener('drop', (event) => {
  event.preventDefault();
  island.classList.remove('dropping');
  if (!event.dataTransfer) return;
  for (const file of event.dataTransfer.files) {
    const filePath = window.islet.pathForFile(file);
    if (!filePath) continue;
    if (shelf.some((entry) => entry.path === filePath)) continue;
    shelf.push({ path: filePath, name: file.name });
  }
  renderShelf();
});

$('clearShelf').addEventListener('click', () => {
  shelf.length = 0;
  renderShelf();
});

/* ----------------------------------------------------------------- boot */

tickClock();
setInterval(tickClock, 1000);
initBattery();
renderShelf();
renderLyrics();
requestAnimationFrame(frame);
publishState();

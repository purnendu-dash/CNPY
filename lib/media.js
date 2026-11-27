const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const IDLE = {
  player: null,
  playing: false,
  title: '',
  artist: '',
  album: '',
  duration: 0,
  position: 0,
  artwork: null,
};

const artworkCache = new Map();
let currentPlayer = null;

function run(cmd, args, timeout = 5000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? '' : String(stdout));
    });
  });
}

function osa(script) {
  return run('osascript', ['-e', script]);
}

function osaResult(script) {
  return new Promise((resolve) => {
    execFile('osascript', ['-e', script], { timeout: 5000 }, (err, stdout, stderr) => {
      resolve({
        out: err ? '' : String(stdout),
        err: String(stderr || ''),
        failed: Boolean(err),
      });
    });
  });
}

function isDenied(stderr) {
  return /-1743|not authori[sz]ed|not allowed to send apple events/i.test(stderr);
}

async function isRunning(appName) {
  const out = await run('pgrep', ['-x', appName], 2000);
  return out.trim().length > 0;
}

const MUSIC_STATE = `
tell application "Music"
  try
    set t to current track
  on error
    return "none"
  end try
  set pstate to (player state as string)
  return (name of t) & linefeed & (artist of t) & linefeed & (album of t) & linefeed & (duration of t) & linefeed & (player position) & linefeed & pstate & linefeed & ((id of t) as string)
end tell`;

const SPOTIFY_STATE = `
tell application "Spotify"
  if player state is stopped then return "none"
  set t to current track
  return (name of t) & linefeed & (artist of t) & linefeed & (album of t) & linefeed & ((duration of t) / 1000) & linefeed & (player position) & linefeed & (player state as string) & linefeed & (artwork url of t)
end tell`;

function parseFields(raw) {
  const lines = raw.replace(/\r/g, '').split('\n');
  if (lines.length < 7) return null;
  const [title, artist, album, duration, position, state, extra] = lines;
  if (!title || title === 'none') return null;
  return {
    title: title.trim(),
    artist: artist.trim(),
    album: album.trim(),
    duration: Number(duration) || 0,
    position: Number(position) || 0,
    playing: /playing/i.test(state),
    extra: extra.trim(),
  };
}

function dataUrlFromFile(file) {
  try {
    const buf = fs.readFileSync(file);
    if (!buf.length) return null;
    const jpeg = buf[0] === 0xff && buf[1] === 0xd8;
    const png = buf[0] === 0x89 && buf[1] === 0x50;
    const mime = jpeg ? 'image/jpeg' : png ? 'image/png' : 'image/jpeg';
    return `data:${mime};base64,${buf.toString('base64')}`;
  } catch {
    return null;
  }
}

async function musicArtwork(trackId) {
  if (!trackId) return null;
  if (artworkCache.has(trackId)) return artworkCache.get(trackId);
  const target = path.join(os.tmpdir(), `islet-art-${trackId.replace(/[^a-zA-Z0-9]/g, '')}.img`);
  const script = `
tell application "Music"
  set t to current track
  if (count of artwork of t) is 0 then return "none"
  set d to data of artwork 1 of t
  set f to open for access (POSIX file "${target}") with write permission
  set eof of f to 0
  write d to f
  close access f
  return "ok"
end tell`;
  const out = (await osa(script)).trim();
  let url = null;
  if (out === 'ok') {
    url = dataUrlFromFile(target);
    try { fs.unlinkSync(target); } catch { /* ignore */ }
  }
  artworkCache.set(trackId, url);
  if (artworkCache.size > 40) artworkCache.delete(artworkCache.keys().next().value);
  return url;
}

async function getState() {
  const [musicUp, spotifyUp] = await Promise.all([isRunning('Music'), isRunning('Spotify')]);

  let music = null;
  let spotify = null;
  let denied = false;
  if (musicUp) {
    const r = await osaResult(MUSIC_STATE);
    music = parseFields(r.out);
    if (!music && isDenied(r.err)) denied = true;
  }
  if (spotifyUp) {
    const r = await osaResult(SPOTIFY_STATE);
    spotify = parseFields(r.out);
    if (!spotify && isDenied(r.err)) denied = true;
  }

  let player = null;
  let info = null;
  if (music && music.playing) { player = 'Music'; info = music; }
  else if (spotify && spotify.playing) { player = 'Spotify'; info = spotify; }
  else if (music) { player = 'Music'; info = music; }
  else if (spotify) { player = 'Spotify'; info = spotify; }

  if (!player || !info) {
    currentPlayer = null;
    return { ...IDLE, authError: denied };
  }

  currentPlayer = player;
  let artwork = null;
  if (player === 'Music') {
    artwork = await musicArtwork(info.extra);
  } else if (info.extra) {
    artwork = info.extra;
  }

  return {
    player,
    playing: info.playing,
    title: info.title,
    artist: info.artist,
    album: info.album,
    duration: info.duration,
    position: info.position,
    artwork: artwork || null,
  };
}

async function control(action, value) {
  const player = currentPlayer;
  if (!player) return;
  const target = `application "${player}"`;
  let script = '';
  if (action === 'playpause') {
    script = player === 'Spotify'
      ? `tell application "Spotify" to playpause`
      : `tell application "Music"\nif player state is playing then\npause\nelse\nplay\nend if\nend tell`;
  } else if (action === 'next') {
    script = `tell ${target} to next track`;
  } else if (action === 'previous') {
    script = `tell ${target} to previous track`;
  } else if (action === 'seek') {
    const seconds = Math.max(0, Number(value) || 0);
    script = player === 'Spotify'
      ? `tell ${target} to set player position to (${Math.round(seconds * 1000)})`
      : `tell ${target} to set player position to (${seconds})`;
  }
  if (!script) return;
  await osa(script);
}

module.exports = { getState, control };

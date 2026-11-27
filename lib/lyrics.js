const cache = new Map();

async function json(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Islet/0.1 (macOS dynamic island)' } });
  if (!res.ok) return null;
  return res.json();
}

function pick(records) {
  if (!Array.isArray(records)) return null;
  const synced = records.find((r) => r && r.syncedLyrics);
  const any = synced || records[0];
  if (!any) return null;
  return {
    synced: any.syncedLyrics || '',
    plain: any.plainLyrics || '',
    instrumental: Boolean(any.instrumental),
  };
}

async function lookup({ title, artist, album, duration } = {}) {
  if (!title) return null;
  const key = `${title}|${artist}|${duration}`;
  if (cache.has(key)) return cache.get(key);

  const params = new URLSearchParams({ track_name: title });
  if (artist) params.set('artist_name', artist);
  if (album) params.set('album_name', album);
  if (duration) params.set('duration', String(Math.round(duration)));

  let result = null;
  try {
    const exact = await json(`https://lrclib.net/api/get?${params}`);
    if (exact) result = { synced: exact.syncedLyrics || '', plain: exact.plainLyrics || '', instrumental: Boolean(exact.instrumental) };
    if (!result) {
      const wide = new URLSearchParams({ track_name: title });
      if (artist) wide.set('artist_name', artist);
      result = pick(await json(`https://lrclib.net/api/search?${wide}`));
    }
  } catch {
    result = null;
  }

  if (cache.size > 60) cache.clear();
  cache.set(key, result);
  return result;
}

module.exports = { lookup };

'use strict';

class DownloadError extends Error {}
const HOSTS = {
  tiktok: new Set(['tiktok.com', 'www.tiktok.com', 'm.tiktok.com', 'vm.tiktok.com', 'vt.tiktok.com']),
  facebook: new Set(['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com',
    'mbasic.facebook.com', 'fb.watch', 'www.fb.watch']),
  youtube: new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be', 'www.youtu.be'])
};

function validateUrl(input, platform) {
  if (!HOSTS[platform]) throw new DownloadError('Pilih downloader TikTok, Facebook, atau YouTube.');
  const text = String(input || '').trim();
  if (!text || text.length > 2048 || /[\s\x00-\x1f\\]/.test(text)) {
    throw new DownloadError('Tulis perintah diikuti satu URL video lengkap. Ketik !downloader untuk contoh perintah.');
  }
  let url;
  try { url = new URL(text); } catch { throw new DownloadError('URL tidak valid. Salin tautan lengkap dari aplikasi.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !HOSTS[platform].has(url.hostname)) {
    throw new DownloadError(`Gunakan tautan HTTPS resmi ${platform} sesuai perintahnya.`);
  }
  const p = url.pathname;
  url.hash = '';
  if (platform === 'youtube') {
    const id = /^(?:www\.)?youtu\.be$/.test(url.hostname) ? p.slice(1).replace(/\/$/, '')
      : /^\/watch\/?$/.test(p) ? url.searchParams.get('v')
        : p.match(/^\/(?:shorts|embed|live)\/([\w-]{11})\/?$/)?.[1];
    if (!/^[\w-]{11}$/.test(id || '')) throw new DownloadError('Gunakan URL satu video YouTube, youtu.be, atau Shorts. Link channel dan playlist tidak didukung.');
    return `https://www.youtube.com/watch?v=${id}`;
  }
  if (platform === 'tiktok') {
    const allowed = /^\/(?:@[\w.-]+\/video|share\/video)\/\d+\/?$/.test(p)
      || /^\/[\w-]+\/?$/.test(p) && /^(vm\.|vt\.)/.test(url.hostname)
      || /^\/t\/[\w-]+\/?$/.test(p);
    if (!allowed) throw new DownloadError('Gunakan tautan satu video TikTok. Profil, album foto, dan siaran langsung belum didukung.');
    if (['tiktok.com', 'm.tiktok.com'].includes(url.hostname)) url.hostname = 'www.tiktok.com';
    return url.href;
  }
  const id = '(?:[0-9]+|pfbid[A-Za-z0-9]+)';
  const videoPath = /^\/(?:reel|reels)\/\d+\/?$/.test(p)
    || /^\/share\/(?:[vrp]\/)?[\w-]+\/?$/.test(p)
    || /^\/(?:watch\/?|(?:video\/)?video\.php)?$/.test(p) && /^\d+$/.test(url.searchParams.get('v') || url.searchParams.get('video_id') || '')
    || new RegExp(`^/(?:[^/]+/)?videos/(?:[^/]+/)?${id}/?$`).test(p)
    || new RegExp(`^/[^/]+/posts/${id}/?$`).test(p)
    || new RegExp(`^/groups/[^/]+/(?:posts|permalink)/${id}/?$`).test(p)
    || /^\/(?:story|permalink)\.php$/.test(p) && new RegExp(`^${id}$`).test(url.searchParams.get('story_fbid') || '')
    || /^(www\.)?fb\.watch$/.test(url.hostname) && /^\/[\w-]+\/?$/.test(p);
  if (!videoPath) throw new DownloadError('Kirim tautan video, Reel, postingan video, atau link bagikan Facebook. Profil dan album foto belum didukung.');
  // Pertahankan m./web./mbasic. Memaksa www pada setiap hop bisa membuat loop.
  const rootVideo = p.match(/^\/videos\/(\d+)\/?$/)?.[1];
  if (p === '/' || rootVideo) {
    url.pathname = '/watch/';
    if (rootVideo) url.search = `?v=${rootVideo}`;
  }
  if (p.startsWith('/reels/')) url.pathname = p.replace('/reels/', '/reel/');
  return url.href;
}

function isFacebookShortLink(input) {
  const url = new URL(input);
  return /^(www\.)?fb\.watch$/.test(url.hostname) || url.pathname.startsWith('/share/');
}

function decodeHtml(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, entity => {
    const simple = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
    if (simple[entity.toLowerCase()]) return simple[entity.toLowerCase()];
    const code = entity.toLowerCase().startsWith('&#x') ? parseInt(entity.slice(3, -1), 16) : Number(entity.slice(2, -1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

function pageLinks(html) {
  const result = [];
  for (const tag of html.match(/<(?:meta|link)\b[^>]*>/gi) || []) {
    const attributes = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attributes[match[1].toLowerCase()] = decodeHtml(match[2] ?? match[3] ?? match[4]);
    }
    if ((attributes.property || attributes.name)?.toLowerCase() === 'og:url') result.push(attributes.content);
    if (attributes.rel?.toLowerCase() === 'canonical') result.push(attributes.href);
    if (attributes['http-equiv']?.toLowerCase() === 'refresh') {
      result.push(attributes.content?.match(/url\s*=\s*["']?([^"']+)/i)?.[1]?.trim());
    }
  }
  for (const match of html.matchAll(/"(?:video_permalink_url|permalink_url)"\s*:\s*("(?:[^"\\]|\\.)*")/g)) {
    try { result.push(JSON.parse(match[1])); } catch { /* Abaikan metadata rusak. */ }
  }
  return result.filter(Boolean);
}

async function readPage(response) {
  if (!response.body?.[Symbol.asyncIterator]) return '';
  const chunks = [];
  let length = 0;
  const limit = 2 * 1024 * 1024;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    chunks.push(buffer.subarray(0, limit - length));
    length += buffer.length;
    if (length >= limit) break;
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Cookie pengunjung hanya hidup selama satu permintaan, bukan sesi login pengguna.
function rememberCookies(jar, response, address) {
  const origin = new URL(address);
  for (const raw of response.headers.getSetCookie?.() || []) {
    if (raw.length > 4096) continue;
    const [pair, ...parts] = raw.split(';');
    const split = pair.indexOf('=');
    if (split < 1) continue;
    const name = pair.slice(0, split).trim(), value = pair.slice(split + 1).trim();
    if (!/^[\w-]+$/.test(name)) continue;
    const attributes = Object.fromEntries(parts.map(part => {
      const [key, ...rest] = part.trim().split('=');
      return [key.toLowerCase(), rest.join('=')];
    }));
    const domain = (attributes.domain || origin.hostname).replace(/^\./, '').toLowerCase();
    if (domain !== origin.hostname && !origin.hostname.endsWith(`.${domain}`)) continue;
    if (!domain.endsWith('facebook.com') && domain !== 'fb.watch') continue;
    const cookiePath = attributes.path?.startsWith('/') ? attributes.path : origin.pathname.slice(0, origin.pathname.lastIndexOf('/') + 1) || '/';
    const key = `${domain}:${cookiePath}:${name}`;
    if (attributes['max-age'] === '0') { jar.delete(key); continue; }
    if (jar.size >= 32 && !jar.has(key)) continue;
    jar.set(key, { name, value, domain, path: cookiePath, hostOnly: !attributes.domain });
  }
}

function cookieHeader(jar, address) {
  const url = new URL(address);
  return [...jar.values()].filter(c => (url.hostname === c.domain || !c.hostOnly && url.hostname.endsWith(`.${c.domain}`))
    && (url.pathname === c.path || url.pathname.startsWith(c.path.endsWith('/') ? c.path : `${c.path}/`)))
    .map(c => `${c.name}=${c.value}`).join('; ');
}

async function resolveVideoUrl(input, platform, { fetchUrl = fetch, timeoutMs = 30000, signal: stopSignal } = {}) {
  let url = validateUrl(input, platform);
  if (platform !== 'facebook' || !isFacebookShortLink(url)) return url;
  const signal = stopSignal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), stopSignal]) : AbortSignal.timeout(timeoutMs);
  const visited = new Set(), jar = new Map();
  for (let hop = 0; hop < 8; hop++) {
    const cookie = cookieHeader(jar, url);
    const state = `${url}\n${cookie}`;
    if (visited.has(state)) throw new DownloadError('Facebook mengulang pengalihan tautan yang sama. Coba URL video lengkap dari browser; kirim URL yang gagal ke pemilik bot untuk diperiksa.');
    visited.add(state);
    let response;
    try {
      response = await fetchUrl(url, { redirect: 'manual', signal, headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9', ...(cookie ? { Cookie: cookie } : {})
      } });
    } catch (error) {
      throw new DownloadError('Tautan Facebook tidak bisa dihubungi. Coba URL video lengkap atau ulangi nanti.', {
        cause: new Error(`Facebook network: ${error.cause?.code || error.code || error.name}`)
      });
    }
    rememberCookies(jar, response, url);
    const location = response.headers.get('location');
    if ([301, 302, 303, 307, 308].includes(response.status) && location) {
      await response.body?.cancel();
      const target = new URL(location, url);
      if (/\/(?:login|checkpoint|consent)(?:\/|\.php|$)/.test(target.pathname)) {
        throw new DownloadError('Facebook meminta login atau persetujuan untuk tautan ini. Gunakan video publik yang bisa dibuka tanpa login.');
      }
      url = validateUrl(target.href, 'facebook');
      if (!isFacebookShortLink(url)) return url;
      continue;
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new DownloadError(`Facebook menolak akses halaman (HTTP ${response.status}). Coba video publik lain atau ulangi nanti.`);
    }
    const html = await readPage(response);
    for (const candidate of pageLinks(html)) {
      try {
        const canonical = validateUrl(new URL(candidate, url).href, 'facebook');
        if (!isFacebookShortLink(canonical)) return canonical;
      } catch { /* Metadata halaman tidak boleh mengarahkan ke situs lain. */ }
    }
    throw new DownloadError('Halaman bagikan Facebook tidak memuat alamat video publik. Buka videonya lalu salin URL lengkap dari browser.');
  }
  throw new DownloadError('Terlalu banyak pengalihan Facebook. Coba URL video lengkap dari browser.');
}

module.exports = { DownloadError, validateUrl, resolveVideoUrl };

#!/usr/bin/env node
/* Refresh OpenDrop/screenshots-manifest.json AND download the
 * screenshots themselves into OpenDrop/screenshots/<platform>/
 * so the website serves them from our own origin.
 *
 * Why bother downloading?
 *   Apple and Microsoft rotate their CDN URLs without notice. The
 *   page was previously hot-linking those URLs, which meant any URL
 *   rotation broke every preview / link card / og:image until the
 *   next cron tick. Serving the files from our own /OpenDrop/screenshots/
 *   eliminates that failure mode entirely, and the cron only has to
 *   succeed *occasionally* (not on every page load) to keep the
 *   gallery current.
 *
 * Failure semantics:
 *   - Per-platform fetch failure: keep the previous manifest entries
 *     for that platform (the existing behavior).
 *   - Per-screenshot download failure where a local file already
 *     exists: keep the existing local file in the manifest (so the
 *     page never regresses on a transient image-CDN error).
 *   - Per-screenshot download failure where NO local file exists:
 *     drop that entry. Better to ship a 5-shot gallery than a broken
 *     6th tile.
 *   - We never delete local screenshot files even when they're no
 *     longer in the manifest. They're a few KB each and may come back
 *     in a future store revision.
 *
 * Sources (unchanged from previous version):
 *   - Microsoft Store:  storeedgefd JSON endpoint
 *   - iOS App Store:    iTunes Search API, then HTML scrape fallback
 *   - Mac App Store:    iTunes Search API only (empty == not released)
 *
 * Run: node scripts/refresh-screenshots-manifest.mjs
 *
 * Output:
 *   - OpenDrop/screenshots-manifest.json (committed)
 *   - OpenDrop/screenshots/<platform>/<hash>.<ext> (committed)
 *   - og:image meta in OpenDrop/index.html (committed)
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROOT = path.resolve(__dirname, '..');
const OUTPUT = path.join(ROOT, 'OpenDrop', 'screenshots-manifest.json');
const INDEX_HTML = path.join(ROOT, 'OpenDrop', 'index.html');
const SHOTS_DIR = path.join(ROOT, 'OpenDrop', 'screenshots');
const SITE_ORIGIN = 'https://www.nfdgames.com';

const MS_STORE_PRODUCT_ID = 'XP99SJJTQXZ9WT';
const APPLE_APP_ID = '6757438202';
const APP_STORE_URL = `https://apps.apple.com/us/app/opendrop/id${APPLE_APP_ID}`;

// Per-download timeout. Either store CDN can stall for a long time
// without ever 5xx'ing; abort and treat as a soft failure so the cron
// completes in bounded time.
const DOWNLOAD_TIMEOUT_MS = 20000;

/* ---------------------------------------------------------------- */
/* Store-API fetchers (unchanged behavior, copied verbatim from the */
/* previous version so we don't regress the source-of-truth logic). */
/* ---------------------------------------------------------------- */

async function fetchMicrosoftStoreScreenshots() {
  const url =
    `https://storeedgefd.dsx.mp.microsoft.com/v9.0/products/${MS_STORE_PRODUCT_ID}` +
    `?market=US&locale=en-US&deviceFamily=Windows.Desktop`;
  console.log(`[screenshots] GET ${url}`);
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Microsoft Store returned ${r.status} ${r.statusText}`);
  const json = await r.json();
  const images = json?.Payload?.Images || [];
  const screenshots = images
    .filter((img) => img && (img.ImageType || '').toLowerCase() === 'screenshot')
    .map((img, i) => {
      let u = img.Uri || img.Url || '';
      if (u.startsWith('//')) u = 'https:' + u;
      return {
        source_url: u,
        alt: `OpenDrop Windows screenshot ${i + 1}`,
        width: img.Width,
        height: img.Height,
      };
    })
    .filter((s) => s.source_url);
  console.log(`[screenshots] Microsoft Store -> ${screenshots.length} shots`);
  return screenshots;
}

/* Apple's lookup API hands back small thumbnails (…/320x480bb.jpg).
 * The same CDN path serves any size, so swap the final segment for a
 * 1080px-wide WebP: the carousel cards and the home page hero render
 * at up to 2x DPR and a 320px thumbnail looks soft there. The HTML
 * scrape fallback already requests this size. */
function upscaleAppleUrl(u) {
  return String(u).replace(/\/\d+x\d+[a-z]*\.(?:jpg|jpeg|png|webp)(\?.*)?$/i, '/1080x0w.webp');
}

async function fetchITunesSearchScreenshots(entity) {
  const url = `https://itunes.apple.com/lookup?id=${APPLE_APP_ID}&entity=${entity}&country=us`;
  console.log(`[screenshots] GET ${url}`);
  const r = await fetch(url);
  if (!r.ok) return [];
  const json = await r.json();
  const app = (json.results || [])[0];
  if (!app) return [];
  return app.screenshotUrls || [];
}

async function scrapeAppStoreHtml(platformLabel) {
  console.log(`[screenshots] GET ${APP_STORE_URL} (HTML scrape for ${platformLabel})`);
  const r = await fetch(APP_STORE_URL, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
    },
  });
  if (!r.ok) return [];
  const html = await r.text();
  const re =
    /https:\/\/is\d+-ssl\.mzstatic\.com\/image\/thumb\/PurpleSource\d+\/v4\/[a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9-]{36}\/[^"'\s\\]+/g;
  const all = html.match(re) || [];
  const stemRe =
    /^(https:\/\/is\d+-ssl\.mzstatic\.com\/image\/thumb\/PurpleSource\d+\/v4\/[a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9-]{36}\/[A-Za-z0-9_.\-]+)/;
  const stems = new Set();
  for (const u of all) {
    const m = u.match(stemRe);
    if (!m) continue;
    const stem = m[1];
    if (stem.includes('Placeholder.mill')) continue;
    if (/_iPad_|-iPad-|iPad_Pro|iPad-Pro/i.test(stem)) continue;
    stems.add(stem);
  }
  return Array.from(stems).map((stem, i) => ({
    source_url: `${stem}/1080x0w.webp`,
    alt: `OpenDrop ${platformLabel} screenshot ${i + 1}`,
  }));
}

async function fetchIosScreenshots() {
  const apiUrls = await fetchITunesSearchScreenshots('software');
  if (apiUrls.length) {
    console.log(`[screenshots] iTunes Search (iOS) -> ${apiUrls.length} shots`);
    return apiUrls.map((u, i) => ({
      source_url: upscaleAppleUrl(u),
      alt: `OpenDrop iOS screenshot ${i + 1}`,
    }));
  }
  const scraped = await scrapeAppStoreHtml('iOS');
  console.log(`[screenshots] App Store HTML (iOS) -> ${scraped.length} shots`);
  return scraped;
}

async function fetchMacScreenshots() {
  const apiUrls = await fetchITunesSearchScreenshots('macSoftware');
  if (apiUrls.length) {
    console.log(`[screenshots] iTunes Search (Mac) -> ${apiUrls.length} shots`);
    return apiUrls.map((u, i) => ({
      source_url: upscaleAppleUrl(u),
      alt: `OpenDrop macOS screenshot ${i + 1}`,
    }));
  }
  console.log(`[screenshots] Mac App Store -> 0 shots (Mac app not released)`);
  return [];
}

/* ---------------------------------------------------------------- */
/* Local downloading                                                 */
/* ---------------------------------------------------------------- */

function hashUrl(u) {
  return crypto.createHash('sha1').update(u).digest('hex').slice(0, 12);
}

/* Pick a sensible file extension. Apple URLs end in `.webp`, Microsoft
 * URLs are opaque (`...&format=source`), so for those we inspect the
 * Content-Type header after the download. */
function extFromUrl(u) {
  const m = u.match(/\.(webp|jpg|jpeg|png|gif|avif)(?:\?|#|$)/i);
  if (m) return m[1].toLowerCase().replace('jpeg', 'jpg');
  return null;
}
function extFromContentType(ct) {
  if (!ct) return 'jpg';
  ct = ct.toLowerCase();
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('png')) return 'png';
  if (ct.includes('gif')) return 'gif';
  if (ct.includes('avif')) return 'avif';
  return 'jpg'; // most CDNs default to JPEG
}

async function fileExistsAndNonEmpty(p) {
  try {
    const st = await fs.stat(p);
    return st.isFile() && st.size > 0;
  } catch (_) {
    return false;
  }
}

/* Find an already-downloaded file for the given hash. Lets us reuse
 * on a transient CDN failure even when we can't re-detect the
 * original Content-Type. We only match real image extensions so that
 * stray scratch files (e.g. ``foo.webp.bak``) never get served. */
const VALID_IMAGE_EXT_RE = /^(webp|jpg|jpeg|png|gif|avif)$/i;
async function findExistingFor(platformDir, hash) {
  try {
    const entries = await fs.readdir(platformDir);
    for (const name of entries) {
      if (!name.startsWith(hash + '.')) continue;
      const ext = name.slice(hash.length + 1);
      if (!VALID_IMAGE_EXT_RE.test(ext)) continue;
      const p = path.join(platformDir, name);
      if (await fileExistsAndNonEmpty(p)) return name;
    }
  } catch (_) { /* dir might not exist yet */ }
  return null;
}

/**
 * Download the source URL into OpenDrop/screenshots/<platform>/<hash>.<ext>
 * if not already present. Returns either:
 *   { ok: true,  webPath, reused: bool }
 *   { ok: false, reason }
 */
async function downloadIfMissing(sourceUrl, platform) {
  const hash = hashUrl(sourceUrl);
  const platformDir = path.join(SHOTS_DIR, platform);
  await fs.mkdir(platformDir, { recursive: true });

  // Reuse an existing local file (any extension) if we've already got it.
  const existing = await findExistingFor(platformDir, hash);
  if (existing) {
    return {
      ok: true,
      webPath: `screenshots/${platform}/${existing}`,
      reused: true,
    };
  }

  // Otherwise, fetch fresh.
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const r = await fetch(sourceUrl, { signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const ext = extFromUrl(sourceUrl) || extFromContentType(r.headers.get('content-type'));
    const fname = `${hash}.${ext}`;
    const fpath = path.join(platformDir, fname);
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) throw new Error('empty response body');
    await fs.writeFile(fpath, buf);
    console.log(`[screenshots] DL ${platform}/${fname} (${buf.length} bytes)`);
    return { ok: true, webPath: `screenshots/${platform}/${fname}`, reused: false };
  } catch (err) {
    // On download failure, fall back to a previously downloaded file
    // if one is present (e.g. saved on an earlier run).
    const fallback = await findExistingFor(platformDir, hash);
    if (fallback) {
      console.warn(
        `[screenshots] DL failed for ${sourceUrl.slice(-60)} (${err.message}); ` +
        `using existing local file ${fallback}`,
      );
      return {
        ok: true,
        webPath: `screenshots/${platform}/${fallback}`,
        reused: true,
        note: `download_failed_used_existing: ${err.message}`,
      };
    }
    return { ok: false, reason: err.message };
  } finally {
    clearTimeout(to);
  }
}

/* Materialize an array of fresh entries (each { source_url, alt, width?, height? })
 * into committed local copies. Returns the manifest-shaped array with
 * local urls. Entries whose downloads failed AND have no prior local
 * file are silently dropped (logged). */
async function materialize(entries, platform) {
  const out = [];
  for (const e of entries) {
    const result = await downloadIfMissing(e.source_url, platform);
    if (!result.ok) {
      console.warn(`[screenshots] dropping entry (no local fallback): ${e.source_url} — ${result.reason}`);
      continue;
    }
    out.push({
      url: result.webPath,        // what the page will <img src> from
      source_url: e.source_url,   // back-reference for debugging
      alt: e.alt,
      ...(e.width  ? { width:  e.width  } : {}),
      ...(e.height ? { height: e.height } : {}),
      ...(result.reused ? { reused: true } : {}),
      ...(result.note  ? { note: result.note } : {}),
    });
  }
  return out;
}

/* ---------------------------------------------------------------- */

async function main() {
  // Per-platform store fetch. Soft-fails to [] if any one store is
  // temporarily down so the cron stays useful for the other two.
  const [windows, mac, ios] = await Promise.allSettled([
    fetchMicrosoftStoreScreenshots(),
    fetchMacScreenshots(),
    fetchIosScreenshots(),
  ]).then((r) => r.map((x) => (x.status === 'fulfilled' ? x.value : [])));

  // Load previous manifest so we can preserve a platform's section on
  // a hard failure.
  let prev = null;
  try { prev = JSON.parse(await fs.readFile(OUTPUT, 'utf8')); } catch (_) {}

  // Convert each platform's fresh entries to local copies. If a
  // platform returned 0 fresh entries AND the previous manifest had
  // local entries for it, keep those entries — the gallery stays
  // populated even when the store API is having a bad day.
  async function materializeOrFallback(fresh, platform) {
    if (!fresh.length) {
      const prevEntries = (prev && prev[platform]) || [];
      if (prevEntries.length) {
        console.log(`[screenshots] ${platform}: store returned 0; keeping ${prevEntries.length} previous entries`);
      } else {
        console.log(`[screenshots] ${platform}: store returned 0 and no prior entries`);
      }
      return prevEntries;
    }
    return await materialize(fresh, platform);
  }

  const manifest = {
    generated: new Date().toISOString(),
    sources: {
      windows: 'https://apps.microsoft.com/store/detail/' + MS_STORE_PRODUCT_ID,
      ios: APP_STORE_URL,
      mac: APP_STORE_URL + '?entity=macSoftware',
    },
    windows: await materializeOrFallback(windows, 'windows'),
    ios:     await materializeOrFallback(ios,     'ios'),
    mac:     await materializeOrFallback(mac,     'mac'),
  };

  // Hero image used in <meta og:image> so social previews look right.
  // Prefer iOS, then Windows, then the bare app icon.
  function absolutize(webPath) {
    if (!webPath) return null;
    if (webPath.startsWith('http')) return webPath;
    return `${SITE_ORIGIN}/OpenDrop/${webPath}`;
  }
  const heroLocal = absolutize(manifest.ios[0]?.url) || absolutize(manifest.windows[0]?.url);
  manifest.heroImage = heroLocal || `${SITE_ORIGIN}/OpenDrop/OpenDropIcon.png`;

  await fs.writeFile(OUTPUT, JSON.stringify(manifest, null, 2) + '\n');
  console.log(
    `[screenshots] wrote ${OUTPUT} ` +
      `(windows=${manifest.windows.length}, ios=${manifest.ios.length}, mac=${manifest.mac.length})`,
  );

  // Patch the index.html og:image so crawlers (Facebook, Twitter,
  // LinkedIn, iMessage) get a real product shot. They scrape the raw
  // HTML and don't run our JS, so the swap has to happen in the
  // committed file.
  try {
    let html = await fs.readFile(INDEX_HTML, 'utf8');
    const before = html;
    const escaped = manifest.heroImage.replace(/"/g, '&quot;');
    html = html.replace(
      /(<meta property="og:image"[^>]*?content=")[^"]*("[^>]*>)/i,
      `$1${escaped}$2`,
    );
    html = html.replace(
      /(<meta name="twitter:image"[^>]*?content=")[^"]*("[^>]*>)/i,
      `$1${escaped}$2`,
    );
    if (html === before) {
      // Either the regexes didn't match (unexpected — file structure
      // changed) or the value was already correct. Distinguish so the
      // log is honest.
      const hasMeta = /<meta property="og:image"[^>]*>/i.test(html);
      if (hasMeta) {
        console.log(`[screenshots] og:image already up-to-date, no change`);
      } else {
        console.warn('[screenshots] og:image meta tags not found — skipped patch');
      }
    } else {
      await fs.writeFile(INDEX_HTML, html);
      console.log(`[screenshots] patched og:image in ${INDEX_HTML}`);
    }
  } catch (err) {
    console.warn(`[screenshots] og:image patch failed: ${err.message}`);
  }

  // Home page hero (root index.html): the two device mockups show real
  // store screenshots. Each <img data-shot="platform:index"> is pointed
  // at that entry of the manifest (index clamped to what exists), so the
  // hero follows the store listings the same way the carousel does.
  try {
    const HOME_HTML = path.join(ROOT, 'index.html');
    let html = await fs.readFile(HOME_HTML, 'utf8');
    const before = html;
    let tags = 0;
    html = html.replace(/<img\b[^>]*\bdata-shot="([a-z]+):(\d+)"[^>]*>/gi, (tag, platform, idx) => {
      tags += 1;
      const list = manifest[platform] || [];
      if (!list.length) return tag;
      const entry = list[Math.min(Number(idx), list.length - 1)];
      const src = entry.url.startsWith('http') ? entry.url : `/OpenDrop/${entry.url}`;
      return tag.replace(/\bsrc="[^"]*"/i, `src="${src}"`);
    });
    if (!tags) {
      console.warn('[screenshots] home hero: no <img data-shot> tags found — skipped patch');
    } else if (html === before) {
      console.log('[screenshots] home hero already up-to-date, no change');
    } else {
      await fs.writeFile(HOME_HTML, html);
      console.log(`[screenshots] patched ${tags} home hero image(s) in ${HOME_HTML}`);
    }
  } catch (err) {
    console.warn(`[screenshots] home hero patch failed: ${err.message}`);
  }

  if (!manifest.windows.length && !prev) {
    console.error(
      '[screenshots] no Windows screenshots and no prior manifest — failing',
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");
const cheerio = require("cheerio");

const ROOT = "https://www.khmeravenue.com/";
const ALBUM = "https://www.khmeravenue.com/album/";
const ITEMS_PER_PAGE = 24;

// ---------- tiny TTL cache ----------
function nowMs() { return Date.now(); }
class TTLCache {
  constructor({ max = 500, ttlMs = 10 * 60 * 1000 } = {}) {
    this.max = max; this.ttlMs = ttlMs; this.map = new Map();
  }
  get(key) {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.exp < nowMs()) { this.map.delete(key); return undefined; }
    this.map.delete(key); this.map.set(key, hit);
    return hit.val;
  }
  set(key, val, ttlMsOverride) {
    const exp = nowMs() + (ttlMsOverride ?? this.ttlMs);
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { exp, val });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
}
const htmlCache = new TTLCache({ max: 250, ttlMs: 8 * 60 * 1000 });
const metaCache = new TTLCache({ max: 250, ttlMs: 30 * 60 * 1000 });
const streamsCache = new TTLCache({ max: 400, ttlMs: 15 * 60 * 1000 });
const negativeCache = new TTLCache({ max: 200, ttlMs: 3 * 60 * 1000 });

// ---------- utils ----------
function b64encode(str) {
  return Buffer.from(str, "utf8").toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function b64decode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return Buffer.from(str, "base64").toString("utf8");
}
function safeText(s) { return (s || "").replace(/\s+/g, " ").trim(); }
function absUrl(u, base) { try { return new URL(u, base).toString(); } catch { return ""; } }
function extractStyleURL(style) {
  if (!style) return "";
  const m = style.match(/url\((.*?)\)/i);
  return m ? m[1].replace(/^['"]|['"]$/g, "") : "";
}
function htmlEntityDecode(s) {
  return (s || "")
    .replace(/&amp;/g, "&").replace(/&#038;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

async function fetchHTML(url) {
  if (negativeCache.get(url)) throw new Error(`Temp blocked (recent fail): ${url}`);
  const cached = htmlCache.get(url);
  if (cached) return cached;

  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", "Referer": ROOT },
    redirect: "follow"
  });
  if (!res.ok) { negativeCache.set(url, true); throw new Error(`Fetch ${res.status}`); }
  const text = await res.text();
  htmlCache.set(url, text);
  return text;
}

// ---------- pagination ----------
function skipToPage(skip) {
  const s = Number.isFinite(Number(skip)) ? Number(skip) : 0;
  return Math.floor(Math.max(0, s) / ITEMS_PER_PAGE) + 1;
}
function buildCatalogUrl({ search, page }) {
  if (search) return `${ROOT}?s=${encodeURIComponent(search)}&post_type=album&paged=${page}`;
  return `${ALBUM}page/${page}/`;
}

// ---------- catalog ----------
async function getCatalog({ search, skip }) {
  const page = skipToPage(skip);
  const url = buildCatalogUrl({ search: safeText(search), page });
  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  const metas = [];
  $("div.col-6.col-sm-4.thumbnail-container, div.card-content").each((_, el) => {
    const item = $(el);
    const isThumb = item.hasClass("thumbnail-container");

    let link = "", title = "", poster = "";
    if (isThumb) {
      link = item.find("a").first().attr("href") || "";
      title = safeText(item.find("h3").first().text());
      poster = extractStyleURL(item.find("div[style]").first().attr("style"), ROOT);
      //link = absUrl(link, ROOT);
    } else {
      link = item.find("a[href]").first().attr("href") || "";
      title = safeText(item.find("h3").first().text());
      poster = extractStyleURL(item.find("div.card-content-image").first().attr("style"), ROOT);
      //link = absUrl(link, ROOT);
    }
    if (!link || !title) return;

    metas.push({
      id: `khmerave:show:${b64encode(link)}`,
      type: "series",
      name: title,
      poster: poster || undefined,
      posterShape: "poster"
    });
  });

  return metas;
}

// ---------- episodes ----------
function detectEpisodeNumber(label) {
  const t = safeText(label);
  const m = t.match(/\b(?:ep|episode|part)\s*\.?\s*(\d{1,4})\b/i);
  if (m) return parseInt(m[1], 10);
  const m2 = t.match(/\bE\s*(\d{1,4})\b/i);
  if (m2) return parseInt(m2[1], 10);
  const m3 = t.match(/\b(\d{1,4})\b/);
  if (m3) return parseInt(m3[1], 10);
  return null;
}

async function getMeta(id) {
  const cached = metaCache.get(id);
  if (cached) return cached;

  const showUrl = b64decode(id.split(":").pop());
  const html = await fetchHTML(showUrl);
  const $ = cheerio.load(html);

  const title = safeText($("h1").first().text()) || safeText($("title").text()) || "KhmerAve";
  const poster =
    $("meta[property='og:image']").attr("content") ||
    $("meta[name='twitter:image']").attr("content") ||
    undefined;

  const eps = [];
  const seen = new Set();

  $("table#latest-videos a[href], div.col-xs-6.col-sm-6.col-md-3 a[href]").each((_, a) => {
    const href = $(a).attr("href");
    if (!href) return;
    const abs = absUrl(href, showUrl);
    if (!abs || seen.has(abs)) return;
    seen.add(abs);

    const label = safeText($(a).text());
    const num = detectEpisodeNumber(label);
    eps.push({ url: abs, label, num });
  });

  let videos = [];
  if (eps.length) {
    const haveNums = eps.filter(e => Number.isInteger(e.num)).length >= Math.ceil(eps.length * 0.5);
    let sorted = eps.slice();
    if (haveNums) sorted.sort((a, b) => (a.num ?? 999999) - (b.num ?? 999999));
    else sorted.reverse();

    videos = sorted.map((ep, idx) => {
      const epNum = Number.isInteger(ep.num) ? ep.num : (idx + 1);
      return {
        id: `khmerave:ep:${b64encode(ep.url)}`,
        title: `Episode ${String(epNum).padStart(2, "0")}`,
        season: 1,
        episode: epNum
      };
    });
  }

  const meta = { id, type: "series", name: title, poster, videos };
  metaCache.set(id, meta);
  return meta;
}

// ---------- stream resolver (Kodi-like) ----------
const BLACKLIST = ["googletagmanager.com", "facebook.com", "twitter.com", "doubleclick.net"];
function isBlacklisted(u) { const s = (u || "").toLowerCase(); return BLACKLIST.some(b => s.includes(b)); }
function isLikelyVideo(u) {
  const s = (u || "").toLowerCase().split("?")[0];
  return s.endsWith(".mp4") || s.endsWith(".m3u8") || s.endsWith(".mpd") || s.includes(".m3u8");
}
function tryBase64DecodeIframe(html) {
  const matches = [...html.matchAll(/Base64\.decode\("(.+?)"\)/g)];
  for (const m of matches) {
    try {
      const decoded = Buffer.from(m[1], "base64").toString("utf8");
      const iframe = decoded.match(/<iframe[^>]+src=["'](.+?)["']/i);
      if (iframe && iframe[1]) return iframe[1];
    } catch {}
  }
  return null;
}
function collectByRegex(html, patterns) {
  const out = [];
  for (const re of patterns) {
    for (const m of html.matchAll(re)) {
      const candidate = (m[1] || "").trim();
      if (candidate) out.push(candidate);
    }
  }
  return out;
}
async function resolveStreamsFromHtml(html, pageUrl) {
  const streams = [];

  const b64Iframe = tryBase64DecodeIframe(html);
  if (b64Iframe) {
    const u = absUrl(b64Iframe, pageUrl);
    if (u && !isBlacklisted(u)) streams.push({ title: "KhmerDubbed", url: u });
  }

  const $ = cheerio.load(html);
  $("iframe[src]").each((_, el) => {
    const u = absUrl($(el).attr("src"), pageUrl);
    if (u && !isBlacklisted(u)) streams.push({ title: "KhmerDubbed", url: u });
  });
  $("source[src]").each((_, el) => {
    const u = absUrl($(el).attr("src"), pageUrl);
    if (u && !isBlacklisted(u)) streams.push({ title: "KhmerDubbed", url: u });
  });

  const patterns = [
    /['"]?file['"]?\s*:\s*['"]([^'"]+)['"]/gi,
    /<iframe[^>]+src=["'](.+?)["'][^>]*>/gi,
    /swfobject\.embedSWF\(["'](.+?)["']/gi,
    /playlist\s*:\s*["']([^"']+)["']/gi,
    /src=["']([^"']+)["'][^>]*allow=["']autoplay["']/gi,
    /<source[^>]+src=["']([^"']+)["']/gi
  ];

  for (const u0 of collectByRegex(html, patterns)) {
    const u = absUrl(htmlEntityDecode(u0), pageUrl);
    if (u && !isBlacklisted(u)) streams.push({ title: "KhmerDubbed", url: u });
  }

  // dedup
  const seen = new Set();
  const unique = [];
  for (const s of streams) {
    if (!s.url || seen.has(s.url)) continue;
    seen.add(s.url);
    unique.push(s);
  }
  return unique;
}

async function getStreams(id) {
  const cached = streamsCache.get(id);
  if (cached) return cached;

  const epUrl = b64decode(id.split(":").pop());
  const html = await fetchHTML(epUrl);

  let streams = await resolveStreamsFromHtml(html, epUrl);

  // follow up to 2 embed pages (1 level)
  const follow = streams.map(s => s.url).filter(u => u && !isLikelyVideo(u)).slice(0, 2);
  for (const u of follow) {
    try {
      const innerHtml = await fetchHTML(u);
      streams = streams.concat(await resolveStreamsFromHtml(innerHtml, u));
    } catch {}
  }

  // final dedup + prefer direct video first
  const seen = new Set();
  const final = [];
  for (const s of streams) {
    if (!s.url || isBlacklisted(s.url) || seen.has(s.url)) continue;
    seen.add(s.url);
    final.push(s);
  }
  final.sort((a, b) => (isLikelyVideo(a.url) ? 0 : 1) - (isLikelyVideo(b.url) ? 0 : 1));

  const result = final.length ? final : [{ title: "KhmerDubbed", url: epUrl }];
  streamsCache.set(id, result);
  return result;
}

// ---------- manifest ----------
const manifest = {
  id: "community.khmerdubbed",
  version: "1.1.0",
  name: "KhmerDubbed",
  description: "KhmerDubbed – KhmerAve (prototype).",
  resources: ["catalog", "meta", "stream"],
  types: ["series"],
  catalogs: [
    {
      type: "series",
      id: "khmerave-series",
      name: "KhmerAve",
      extra: [{ name: "search", isRequired: false }, { name: "skip", isRequired: false }]
    }
  ]
};

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  if (type !== "series" || id !== "khmerave-series") return { metas: [] };
  return { metas: await getCatalog({ search: extra?.search || "", skip: extra?.skip || 0 }) };
});

builder.defineMetaHandler(async ({ type, id }) => {
  if (type !== "series" || !id.startsWith("khmerave:show:")) return { meta: null };
  return { meta: await getMeta(id) };
});

builder.defineStreamHandler(async ({ type, id }) => {
  if (type !== "series" || !id.startsWith("khmerave:ep:")) return { streams: [] };
  return { streams: await getStreams(id) };
});

// vercel entry (fast manifest + safe handler)
module.exports = async (req, res) => {
  try {
    const url = req.url || "";

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("access-control-allow-methods", "GET,HEAD,OPTIONS");
      res.setHeader("access-control-allow-headers", "*");
      res.end();
      return;
    }

    // Fast path for manifest (important for Stremio)
    if (url.startsWith("/manifest.json")) {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("access-control-allow-headers", "*");
      res.setHeader("cache-control", "no-store");
      res.end(JSON.stringify(manifest));
      return;
    }

    // Let SDK handle everything else
    await serveHTTP(builder.getInterface(), { req, res });

  } catch (err) {
    console.error("KhmerDubbed handler error:", err && (err.stack || err.message || err));
    res.statusCode = 500;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.end("Internal Server Error");
  }
};

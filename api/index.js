import { addonBuilder, serveHTTP } from "stremio-addon-sdk";
import cheerio from "cheerio";

const ROOT = "https://www.khmeravenue.com/";
const ALBUM = "https://www.khmeravenue.com/album/";

// -----------------------------
// Utilities
// -----------------------------
function b64encode(str) {
  return Buffer.from(str, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function b64decode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  return Buffer.from(str, "base64").toString("utf8");
}

async function fetchHTML(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Referer": ROOT
    }
  });
  if (!res.ok) throw new Error(`Failed ${res.status}`);
  return await res.text();
}

function extractStyleURL(style) {
  if (!style) return "";
  const m = style.match(/url\((.*?)\)/);
  return m ? m[1].replace(/^['"]|['"]$/g, "") : "";
}

// -----------------------------
// Catalog (Show listing)
// -----------------------------
async function getCatalog({ search, skip }) {
  const page = Math.floor((skip || 0) / 20) + 1;

  const url = search
    ? `${ROOT}?s=${encodeURIComponent(search)}&post_type=album`
    : `${ALBUM}page/${page}/`;

  const html = await fetchHTML(url);
  const $ = cheerio.load(html);

  const metas = [];

  $("div.col-6.col-sm-4.thumbnail-container, div.card-content").each((_, el) => {
    const item = $(el);
    const isThumb = item.hasClass("thumbnail-container");

    let link = "";
    let title = "";
    let poster = "";

    if (isThumb) {
      link = item.find("a").first().attr("href") || "";
      title = item.find("h3").first().text().trim();
      poster = extractStyleURL(item.find("div[style]").first().attr("style"));
    } else {
      const a = item.find("a[href]").first();
      link = a.attr("href") || "";
      title = item.find("h3").first().text().trim();
      poster = extractStyleURL(
        item.find("div.card-content-image").first().attr("style")
      );
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

// -----------------------------
// Meta (Episodes)
// -----------------------------
async function getMeta(id) {
  const showUrl = b64decode(id.split(":").pop());
  const html = await fetchHTML(showUrl);
  const $ = cheerio.load(html);

  const title =
    $("h1").first().text().trim() ||
    $("title").text().trim() ||
    "KhmerAvenue";

  const poster =
    $("meta[property='og:image']").attr("content") || undefined;

  const episodes = [];
  const links = [];

  $("table#latest-videos a[href], div.col-xs-6.col-sm-6.col-md-3 a[href]")
    .each((_, a) => {
      const href = $(a).attr("href");
      if (!href) return;
      const abs = new URL(href, showUrl).toString();
      if (!links.includes(abs)) links.push(abs);
    });

  links.reverse();

  links.forEach((epUrl, index) => {
    episodes.push({
      id: `khmerave:ep:${b64encode(epUrl)}`,
      title: `Episode ${String(index + 1).padStart(2, "0")}`,
      season: 1,
      episode: index + 1
    });
  });

  return {
    id,
    type: "series",
    name: title,
    poster,
    videos: episodes
  };
}

// -----------------------------
// Streams
// -----------------------------
async function getStreams(id) {
  const epUrl = b64decode(id.split(":").pop());
  const html = await fetchHTML(epUrl);

  const streams = [];
  const $ = cheerio.load(html);

  // iframe sources
  $("iframe[src]").each((_, el) => {
    const src = $(el).attr("src");
    if (!src) return;
    streams.push({
      title: "KhmerAvenue",
      url: new URL(src, epUrl).toString()
    });
  });

  // file: "..."
  const matches = [...html.matchAll(/file\s*:\s*['"]([^'"]+)['"]/gi)];
  matches.forEach(m => {
    streams.push({
      title: "KhmerAvenue",
      url: new URL(m[1], epUrl).toString()
    });
  });

  return streams;
}

// -----------------------------
// Stremio Manifest
// -----------------------------
const manifest = {
  id: "community.khmeravenue",
  version: "1.0.0",
  name: "KhmerAvenue",
  description: "KhmerAvenue Series Catalog",
  resources: ["catalog", "meta", "stream"],
  types: ["series"],
  catalogs: [
    {
      type: "series",
      id: "khmerave-series",
      name: "KhmerAvenue",
      extra: [
        { name: "search", isRequired: false },
        { name: "skip", isRequired: false }
      ]
    }
  ]
};

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  if (type !== "series" || id !== "khmerave-series") return { metas: [] };
  return { metas: await getCatalog(extra || {}) };
});

builder.defineMetaHandler(async ({ type, id }) => {
  if (type !== "series" || !id.startsWith("khmerave:show:"))
    return { meta: null };
  return { meta: await getMeta(id) };
});

builder.defineStreamHandler(async ({ type, id }) => {
  if (type !== "series" || !id.startsWith("khmerave:ep:"))
    return { streams: [] };
  return { streams: await getStreams(id) };
});

// Vercel entry
export default (req, res) => {
  serveHTTP(builder.getInterface(), { req, res });
};

// Local dev (optional)
if (process.env.NODE_ENV !== "production") {
  serveHTTP(builder.getInterface(), { port: 7000 });
  console.log("Running at http://localhost:7000/manifest.json");
}

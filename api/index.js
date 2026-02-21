import sdk from "stremio-addon-sdk";
import axios from "axios";
import * as cheerio from "cheerio";

const { addonBuilder, serveHTTP } = sdk;

const ROOT = "https://www.khmeravenue.com/";
const ALBUM = "https://www.khmeravenue.com/album/";

const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 10; K) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/137.0.0.0 Mobile Safari/537.36";

const http = axios.create({
  timeout: 12000,
  headers: {
    "User-Agent": USER_AGENT,
    "Referer": ROOT,
    "Accept": "text/html,application/xhtml+xml"
  }
});

const manifest = {
  id: "community.khmerdubbed",
  version: "1.0.0",
  name: "KhmerDubbed",
  description: "KhmerAvenue Catalog (Phase 1)",
  resources: ["catalog"],
  types: ["series"],
  catalogs: [
    {
      type: "series",
      id: "khmerave-series",
      name: "KhmerAve",
      extra: [
        { name: "search", isRequired: false },
        { name: "skip", isRequired: false }
      ]
    }
  ]
};

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  try {
    if (type !== "series" || id !== "khmerave-series")
      return { metas: [] };

    const page = Math.floor((Number(extra?.skip || 0)) / 24) + 1;

    const url = extra?.search
      ? `${ROOT}?s=${encodeURIComponent(extra.search)}&post_type=album`
      : `${ALBUM}page/${page}/`;

    // HARD TIMEOUT (10 seconds max)
    const response = await Promise.race([
      http.get(url),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("KhmerAve timeout")), 10000)
      )
    ]);

    const { data } = response;
    const $ = cheerio.load(data);

    const metas = [];

    $("div.col-6.col-sm-4.thumbnail-container, div.card-content").each((_, el) => {
      const item = $(el);
      const a = item.find("a[href]").first();
      const title = item.find("h3").first().text().trim();
      const link = a.attr("href");

      if (title && link) {
        metas.push({
          id: `khmerave:${Buffer.from(link).toString("base64")}`,
          type: "series",
          name: title
        });
      }
    });

    return { metas };

  } catch (err) {
    console.error("KhmerAve blocked or timed out:", err.message);
    return { metas: [] };   // NEVER hang
  }
});

export default async function handler(req, res) {
  try {
    const url = req.url || "";

    if (url.startsWith("/manifest.json")) {
      res.statusCode = 200;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.setHeader("access-control-allow-origin", "*");
      res.end(JSON.stringify(manifest));
      return;
    }

    await serveHTTP(builder.getInterface(), { req, res });

  } catch (err) {
    console.error("Handler error:", err?.message || err);
    res.statusCode = 500;
    res.end("Internal Server Error");
  }
}

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

builder.defineCatalogHandler(async ({ type, id }) => {
  if (type !== "series" || id !== "khmerave-series")
    return { metas: [] };

  return {
    metas: [
      {
        id: "test1",
        type: "series",
        name: "Test Drama 1"
      },
      {
        id: "test2",
        type: "series",
        name: "Test Drama 2"
      }
    ]
  };
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

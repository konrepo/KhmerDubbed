import sdk from "stremio-addon-sdk";

const { addonBuilder, serveHTTP } = sdk;

// ------------------
// Manifest
// ------------------

const manifest = {
  id: "community.khmerdubbed",
  version: "1.0.0",
  name: "KhmerDubbed",
  description: "KhmerDubbed Test Build",
  resources: ["catalog"],
  types: ["series"],
  catalogs: [
    {
      type: "series",
      id: "khmerave-series",
      name: "KhmerAve"
    }
  ]
};

// ------------------
// Builder
// ------------------

const builder = new addonBuilder(manifest);

// ------------------
// Simple Test Catalog
// ------------------

builder.defineCatalogHandler(() => ({
  metas: [
    { id: "1", type: "series", name: "Test Drama 1" },
    { id: "2", type: "series", name: "Test Drama 2" }
  ]
}));

// ------------------
// Vercel Handler
// ------------------

export default function handler(req, res) {
  const url = req.url || "";

  // Ignore favicon
  if (url === "/favicon.ico") {
    res.statusCode = 204;
    res.end();
    return;
  }

  // Let SDK handle EVERYTHING else
  serveHTTP(builder.getInterface(), { req, res });
}

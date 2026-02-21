const { addonBuilder, serveHTTP } = require("stremio-addon-sdk");

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

module.exports = (req, res) => {
  const url = req.url || "";

  if (url === "/favicon.ico") {
    res.statusCode = 204;
    res.end();
    return;
  }

  serveHTTP(builder.getInterface(), { req, res });
};

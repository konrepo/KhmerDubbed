import { addonBuilder, serveHTTP } from "stremio-addon-sdk";

export const config = {
  runtime: "nodejs"
};

const manifest = {
  id: "community.khmerdubbed",
  version: "1.0.0",
  name: "KhmerDubbed",
  description: "KhmerDubbed Test Build",
  resources: ["catalog"],
  types: ["series"],
  catalogs: [
    { type: "series", id: "khmerave-series", name: "KhmerAve" }
  ]
};

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(() => ({
  metas: [
    { id: "1", type: "series", name: "Test Drama 1" },
    { id: "2", type: "series", name: "Test Drama 2" }
  ]
}));

export default function handler(req, res) {
  serveHTTP(builder.getInterface(), { req, res });
}

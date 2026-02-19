// api/index.js -- TEMPORARY SMOKE TEST
export default (req, res) => {
  const manifest = {
    id: "community.khmerdubbed-test",
    version: "0.0.1",
    name: "KhmerDubbed (smoke test)",
    resources: ["catalog", "meta", "stream"],
    types: ["series"],
    catalogs: [{ type: "series", id: "khmerave-series", name: "KhmerAve" }]
  };
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(manifest));
};

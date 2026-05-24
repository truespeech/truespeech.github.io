// Resolve module / data URLs for dev (file:// or localhost) vs production
// (CDN-pinned versions).
//
// The TS runtime is pinned to a tagged release so pushing main never
// changes what the live demo loads. The data files (semantic model,
// schema, sample data) are reused from the OSI demo's data directory
// so we don't duplicate the retail_sales corpus.
const isDev = typeof location !== "undefined" &&
    (location.hostname === "localhost" || location.hostname === "127.0.0.1");
function resolve(relativePath) {
    return new URL(relativePath, import.meta.url).href;
}
export const IMPORTS = {
    trueSpeech: isDev
        ? resolve("../../../truespeech/dist/index.js")
        : "https://cdn.jsdelivr.net/gh/truespeech/truespeech@v0.3.0/dist/index.js",
    osiRuntime: isDev
        ? resolve("../../../osi-runtime/dist/index.js")
        : "https://cdn.jsdelivr.net/gh/truespeech/osi-runtime@v0.2.0/dist/index.js",
    schema: isDev
        ? resolve("../../osi-runtime/data/schema.sql")
        : "https://cdn.jsdelivr.net/gh/truespeech/truespeech.github.io@main/osi-runtime/data/schema.sql",
    data: isDev
        ? resolve("../../osi-runtime/data/data.sql")
        : "https://cdn.jsdelivr.net/gh/truespeech/truespeech.github.io@main/osi-runtime/data/data.sql",
    semanticModel: isDev
        ? resolve("../../osi-runtime/data/semantic_model.yaml")
        : "https://cdn.jsdelivr.net/gh/truespeech/truespeech.github.io@main/osi-runtime/data/semantic_model.yaml",
};

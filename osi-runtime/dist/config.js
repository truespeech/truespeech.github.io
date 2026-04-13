const isDev = typeof location !== "undefined" &&
    (location.hostname === "localhost" || location.hostname === "127.0.0.1");
function resolve(relativePath) {
    return new URL(relativePath, import.meta.url).href;
}
export const IMPORTS = {
    osiRuntime: isDev
        ? resolve("../../../osi-runtime/dist/index.js")
        : "https://cdn.jsdelivr.net/gh/truespeech/osi-runtime@main/dist/index.js",
    schema: isDev
        ? resolve("../data/schema.sql")
        : "https://cdn.jsdelivr.net/gh/truespeech/truespeech.github.io@main/osi-runtime/data/schema.sql",
    data: isDev
        ? resolve("../data/data.sql")
        : "https://cdn.jsdelivr.net/gh/truespeech/truespeech.github.io@main/osi-runtime/data/data.sql",
    semanticModel: isDev
        ? resolve("../data/semantic_model.yaml")
        : "https://cdn.jsdelivr.net/gh/truespeech/truespeech.github.io@main/osi-runtime/data/semantic_model.yaml",
};

// Tutorial page entry point.
//
// Loads the runtime + OSI semantic layer, initializes a single shared
// (read-only) DuckDB, then walks the content outline, rendering each
// block: prose (html), a frozen cell, or an interactive standalone
// cell. The DB and semantic layer are shared across all cells; each
// cell gets its own lexicon (see standalone-cell.ts).

import { IMPORTS } from "../../sandbox/dist/config.js";
import { initDatabase, query as dbQuery } from "../../sandbox/dist/db.js";
import type { TsRuntimeApi } from "../../sandbox/dist/runtime.js";
import {
  createStandaloneCell,
  createFrozenCell,
  type CellDeps,
} from "./standalone-cell.js";
import { OUTLINE } from "./content.js";

async function main() {
  const container = document.getElementById("tutorial");
  if (!container) {
    console.error("No #tutorial container found");
    return;
  }

  const loadingEl = document.createElement("div");
  loadingEl.className = "loading";
  loadingEl.textContent = "Loading runtimes and initializing DuckDB…";
  container.appendChild(loadingEl);

  try {
    const jsYamlUrl = "https://cdn.jsdelivr.net/npm/js-yaml/+esm";
    const [tsModule, osiModule, jsYaml]: [TsRuntimeApi, any, any] =
      await Promise.all([
        import(IMPORTS.trueSpeech) as Promise<TsRuntimeApi>,
        import(IMPORTS.osiRuntime),
        import(jsYamlUrl),
      ]);

    const yamlText = await fetch(IMPORTS.semanticModel).then((r) => r.text());
    const modelObj = jsYaml.default.load(yamlText);
    const osi = new osiModule.OsiRuntime(modelObj);

    const [schemaSQL, dataSQL] = await Promise.all([
      fetch(IMPORTS.schema).then((r) => r.text()),
      fetch(IMPORTS.data).then((r) => r.text()),
    ]);
    await initDatabase(schemaSQL, dataSQL);

    const deps: CellDeps = {
      tsModule,
      semanticLayer: tsModule.osiAdapter(osi),
      dbExecute: dbQuery,
    };

    loadingEl.remove();

    // Walk the outline in order. Cells are async (they seed a lexicon
    // and run an initial query), so build sequentially — the page
    // fills top-to-bottom.
    for (const block of OUTLINE) {
      if (block.kind === "html") {
        const wrap = document.createElement("div");
        wrap.innerHTML = block.html.trim();
        // Unwrap the single container so section/div lands directly.
        while (wrap.firstChild) container.appendChild(wrap.firstChild);
      } else if (block.kind === "frozen") {
        container.appendChild(
          await createFrozenCell(block.source, deps, block.seed ?? [])
        );
      } else {
        container.appendChild(await createStandaloneCell(block.config, deps));
      }
    }
  } catch (err: unknown) {
    loadingEl.textContent = `Failed to initialize: ${
      err instanceof Error ? err.message : String(err)
    }`;
    loadingEl.style.color = "#f44747";
    console.error("Initialization error:", err);
  }
}

main();

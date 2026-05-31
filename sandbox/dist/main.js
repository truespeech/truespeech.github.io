// TrueSpeech sandbox — wires the runtime to an append-only notebook
// surface over an in-browser DuckDB.
//
// On every submit (typed into the notebook, or invoked via a canned
// query), parse → validate → execute, then dispatch on the statement
// kind and append a structured HTML cell to the notebook. The cell
// renderers and runtime types live in ./render.js and ./runtime.js so
// the tutorial page's standalone cells can reuse them.
import { IMPORTS } from "./config.js";
import { initDatabase, query as dbQuery } from "./db.js";
import { createNotebook } from "./notebook.js";
import { MemoryLexicon } from "./runtime.js";
import { renderComputeCell, renderRegisterCell, renderCheckCell, renderShowLexiconCell, renderShowSchemaCell, renderUnregisterCell, renderErrorCell, } from "./render.js";
const SEED_STATEMENTS = [
    `REGISTER region q1_data_quality_issue
     IMPACTING total_sales OVER 2026-02-15 to 2026-02-20
     WITH "Order amounts undercounted by ~12% during a backfill window — investigate before reporting Q1 totals."`,
    `REGISTER region northeast_fulfillment_outage
     IMPACTING total_sales OVER 2026-03-08 to 2026-03-12 AND region = 'northeast'
     WITH "Northeast distribution center went offline; orders deferred or lost during this window."`,
    `REGISTER boundary aov_definition_change
     AT 2026-01-01
     IMPACTING average_order_value
     BEFORE "v1 (refund-inclusive)" "AOV included refund-adjusted amounts; values are systematically higher than the post-cut figure."
     AFTER  "v2 (refund-excluding)" "AOV excludes refunds; closer to the gross-of-refunds figure that the finance team reports."`,
    `REGISTER boundary enterprise_price_reset
     AT 2026-04-01 AND product_tier = 'enterprise'
     IMPACTING total_sales
     BEFORE "v1 enterprise pricing" "Enterprise tier list prices set during the 2025 reset; promo discounts were active."
     AFTER  "v2 enterprise pricing" "Enterprise tier prices were lifted ~20%, and all promo discounts retired on Apr 1."`,
];
async function main() {
    const container = document.getElementById("demo");
    if (!container) {
        console.error("No #demo container found");
        return;
    }
    const loadingEl = document.createElement("div");
    loadingEl.className = "loading";
    loadingEl.textContent = "Loading runtimes and initializing DuckDB…";
    container.appendChild(loadingEl);
    try {
        const jsYamlUrl = "https://cdn.jsdelivr.net/npm/js-yaml/+esm";
        const [tsModule, osiModule, jsYaml] = await Promise.all([
            import(IMPORTS.trueSpeech),
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
        const lexicon = new MemoryLexicon();
        const ts = new tsModule.TrueSpeech({
            semanticLayer: tsModule.osiAdapter(osi),
            database: { execute: dbQuery },
            lexicon,
            // NorthStar's data corpus spans Jan 2025 – Apr 2026; feed those
            // years to the runtime so Tab at time-literal positions surfaces
            // concrete year / quarter / month candidates.
            timeLiteralYears: [2025, 2026],
        });
        for (const stmt of SEED_STATEMENTS) {
            await ts.execute(stmt);
        }
        lexicon.snapshotSeed();
        loadingEl.remove();
        const notebook = createNotebook({
            placeholder: "Enter a TS statement — press Tab to see what's valid here",
            onSubmit: (source) => handleSubmit(source, ts, tsModule, notebook),
            onComplete: (source, position) => ts.complete(source, position),
        });
        container.appendChild(notebook.element);
        notebook.focus();
    }
    catch (err) {
        loadingEl.textContent = `Failed to initialize: ${err instanceof Error ? err.message : String(err)}`;
        loadingEl.style.color = "#f44747";
        console.error("Initialization error:", err);
    }
}
async function handleSubmit(source, ts, tsModule, notebook) {
    const trimmed = source.trim();
    if (trimmed.length === 0)
        return;
    const { ast, errors: parseErrors } = ts.parse(trimmed);
    if (parseErrors.length > 0) {
        notebook.addCell(renderErrorCell(trimmed, parseErrors, tsModule));
        return;
    }
    if (!ast) {
        notebook.addCell(renderErrorCell(trimmed, [{ message: "Empty input" }], tsModule));
        return;
    }
    const { errors: validateErrors } = ts.validate(ast);
    if (validateErrors.length > 0) {
        notebook.addCell(renderErrorCell(trimmed, validateErrors, tsModule));
        return;
    }
    try {
        const result = await ts.execute(trimmed);
        switch (result.statement) {
            case "compute":
                notebook.addCell(renderComputeCell(trimmed, result, tsModule));
                break;
            case "register":
                notebook.addCell(renderRegisterCell(trimmed, result));
                break;
            case "check":
                notebook.addCell(renderCheckCell(trimmed, result));
                break;
            case "show":
                if (result.subject === "lexicon") {
                    notebook.addCell(renderShowLexiconCell(trimmed, result));
                }
                else {
                    notebook.addCell(renderShowSchemaCell(trimmed, result));
                }
                break;
            case "unregister":
                notebook.addCell(renderUnregisterCell(trimmed, result));
                break;
        }
    }
    catch (err) {
        notebook.addCell(renderErrorCell(trimmed, [{ message: err instanceof Error ? err.message : String(err) }], tsModule));
    }
}
main();

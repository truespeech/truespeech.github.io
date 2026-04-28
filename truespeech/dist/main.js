// True Speech demo — wires the runtime to two REPL panels (TS top,
// SQL bottom) over a shared DuckDB instance, with an in-memory lexicon
// rendered as a panel above.
//
// On every TS submit, parse → validate → execute, then dispatch on the
// statement kind: COMPUTE renders SQL + results (and any reconciliation
// matches), REGISTER appends to the lexicon and refreshes the panel,
// CHECK lists matching entries.
import { IMPORTS } from "./config.js";
import { initDatabase, query as dbQuery } from "./db.js";
import { createRepl, createConnector } from "./repl.js";
import { createLexiconPanel } from "./lexicon-panel.js";
// In-memory LexiconAdapter with delete/reset extensions for the panel.
// Snapshot the seed at construction; reset() restores it.
class MemoryLexicon {
    entries = [];
    seed = [];
    // ----- LexiconAdapter (used by the runtime) -----
    async add(entry) {
        this.entries.push(entry);
    }
    async list() {
        return this.entries.map(cloneEntry);
    }
    // ----- Panel API -----
    getEntries() {
        return this.entries.map(cloneEntry);
    }
    delete(name) {
        this.entries = this.entries.filter((e) => e.name !== name);
    }
    // Capture the current state as the seed (called after running the
    // seed REGISTERs through the runtime).
    snapshotSeed() {
        this.seed = this.entries.map(cloneEntry);
    }
    reset() {
        this.entries = this.seed.map(cloneEntry);
    }
}
function cloneEntry(e) {
    return {
        name: e.name,
        description: e.description,
        impacts: e.impacts.map((i) => ({
            metric: i.metric,
            region: {
                timeStart: i.region.timeStart,
                timeEnd: i.region.timeEnd,
                constraints: i.region.constraints.map((c) => ({ ...c })),
            },
        })),
    };
}
const SEED_STATEMENTS = [
    `REGISTER region q1_data_quality_issue
     IMPACTING total_sales OVER 2026-02-15 to 2026-02-20
     WITH "Order amounts undercounted by ~12% during a backfill window — investigate before reporting Q1 totals."`,
    `REGISTER region northeast_fulfillment_outage
     IMPACTING total_sales OVER 2026-03-08 to 2026-03-12 AND region = 'northeast'
     WITH "Northeast distribution center went offline; orders deferred or lost during this window."`,
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
        });
        // Run seed REGISTERs through the runtime so the lexicon ends up
        // with proper resolved regions, then snapshot for reset.
        for (const stmt of SEED_STATEMENTS) {
            await ts.execute(stmt);
        }
        lexicon.snapshotSeed();
        loadingEl.remove();
        const lexiconPanel = createLexiconPanel({
            getEntries: () => lexicon.getEntries(),
            onDelete: (name) => lexicon.delete(name),
            onReset: () => lexicon.reset(),
            renderRegion: tsModule.renderRegion,
        });
        const tsRepl = createRepl({
            prompt: "ts> ",
            label: "True Speech",
            onSubmit: (input) => handleTsCommand(input, ts, tsModule, tsRepl, dbRepl, connector, lexiconPanel),
        });
        const connector = createConnector();
        const dbRepl = createRepl({
            prompt: "sql> ",
            label: "DuckDB",
            onSubmit: (input) => handleSqlCommand(input, dbRepl),
        });
        const examples = [
            {
                label: "Total 2026 sales",
                command: "COMPUTE total_sales OVER 2026",
            },
            {
                label: "Hits Feb anomaly",
                command: "COMPUTE total_sales OVER 2026-02",
            },
            {
                label: "By region",
                command: "COMPUTE total_sales OVER 2026 GROUP BY region",
            },
            {
                label: "Monthly trend",
                command: "COMPUTE total_sales OVER 2026 GROUP BY month ORDER BY month",
            },
            {
                label: "Q4→Q1 by tier",
                command: "COMPUTE average_order_value OVER 2025-Q4 to 2026-Q1 GROUP BY product_tier",
            },
            {
                label: "Check Q1",
                command: "CHECK total_sales, average_order_value OVER 2026-Q1",
            },
            {
                label: "Register a flag",
                command: `REGISTER region promo_spike\n  IMPACTING total_sales OVER 2026-03-15 to 2026-03-22\n  WITH "Spring promotion ran during this window"`,
            },
        ];
        const exampleBar = document.createElement("div");
        exampleBar.className = "example-bar";
        const exampleLabel = document.createElement("span");
        exampleLabel.className = "example-label";
        exampleLabel.textContent = "Try:";
        exampleBar.appendChild(exampleLabel);
        for (const ex of examples) {
            const btn = document.createElement("button");
            btn.className = "example-button";
            btn.textContent = ex.label;
            btn.addEventListener("click", () => tsRepl.setInput(ex.command));
            exampleBar.appendChild(btn);
        }
        container.appendChild(lexiconPanel.element);
        container.appendChild(exampleBar);
        container.appendChild(tsRepl.element);
        container.appendChild(connector.element);
        container.appendChild(dbRepl.element);
        tsRepl.focus();
    }
    catch (err) {
        loadingEl.textContent = `Failed to initialize: ${err instanceof Error ? err.message : String(err)}`;
        loadingEl.style.color = "#f44747";
        console.error("Initialization error:", err);
    }
}
async function handleTsCommand(input, ts, tsModule, tsRepl, dbRepl, connector, lexiconPanel) {
    const trimmed = input.trim();
    if (trimmed.length === 0)
        return;
    const { ast, errors: parseErrors } = ts.parse(trimmed);
    if (parseErrors.length > 0) {
        renderErrorList(parseErrors, trimmed, tsModule.renderError, tsRepl);
        return;
    }
    if (!ast) {
        tsRepl.appendError("Empty input");
        return;
    }
    const { errors: validateErrors } = ts.validate(ast);
    if (validateErrors.length > 0) {
        renderErrorList(validateErrors, trimmed, tsModule.renderError, tsRepl);
        return;
    }
    try {
        const result = await ts.execute(trimmed);
        switch (result.statement) {
            case "compute":
                await renderCompute(result, tsRepl, dbRepl, connector, tsModule);
                break;
            case "register":
                renderRegister(result, tsRepl);
                lexiconPanel.refresh();
                break;
            case "check":
                renderCheck(result, tsRepl, tsModule);
                break;
        }
    }
    catch (err) {
        tsRepl.appendError(err instanceof Error ? err.message : String(err));
    }
}
async function renderCompute(result, tsRepl, dbRepl, connector, tsModule) {
    tsRepl.appendSQL(result.sql);
    await connector.flashDown();
    // The DB panel shows raw rows (it's the database's view of the world).
    dbRepl.appendOutput(`ts> ${result.sql}`, "repl-echo");
    dbRepl.appendTable(result.results.columns, result.results.rows);
    await new Promise((r) => setTimeout(r, 250));
    await connector.flashUp();
    // The TS panel shows time buckets at their natural grain and surfaces
    // any reconciliation matches per row: the row's slice of the data is
    // tested against each match's impact region; matched rows get a
    // warning highlight and an inline note column. The footer keeps the
    // long natural-language description for each entry.
    const tsRows = formatTimeBucketColumns(result, tsModule.formatTimeBucket);
    const decorations = computeRowDecorations(result, tsModule.endOfBucket, tsModule.renderRegion);
    await tsRepl.appendTable(result.results.columns, tsRows, {
        animate: true,
        decorations,
    });
    if (result.reconciliation.length > 0) {
        tsRepl.appendOutput(formatReconciliationFooter(result.reconciliation), "repl-reconciliation");
    }
}
// Per-row reconciliation: for each row, build a region representing
// what the row covers, then test each match's impact region against it.
// A row matches an impact iff the time intervals overlap and the row's
// fixed dim values are compatible with the impact's constraints (rows
// that aggregate over a constrained dim still match — that's the
// "partially affected" case, like a March total when the impact is
// March + region='northeast').
function computeRowDecorations(result, endOfBucket, renderRegion) {
    if (result.reconciliation.length === 0)
        return [];
    const groupBys = result.semanticQuery.groupBy ?? [];
    return result.results.rows.map((row) => {
        const rowRegion = buildRowRegion(row, groupBys, result.region, endOfBucket);
        const hits = result.reconciliation.filter((m) => rowMatchesImpact(rowRegion, m.impact.region));
        if (hits.length === 0)
            return undefined;
        // Drop the metric from the inline note — the metric value cell on
        // the same row is highlighted in the same warn color, so the link
        // is visual. The footer carries the metric for full context.
        const note = hits
            .map((m) => `⚠ ${m.entry.name} · ${renderRegion(m.overlap)}`)
            .join("; ");
        return { highlight: "warn", note };
    });
}
function buildRowRegion(row, groupBys, queryRegion, endOfBucket) {
    let timeStart = queryRegion.timeStart;
    let timeEnd = queryRegion.timeEnd;
    const dimValues = new Map();
    // Inherit any equality constraints from the query's OVER region — e.g.
    // a top-level `AND region = 'west'` pins every row to that value.
    for (const c of queryRegion.constraints) {
        if (c.operator === "=" && !Array.isArray(c.value)) {
            dimValues.set(c.dimension, c.value);
        }
    }
    for (let i = 0; i < groupBys.length; i++) {
        const gb = groupBys[i];
        const cell = row[i];
        if (gb.grain && cell != null) {
            const iso = String(cell).slice(0, 10);
            timeStart = iso;
            timeEnd = endOfBucket(iso, gb.grain);
        }
        else if (!gb.grain && cell != null && typeof cell !== "object") {
            dimValues.set(gb.dimension, cell);
        }
    }
    return { timeStart, timeEnd, dimValues };
}
function rowMatchesImpact(row, impact) {
    if (row.timeEnd < impact.timeStart)
        return false;
    if (row.timeStart > impact.timeEnd)
        return false;
    for (const c of impact.constraints) {
        const rowVal = row.dimValues.get(c.dimension);
        if (rowVal === undefined)
            continue; // row aggregates this dim
        if (!constraintAllowsValue(c, rowVal))
            return false;
    }
    return true;
}
function constraintAllowsValue(c, val) {
    switch (c.operator) {
        case "=":
            return val === c.value;
        case "!=":
            return val !== c.value;
        case ">":
            return val > c.value;
        case "<":
            return val < c.value;
        case ">=":
            return val >= c.value;
        case "<=":
            return val <= c.value;
        case "in":
            return Array.isArray(c.value) && c.value.includes(val);
        case "not_in":
            return Array.isArray(c.value) && !c.value.includes(val);
    }
    return false;
}
// Post-process result rows so that columns originating from a time-grain
// GROUP BY render at their natural grain. The runtime's column rename
// makes group-by columns appear in the same order as semanticQuery.groupBy,
// so we match by index — no name parsing required.
function formatTimeBucketColumns(result, formatTimeBucket) {
    const groupBys = result.semanticQuery.groupBy ?? [];
    const grainByCol = new Map();
    for (let i = 0; i < groupBys.length; i++) {
        const g = groupBys[i].grain;
        if (g)
            grainByCol.set(i, g);
    }
    if (grainByCol.size === 0)
        return result.results.rows;
    return result.results.rows.map((row) => row.map((cell, i) => {
        const grain = grainByCol.get(i);
        if (!grain)
            return cell;
        if (cell == null)
            return cell;
        const iso = String(cell).slice(0, 10);
        return formatTimeBucket(iso, grain);
    }));
}
function renderRegister(result, tsRepl) {
    const e = result.entry;
    const impactCount = e.impacts.length;
    tsRepl.appendOutput(`✓ Registered "${e.name}" with ${impactCount} impact${impactCount === 1 ? "" : "s"}`, "repl-register");
}
function renderCheck(result, tsRepl, tsModule) {
    if (result.matches.length === 0) {
        tsRepl.appendOutput("(no lexicon matches)", "repl-check");
        return;
    }
    const header = `${result.matches.length} match${result.matches.length === 1 ? "" : "es"}`;
    tsRepl.appendOutput(`${header}\n${formatMatches(result.matches, tsModule.renderRegion)}`, "repl-check");
}
function formatReconciliationFooter(matches) {
    // The per-row note column carries the entry name + overlap, and the
    // colored metric value visually identifies *which* metric. The footer
    // spells out the impacted metric explicitly and carries the natural-
    // language description for each entry.
    const header = matches.length === 1
        ? `⚠ Reconciliation: 1 lexicon entry overlaps this region`
        : `⚠ Reconciliation: ${matches.length} lexicon entries overlap this region`;
    const body = matches
        .map((m) => `  • ${m.entry.name} (${m.impact.metric})\n      "${m.entry.description}"`)
        .join("\n");
    return `${header}\n${body}`;
}
function formatMatches(matches, renderRegion) {
    return matches
        .map((m) => {
        const region = renderRegion(m.overlap);
        return `  • ${m.entry.name}  (${m.impact.metric} · ${region})\n      "${m.entry.description}"`;
    })
        .join("\n");
}
function renderErrorList(errors, source, renderError, tsRepl) {
    for (const e of errors) {
        tsRepl.appendError(renderError(e, source));
    }
}
async function handleSqlCommand(input, dbRepl) {
    const trimmed = input.trim();
    if (trimmed.length === 0)
        return;
    try {
        const result = await dbQuery(trimmed);
        dbRepl.appendTable(result.columns, result.rows);
    }
    catch (err) {
        dbRepl.appendError(err instanceof Error ? err.message : String(err));
    }
}
main();

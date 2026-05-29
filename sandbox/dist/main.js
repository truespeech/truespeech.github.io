// True Speech v0.3.0 sandbox — wires the runtime to a notebook surface
// over an in-browser DuckDB, with a lexicon panel and grouped canned
// queries above.
//
// On every TS submit (typed into the notebook or invoked via the
// examples panel's Run button), parse → validate → execute, then
// dispatch on the statement kind and append a structured HTML cell to
// the notebook. Each cell carries the input source, the rendered
// output, and (for COMPUTE) a collapsible SQL inspector.
//
// v0.3.0 runtime surface in use:
//  - Boundary entries carry BEFORE/AFTER regime descriptions
//  - ComputeResult.decorations carries per-row `severity` (warn/error)
//  - BoundaryMatch carries per-row `side` (before/after/straddles)
//  - ComputeResult.historicalNotes for entirely-pre-cut queries
import { IMPORTS } from "./config.js";
import { initDatabase, query as dbQuery } from "./db.js";
import { createNotebook } from "./notebook.js";
// In-memory LexiconAdapter with delete/reset extensions for the panel.
class MemoryLexicon {
    entries = [];
    seed = [];
    async add(entry) {
        this.entries.push(entry);
    }
    async list() {
        return this.entries.map(cloneEntry);
    }
    getEntries() {
        return this.entries.map(cloneEntry);
    }
    // The runtime's LexiconAdapter contract (v0.4.0+) names this `remove`
    // and expects a Promise<boolean> indicating whether anything was
    // removed. The panel still calls a synchronous helper internally;
    // this method is what the adapter interface sees.
    async remove(name) {
        const before = this.entries.length;
        this.entries = this.entries.filter((e) => e.name !== name);
        return this.entries.length < before;
    }
    snapshotSeed() {
        this.seed = this.entries.map(cloneEntry);
    }
    reset() {
        this.entries = this.seed.map(cloneEntry);
    }
    // Both sides are normalized through cloneEntry before serializing —
    // without normalization, the runtime's construction-order of the
    // entry object differs from cloneEntry's, and JSON.stringify produces
    // unequal strings even when the content matches.
    isDirty() {
        if (this.entries.length !== this.seed.length)
            return true;
        return (JSON.stringify(this.entries.map(cloneEntry)) !==
            JSON.stringify(this.seed));
    }
}
function cloneEntry(e) {
    if (e.kind === "region") {
        return {
            kind: "region",
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
    return {
        kind: "boundary",
        name: e.name,
        at: e.at,
        metrics: [...e.metrics],
        constraints: e.constraints.map((c) => ({ ...c })),
        before: { ...e.before },
        after: { ...e.after },
        changeDescription: e.changeDescription,
    };
}
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
        // (Reset-lexicon affordance removed — users restore the seed by
        // reloading the page, called out in the intro paragraph.
        // Sample library + search panel removed — discoverability now
        // comes from Tab autocomplete in the notebook input.)
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
                notebook.addCell(renderCheckCell(trimmed, result, tsModule));
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
// ===========================================================================
// Cell renderers — each builds an HTMLElement for a notebook cell.
// ===========================================================================
function renderCellShell(source, kind) {
    const cell = document.createElement("article");
    cell.className = `nb-cell nb-cell-${kind}`;
    const input = document.createElement("div");
    input.className = "nb-cell-input";
    const prompt = document.createElement("span");
    prompt.className = "nb-cell-prompt";
    prompt.textContent = "ts>";
    input.appendChild(prompt);
    const sourceEl = document.createElement("pre");
    sourceEl.className = "nb-cell-source";
    sourceEl.textContent = source;
    input.appendChild(sourceEl);
    cell.appendChild(input);
    const output = document.createElement("div");
    output.className = "nb-cell-output";
    cell.appendChild(output);
    return { cell, output };
}
function renderComputeCell(source, result, tsModule) {
    const { cell, output } = renderCellShell(source, "compute");
    // Primary result table.
    output.appendChild(renderResultTable(result, tsModule));
    // Reconciliation block (per-entry detail). COMPUTE is single-metric,
    // so the impacted-metrics column is redundant — pass omitMetrics.
    if (result.reconciliation.length > 0) {
        output.appendChild(renderReconciliationBlock(result.reconciliation, true));
    }
    // Historical notes (entirely-pre-cut queries).
    for (const note of result.historicalNotes) {
        output.appendChild(renderHistoricalBlock(note));
    }
    // Generated SQL, collapsed by default.
    output.appendChild(renderSqlDetails(result.sql));
    return cell;
}
function renderResultTable(result, tsModule) {
    const groupBys = result.semanticQuery.groupBy ?? [];
    const decorations = result.decorations;
    const hasNotes = decorations.some((d) => d.matches.length > 0);
    const columns = hasNotes ? [...result.results.columns, "note"] : result.results.columns;
    const grainByCol = new Map();
    for (let i = 0; i < groupBys.length; i++) {
        const g = groupBys[i].grain;
        if (g)
            grainByCol.set(i, g);
    }
    const table = document.createElement("table");
    table.className = "data-table nb-result-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const col of columns) {
        const th = document.createElement("th");
        th.textContent = col;
        headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (let i = 0; i < result.results.rows.length; i++) {
        const row = result.results.rows[i];
        const decoration = decorations[i];
        const tr = document.createElement("tr");
        // Severity is communicated via colored text on the metric value
        // cell and the note cell (no background tinting). The note column
        // also leads with a small icon (⚠ / ✗) so the signal is visible
        // even on rows where the metric value is empty.
        if (decoration.severity) {
            tr.classList.add(`nb-row-${decoration.severity}`);
        }
        const metricColIdx = result.results.columns.length - 1;
        const metricName = result.results.columns[metricColIdx];
        for (let j = 0; j < result.results.columns.length; j++) {
            const td = document.createElement("td");
            const format = j === metricColIdx ? METRIC_FORMATS[metricName] : undefined;
            td.textContent = formatCellValue(row[j], grainByCol.get(j), format, tsModule);
            if (j === metricColIdx && decoration.severity) {
                td.classList.add("nb-cell-value");
            }
            tr.appendChild(td);
        }
        if (hasNotes) {
            const noteTd = document.createElement("td");
            noteTd.className = "nb-cell-note nb-cell-mono";
            if (decoration.matches.length > 0) {
                // Dedupe by entry name — a single entry with multiple
                // overlapping IMPACTING clauses produces multiple matches but
                // should show up once. For boundary matches, the side
                // (before / after / straddles) is per-row context worth
                // surfacing in the note: a quarter on either side of an AOV
                // redefinition wants to be tagged "(before)" vs "(after)"
                // so the operator knows which regime this row sits in.
                const seen = new Set();
                const labels = [];
                for (const m of decoration.matches) {
                    if (seen.has(m.entry.name))
                        continue;
                    seen.add(m.entry.name);
                    if (m.kind === "boundary") {
                        labels.push(`${m.entry.name} (${m.side})`);
                    }
                    else {
                        labels.push(m.entry.name);
                    }
                }
                noteTd.textContent = labels.join(", ");
            }
            tr.appendChild(noteTd);
        }
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    // Wrap so the row-count caption sits below the table.
    const wrap = document.createElement("div");
    wrap.className = "nb-result-table-wrap";
    wrap.appendChild(table);
    const caption = document.createElement("div");
    caption.className = "nb-result-caption";
    caption.textContent = `${result.results.rows.length} row${result.results.rows.length === 1 ? "" : "s"}`;
    wrap.appendChild(caption);
    return wrap;
}
const METRIC_FORMATS = {
    total_sales: "currency",
    average_order_value: "currency",
};
const USD = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    // Show cents only when the value actually has them ($5,302.82),
    // and omit them when it doesn't ($5,302).
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
});
function formatCellValue(val, grain, format, tsModule) {
    if (val === null || val === undefined)
        return "NULL";
    if (grain && typeof val === "string") {
        const iso = val.slice(0, 10);
        return tsModule.formatTimeBucket(iso, grain);
    }
    // DuckDB-WASM returns DECIMAL aggregates (e.g. SUM over a DECIMAL
    // column) as strings to preserve precision. When the column wants a
    // currency format, coerce numeric-looking strings to Number so we
    // can run them through Intl.NumberFormat.
    if (format === "currency") {
        const n = typeof val === "number" ? val : Number(val);
        if (Number.isFinite(n))
            return USD.format(n);
    }
    if (typeof val === "number") {
        if (Number.isInteger(val))
            return val.toString();
        return val.toFixed(2);
    }
    return String(val);
}
// Lexicon entries in scope for the query — the same two tables the
// SHOW LEXICON cell uses, narrowed to entries that the runtime found
// relevant to this COMPUTE / CHECK. A single entry can produce
// multiple matches (e.g. multi-impact regions); dedupe by entry name
// before rendering. `omitMetrics` hides the "Impacted metrics" column
// in single-metric contexts (today's COMPUTE), where it would just
// repeat the queried metric for every row.
function renderReconciliationBlock(matches, omitMetrics = false) {
    const wrap = document.createElement("section");
    wrap.className = "nb-block";
    const header = document.createElement("p");
    header.className = "nb-block-header";
    header.textContent = "Lexicon entries in scope";
    wrap.appendChild(header);
    const seen = new Set();
    const regions = [];
    const boundaries = [];
    for (const m of matches) {
        if (seen.has(m.entry.name))
            continue;
        seen.add(m.entry.name);
        if (m.kind === "region")
            regions.push(m.entry);
        else
            boundaries.push(m.entry);
    }
    if (regions.length > 0) {
        wrap.appendChild(renderRegionsTable(regions, omitMetrics));
    }
    if (boundaries.length > 0) {
        wrap.appendChild(renderBoundariesTable(boundaries, omitMetrics));
    }
    return wrap;
}
// One regime line — used in reconciliation rows, the historical
// block, REGISTER boundary confirmations, and SHOW LEXICON detail.
// Plain prose: "before \"<label>\" — <description>". Bold side label,
// quoted user label, em-dash, description. No pill chrome.
function renderRegimeLine(side, regime) {
    const line = document.createElement("p");
    line.className = "nb-regime-line";
    const strong = document.createElement("strong");
    strong.textContent = side;
    line.appendChild(strong);
    line.appendChild(document.createTextNode(` "${regime.label}" — ${regime.description}`));
    return line;
}
// Historical note: prose, no container chrome. Lead sentence,
// before/after regime lines, foot sentence pointing the operator at
// the post-cut regime that's normal now.
function renderHistoricalBlock(note) {
    const wrap = document.createElement("section");
    wrap.className = "nb-block nb-historical";
    const header = document.createElement("p");
    header.className = "nb-block-header";
    header.textContent = `Historical context · ${note.boundary.name} · ${note.metric}`;
    wrap.appendChild(header);
    const lead = document.createElement("p");
    lead.className = "nb-historical-lead";
    lead.textContent = "These values were computed under the pre-cut regime.";
    wrap.appendChild(lead);
    wrap.appendChild(renderRegimeLine("before", note.boundary.before));
    wrap.appendChild(renderRegimeLine("after", note.boundary.after));
    const foot = document.createElement("p");
    foot.className = "nb-historical-foot";
    foot.textContent = `As of ${note.boundary.at}, ${note.metric} is reported under the "${note.boundary.after.label}" regime.`;
    wrap.appendChild(foot);
    return wrap;
}
function renderSqlDetails(sql) {
    const details = document.createElement("details");
    details.className = "nb-sql";
    const summary = document.createElement("summary");
    summary.textContent = "Show generated SQL";
    details.appendChild(summary);
    const pre = document.createElement("pre");
    pre.className = "nb-sql-source";
    pre.textContent = sql;
    details.appendChild(pre);
    return details;
}
function renderRegisterCell(source, result) {
    const { cell, output } = renderCellShell(source, "register");
    const e = result.entry;
    const banner = document.createElement("div");
    banner.className = "nb-register-banner";
    const kindTag = document.createElement("span");
    kindTag.className = `kind-tag kind-${e.kind}`;
    kindTag.textContent = e.kind;
    banner.appendChild(kindTag);
    const msg = document.createElement("span");
    msg.className = "nb-register-msg";
    msg.textContent = `✓ Registered ${e.kind} "${e.name}"`;
    banner.appendChild(msg);
    output.appendChild(banner);
    if (e.kind === "region") {
        const meta = document.createElement("p");
        meta.className = "nb-detail-meta";
        meta.textContent = `${e.impacts.length} impact${e.impacts.length === 1 ? "" : "s"}`;
        output.appendChild(meta);
        const table = document.createElement("table");
        table.className = "data-table";
        const thead = document.createElement("thead");
        const headRow = document.createElement("tr");
        for (const col of ["Metric", "Range", "Constraints"]) {
            const th = document.createElement("th");
            th.textContent = col;
            headRow.appendChild(th);
        }
        thead.appendChild(headRow);
        table.appendChild(thead);
        const tbody = document.createElement("tbody");
        for (const impact of e.impacts) {
            const tr = document.createElement("tr");
            const metricTd = document.createElement("td");
            metricTd.className = "nb-cell-mono";
            metricTd.textContent = impact.metric;
            tr.appendChild(metricTd);
            const rangeTd = document.createElement("td");
            rangeTd.className = "nb-cell-mono";
            rangeTd.textContent = `${impact.region.timeStart} → ${impact.region.timeEnd}`;
            tr.appendChild(rangeTd);
            const constraintsTd = document.createElement("td");
            constraintsTd.className = "nb-cell-mono nb-cell-muted";
            constraintsTd.textContent = impact.region.constraints.length > 0
                ? impact.region.constraints.map((c) => `${c.dimension} ${c.operator} ${formatConstraintValue(c.value)}`).join(" AND ")
                : "—";
            tr.appendChild(constraintsTd);
            tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        output.appendChild(table);
        const desc = document.createElement("p");
        desc.className = "nb-detail-desc";
        desc.textContent = e.description;
        output.appendChild(desc);
    }
    else {
        const meta = document.createElement("p");
        meta.className = "nb-detail-meta";
        const scope = e.constraints.length > 0
            ? ` · ${e.constraints.map((c) => `${c.dimension} ${c.operator} ${formatConstraintValue(c.value)}`).join(" AND ")}`
            : "";
        meta.textContent = `Cut at ${e.at} · impacts ${e.metrics.join(", ")}${scope}`;
        output.appendChild(meta);
        output.appendChild(renderRegimeLine("before", e.before));
        output.appendChild(renderRegimeLine("after", e.after));
        if (e.changeDescription) {
            const change = document.createElement("p");
            change.className = "nb-detail-foot";
            change.textContent = `Change: "${e.changeDescription}"`;
            output.appendChild(change);
        }
    }
    return cell;
}
// CHECK reuses the reconciliation block — same renderer, since the
// underlying data shape (LexiconMatch[]) is identical.
function renderCheckCell(source, result, tsModule) {
    void tsModule; // overlap-augmented rendering removed in the table view
    const { cell, output } = renderCellShell(source, "check");
    if (result.matches.length === 0) {
        const empty = document.createElement("p");
        empty.className = "nb-soft-note";
        empty.textContent = "· No lexicon matches.";
        output.appendChild(empty);
        return cell;
    }
    output.appendChild(renderReconciliationBlock(result.matches));
    return cell;
}
function renderErrorCell(source, errors, tsModule) {
    const { cell, output } = renderCellShell(source, "error");
    for (const err of errors) {
        const pre = document.createElement("pre");
        pre.className = "nb-error";
        // If the error has the shape the renderer can format, use it; else
        // just dump the message.
        try {
            pre.textContent = tsModule.renderError(err, source);
        }
        catch {
            pre.textContent = err.message;
        }
        output.appendChild(pre);
    }
    return cell;
}
// ===========================================================================
// SHOW LEXICON cell — list view (no filter) or detail view (with filter)
// ===========================================================================
function renderShowLexiconCell(source, result) {
    const { cell, output } = renderCellShell(source, "show-lexicon");
    // Filtered + nothing matched: soft informational note. The runtime
    // returns an empty entries array for this case (not an error).
    if (result.filters && result.entries.length === 0) {
        const note = document.createElement("p");
        note.className = "nb-soft-note";
        const named = result.filters.map((f) => `"${f}"`).join(", ");
        note.textContent = `· No entries matching ${named}`;
        output.appendChild(note);
        return cell;
    }
    // Unfiltered + empty: just say so. Lexicon could be empty if every
    // seed entry has been UNREGISTERed.
    if (result.entries.length === 0) {
        const note = document.createElement("p");
        note.className = "nb-soft-note";
        note.textContent = "· Lexicon is empty.";
        output.appendChild(note);
        return cell;
    }
    const regions = result.entries.filter((e) => e.kind === "region");
    const boundaries = result.entries.filter((e) => e.kind === "boundary");
    if (regions.length > 0)
        output.appendChild(renderRegionsTable(regions));
    if (boundaries.length > 0)
        output.appendChild(renderBoundariesTable(boundaries));
    return cell;
}
// `omitMetrics` hides the "Impacted metrics" column. We pass it from
// the COMPUTE reconciliation block, where COMPUTE is single-metric
// and the column is redundant. SHOW LEXICON and CHECK keep the
// column because they can span multiple metrics.
function renderRegionsTable(regions, omitMetrics = false) {
    const columns = omitMetrics
        ? ["Region", "Scope", "Description"]
        : ["Region", "Impacted metrics", "Scope", "Description"];
    const table = document.createElement("table");
    table.className = "data-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const col of columns) {
        const th = document.createElement("th");
        th.textContent = col;
        headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (const e of regions) {
        const tr = document.createElement("tr");
        const nameTd = document.createElement("td");
        nameTd.className = "nb-cell-mono";
        nameTd.textContent = e.name;
        tr.appendChild(nameTd);
        if (!omitMetrics) {
            const metricsTd = document.createElement("td");
            metricsTd.className = "nb-cell-mono";
            metricsTd.textContent = uniqueImpactMetrics(e).join(", ");
            tr.appendChild(metricsTd);
        }
        const scopeTd = document.createElement("td");
        scopeTd.className = "nb-cell-mono";
        scopeTd.textContent = regionScopeSummary(e);
        tr.appendChild(scopeTd);
        const descTd = document.createElement("td");
        descTd.textContent = e.description;
        tr.appendChild(descTd);
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    return table;
}
function renderBoundariesTable(boundaries, omitMetrics = false) {
    const columns = omitMetrics
        ? ["Boundary", "Date", "Before", "After"]
        : ["Boundary", "Impacted metrics", "Date", "Before", "After"];
    const table = document.createElement("table");
    table.className = "data-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const col of columns) {
        const th = document.createElement("th");
        th.textContent = col;
        headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (const e of boundaries) {
        const tr = document.createElement("tr");
        const nameTd = document.createElement("td");
        nameTd.className = "nb-cell-mono";
        nameTd.textContent = e.name;
        tr.appendChild(nameTd);
        if (!omitMetrics) {
            const metricsTd = document.createElement("td");
            metricsTd.className = "nb-cell-mono";
            metricsTd.textContent = e.metrics.join(", ");
            tr.appendChild(metricsTd);
        }
        const dateTd = document.createElement("td");
        dateTd.className = "nb-cell-mono";
        // Constraints scoped to the cut land inline next to the date —
        // they're attached to the boundary, not the metrics.
        const scope = e.constraints.length > 0
            ? ` · ${e.constraints.map((c) => `${c.dimension} ${c.operator} ${formatConstraintValue(c.value)}`).join(" AND ")}`
            : "";
        dateTd.textContent = `${e.at}${scope}`;
        tr.appendChild(dateTd);
        const beforeTd = document.createElement("td");
        beforeTd.textContent = e.before.description;
        tr.appendChild(beforeTd);
        const afterTd = document.createElement("td");
        afterTd.textContent = e.after.description;
        tr.appendChild(afterTd);
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    return table;
}
function uniqueImpactMetrics(e) {
    const seen = new Set();
    const out = [];
    for (const impact of e.impacts) {
        if (seen.has(impact.metric))
            continue;
        seen.add(impact.metric);
        out.push(impact.metric);
    }
    return out;
}
// Time range + categorical constraints across all impacts. When every
// impact has the same time range, render it once; otherwise stack the
// per-impact ranges. Constraints get appended with AND.
function regionScopeSummary(e) {
    if (e.impacts.length === 0)
        return "—";
    const ranges = e.impacts.map((i) => {
        const time = `${i.region.timeStart} → ${i.region.timeEnd}`;
        const constraints = i.region.constraints.length > 0
            ? " AND " + i.region.constraints
                .map((c) => `${c.dimension} ${c.operator} ${formatConstraintValue(c.value)}`)
                .join(" AND ")
            : "";
        return time + constraints;
    });
    const unique = Array.from(new Set(ranges));
    return unique.join("; ");
}
function formatConstraintValue(v) {
    if (Array.isArray(v)) {
        return `(${v.map((x) => (typeof x === "string" ? `'${x}'` : String(x))).join(", ")})`;
    }
    return typeof v === "string" ? `'${v}'` : String(v);
}
// ===========================================================================
// SHOW SCHEMA cell — per-metric grouped sections
// ===========================================================================
function renderShowSchemaCell(source, result) {
    const { cell, output } = renderCellShell(source, "show-schema");
    if (result.metrics.length === 0) {
        const note = document.createElement("p");
        note.className = "nb-soft-note";
        note.textContent = "· No metrics in the semantic model.";
        output.appendChild(note);
        return cell;
    }
    output.appendChild(renderSchemaMetricsTable(result.metrics));
    output.appendChild(renderSchemaDimensionsTable(result.metrics));
    return cell;
}
function renderSchemaMetricsTable(metrics) {
    const table = document.createElement("table");
    table.className = "data-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const col of ["Metric", "Description", "Primary time"]) {
        const th = document.createElement("th");
        th.textContent = col;
        headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (const m of metrics) {
        const tr = document.createElement("tr");
        const nameTd = document.createElement("td");
        nameTd.className = "nb-cell-mono";
        nameTd.textContent = m.name;
        tr.appendChild(nameTd);
        const descTd = document.createElement("td");
        descTd.textContent = m.description ?? "";
        tr.appendChild(descTd);
        const timeTd = document.createElement("td");
        timeTd.className = "nb-cell-mono";
        timeTd.textContent = m.primaryTime ?? "—";
        tr.appendChild(timeTd);
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    return table;
}
// Dimensions table is the inverse of the per-metric view: one row per
// unique dimension name, with a comma-joined list of the metrics that
// expose it. Time-primary dimensions get the "time (primary)" type
// even when they're only primary for a subset of the listed metrics.
function renderSchemaDimensionsTable(metrics) {
    const byName = new Map();
    for (const m of metrics) {
        for (const d of m.dimensions) {
            let row = byName.get(d.name);
            if (!row) {
                row = { name: d.name, isTime: d.isTime, isPrimaryAnywhere: false, metrics: [] };
                byName.set(d.name, row);
            }
            row.metrics.push(m.name);
            if (m.primaryTime === d.name)
                row.isPrimaryAnywhere = true;
        }
    }
    const rows = [...byName.values()];
    const table = document.createElement("table");
    table.className = "data-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const col of ["Dimension", "Type", "Metrics"]) {
        const th = document.createElement("th");
        th.textContent = col;
        headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    for (const d of rows) {
        const tr = document.createElement("tr");
        const nameTd = document.createElement("td");
        nameTd.className = "nb-cell-mono";
        nameTd.textContent = d.name;
        tr.appendChild(nameTd);
        const typeTd = document.createElement("td");
        typeTd.textContent = d.isPrimaryAnywhere
            ? "time (primary)"
            : d.isTime
                ? "time"
                : "categorical";
        tr.appendChild(typeTd);
        const metricsTd = document.createElement("td");
        metricsTd.className = "nb-cell-mono nb-cell-muted";
        metricsTd.textContent = d.metrics.join(", ");
        tr.appendChild(metricsTd);
        tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    return table;
}
// ===========================================================================
// UNREGISTER cell — confirmation (found) or soft note (not found)
// ===========================================================================
function renderUnregisterCell(source, result) {
    const { cell, output } = renderCellShell(source, "unregister");
    if (result.found) {
        const banner = document.createElement("div");
        banner.className = "nb-register-banner";
        const msg = document.createElement("span");
        msg.className = "nb-register-msg";
        msg.textContent = `✓ Unregistered "${result.name}"`;
        banner.appendChild(msg);
        output.appendChild(banner);
    }
    else {
        const note = document.createElement("p");
        note.className = "nb-soft-note";
        note.textContent = `· No entry named "${result.name}" — nothing to remove.`;
        output.appendChild(note);
    }
    return cell;
}
main();

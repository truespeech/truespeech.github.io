// Cell renderers, shared between the sandbox notebook and the tutorial
// standalone cells.
//
// Each statement kind has a `render<Kind>Into(output, …)` function that
// populates a given output element, plus a thin `render<Kind>Cell(
// source, …)` wrapper that builds a full cell (input header band +
// output) for the append-only sandbox notebook. The tutorial uses the
// *Into functions directly, rendering only the output into a cell that
// already shows the (editable) input.
//
// `executeAndRenderInto` is the shared parse → validate → execute →
// dispatch path: hand it an output element, a source string, and a
// runtime instance, and it overwrites the output with the rendered
// result (or error).

import type {
  ExecuteResult,
  LexiconMatch,
  RegionLexiconEntry,
  BoundaryLexiconEntry,
  RegimeDescription,
  MetricSummary,
  HistoricalNote,
  Grain,
  TsRuntimeApi,
  TsInstance,
} from "./runtime.js";

// ===========================================================================
// Cell shell — input header band + empty output body.
// ===========================================================================

export function renderCellShell(source: string, kind: string): {
  cell: HTMLElement;
  output: HTMLElement;
} {
  const cell = document.createElement("article");
  cell.className = `nb-cell nb-cell-${kind}`;

  // Input header band: a small "input" eyebrow label above the
  // command the user ran. The band's tint (set in CSS) is what
  // distinguishes the typed input from the runtime output below it —
  // no `ts>` prompt prefix.
  const input = document.createElement("div");
  input.className = "nb-cell-input";
  const label = document.createElement("span");
  label.className = "nb-cell-label";
  label.textContent = "input";
  input.appendChild(label);
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

// ===========================================================================
// Execute + render dispatch. Clears `output`, runs the source through
// the runtime, and renders the result (or error) into `output`.
// ===========================================================================

export async function executeAndRenderInto(
  output: HTMLElement,
  source: string,
  ts: TsInstance,
  tsModule: TsRuntimeApi
): Promise<void> {
  output.innerHTML = "";
  const trimmed = source.trim();
  if (trimmed.length === 0) return;

  const { ast, errors: parseErrors } = ts.parse(trimmed);
  if (parseErrors.length > 0) {
    renderErrorInto(output, parseErrors, trimmed, tsModule);
    return;
  }
  if (!ast) {
    renderErrorInto(output, [{ message: "Empty input" }], trimmed, tsModule);
    return;
  }

  const { errors: validateErrors } = ts.validate(ast);
  if (validateErrors.length > 0) {
    renderErrorInto(output, validateErrors, trimmed, tsModule);
    return;
  }

  try {
    const result = await ts.execute(trimmed);
    renderResultInto(output, result, tsModule);
  } catch (err: unknown) {
    renderErrorInto(
      output,
      [{ message: err instanceof Error ? err.message : String(err) }],
      trimmed,
      tsModule
    );
  }
}

// Dispatch a successful ExecuteResult to the right per-statement
// renderer, into `output`.
export function renderResultInto(
  output: HTMLElement,
  result: ExecuteResult,
  tsModule: TsRuntimeApi
): void {
  switch (result.statement) {
    case "compute":
      renderComputeInto(output, result, tsModule);
      break;
    case "register":
      renderRegisterInto(output, result);
      break;
    case "check":
      renderCheckInto(output, result);
      break;
    case "show":
      if (result.subject === "lexicon") renderShowLexiconInto(output, result);
      else renderShowSchemaInto(output, result);
      break;
    case "unregister":
      renderUnregisterInto(output, result);
      break;
  }
}

// ===========================================================================
// COMPUTE
// ===========================================================================

export function renderComputeCell(
  source: string,
  result: Extract<ExecuteResult, { statement: "compute" }>,
  tsModule: TsRuntimeApi
): HTMLElement {
  const { cell, output } = renderCellShell(source, "compute");
  renderComputeInto(output, result, tsModule);
  return cell;
}

export function renderComputeInto(
  output: HTMLElement,
  result: Extract<ExecuteResult, { statement: "compute" }>,
  tsModule: TsRuntimeApi
): void {
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
}

function renderResultTable(
  result: Extract<ExecuteResult, { statement: "compute" }>,
  tsModule: TsRuntimeApi
): HTMLElement {
  const groupBys: { dimension: string; grain?: Grain }[] =
    result.semanticQuery.groupBy ?? [];

  const decorations = result.decorations;
  const hasNotes = decorations.some((d) => d.matches.length > 0);
  const columns = hasNotes ? [...result.results.columns, "note"] : result.results.columns;
  const grainByCol = new Map<number, Grain>();
  for (let i = 0; i < groupBys.length; i++) {
    const g = groupBys[i].grain;
    if (g) grainByCol.set(i, g);
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
    // cell and the note cell (no background tinting).
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
        // surfacing in the note.
        const seen = new Set<string>();
        const labels: string[] = [];
        for (const m of decoration.matches) {
          if (seen.has(m.entry.name)) continue;
          seen.add(m.entry.name);
          if (m.kind === "boundary") {
            labels.push(`${m.entry.name} (${m.side})`);
          } else {
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

// Per-metric display format for the metric column in COMPUTE results.
// Anything not in the map renders with the default numeric formatting
// (integer values plain; fractional values to two decimals).
type MetricFormat = "currency";
const METRIC_FORMATS: Record<string, MetricFormat> = {
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

function formatCellValue(
  val: string | number | null,
  grain: Grain | undefined,
  format: MetricFormat | undefined,
  tsModule: TsRuntimeApi
): string {
  if (val === null || val === undefined) return "NULL";
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
    if (Number.isFinite(n)) return USD.format(n);
  }
  if (typeof val === "number") {
    if (Number.isInteger(val)) return val.toString();
    return val.toFixed(2);
  }
  return String(val);
}

// ===========================================================================
// Lexicon-match tables (shared by COMPUTE reconciliation, CHECK, and
// SHOW LEXICON).
// ===========================================================================

// Lexicon entries in scope for the query — the same two tables the
// SHOW LEXICON cell uses, narrowed to entries the runtime found
// relevant to this COMPUTE / CHECK. A single entry can produce
// multiple matches (e.g. multi-impact regions); dedupe by entry name
// before rendering. `omitMetrics` hides the "Impacted metrics" column
// in single-metric contexts (today's COMPUTE), where it would just
// repeat the queried metric for every row.
function renderReconciliationBlock(
  matches: LexiconMatch[],
  omitMetrics = false
): HTMLElement {
  const wrap = document.createElement("section");
  wrap.className = "nb-block";

  const header = document.createElement("p");
  header.className = "nb-block-header";
  header.textContent = "Lexicon entries in scope";
  wrap.appendChild(header);

  const seen = new Set<string>();
  const regions: RegionLexiconEntry[] = [];
  const boundaries: BoundaryLexiconEntry[] = [];
  for (const m of matches) {
    if (seen.has(m.entry.name)) continue;
    seen.add(m.entry.name);
    if (m.kind === "region") regions.push(m.entry);
    else boundaries.push(m.entry);
  }

  if (regions.length > 0) {
    wrap.appendChild(renderRegionsTable(regions, omitMetrics));
  }
  if (boundaries.length > 0) {
    wrap.appendChild(renderBoundariesTable(boundaries, omitMetrics));
  }
  return wrap;
}

// `omitMetrics` hides the "Impacted metrics" column. We pass it from
// the COMPUTE reconciliation block, where COMPUTE is single-metric
// and the column is redundant. SHOW LEXICON and CHECK keep the
// column because they can span multiple metrics.
function renderRegionsTable(
  regions: RegionLexiconEntry[],
  omitMetrics = false
): HTMLElement {
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

function renderBoundariesTable(
  boundaries: BoundaryLexiconEntry[],
  omitMetrics = false
): HTMLElement {
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

function uniqueImpactMetrics(e: RegionLexiconEntry): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const impact of e.impacts) {
    if (seen.has(impact.metric)) continue;
    seen.add(impact.metric);
    out.push(impact.metric);
  }
  return out;
}

// Time range + categorical constraints across all impacts. When every
// impact has the same time range, render it once; otherwise stack the
// per-impact ranges. Constraints get appended with AND.
function regionScopeSummary(e: RegionLexiconEntry): string {
  if (e.impacts.length === 0) return "—";
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

function formatConstraintValue(v: string | number | (string | number)[]): string {
  if (Array.isArray(v)) {
    return `(${v.map((x) => (typeof x === "string" ? `'${x}'` : String(x))).join(", ")})`;
  }
  return typeof v === "string" ? `'${v}'` : String(v);
}

// One regime line — used in the historical block and REGISTER boundary
// confirmations. Plain prose: bold side label, quoted user label,
// em-dash, description.
function renderRegimeLine(
  side: "before" | "after",
  regime: RegimeDescription
): HTMLElement {
  const line = document.createElement("p");
  line.className = "nb-regime-line";
  const strong = document.createElement("strong");
  strong.textContent = side;
  line.appendChild(strong);
  line.appendChild(
    document.createTextNode(` "${regime.label}" — ${regime.description}`)
  );
  return line;
}

// Historical note: prose, no container chrome.
function renderHistoricalBlock(note: HistoricalNote): HTMLElement {
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

function renderSqlDetails(sql: string): HTMLElement {
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

// ===========================================================================
// REGISTER
// ===========================================================================

export function renderRegisterCell(
  source: string,
  result: Extract<ExecuteResult, { statement: "register" }>
): HTMLElement {
  const { cell, output } = renderCellShell(source, "register");
  renderRegisterInto(output, result);
  return cell;
}

export function renderRegisterInto(
  output: HTMLElement,
  result: Extract<ExecuteResult, { statement: "register" }>
): void {
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
  } else {
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
}

// ===========================================================================
// CHECK — reuses the reconciliation block (same LexiconMatch[] shape).
// ===========================================================================

export function renderCheckCell(
  source: string,
  result: Extract<ExecuteResult, { statement: "check" }>
): HTMLElement {
  const { cell, output } = renderCellShell(source, "check");
  renderCheckInto(output, result);
  return cell;
}

export function renderCheckInto(
  output: HTMLElement,
  result: Extract<ExecuteResult, { statement: "check" }>
): void {
  if (result.matches.length === 0) {
    const empty = document.createElement("p");
    empty.className = "nb-soft-note";
    empty.textContent = "· No lexicon matches.";
    output.appendChild(empty);
    return;
  }
  output.appendChild(renderReconciliationBlock(result.matches));
}

// ===========================================================================
// Errors
// ===========================================================================

export function renderErrorCell(
  source: string,
  errors: { message: string }[],
  tsModule: TsRuntimeApi
): HTMLElement {
  const { cell, output } = renderCellShell(source, "error");
  renderErrorInto(output, errors, source, tsModule);
  return cell;
}

export function renderErrorInto(
  output: HTMLElement,
  errors: { message: string }[],
  source: string,
  tsModule: TsRuntimeApi
): void {
  for (const err of errors) {
    const pre = document.createElement("pre");
    pre.className = "nb-error";
    // If the error has the shape the renderer can format, use it; else
    // just dump the message.
    try {
      pre.textContent = tsModule.renderError(err, source);
    } catch {
      pre.textContent = err.message;
    }
    output.appendChild(pre);
  }
}

// ===========================================================================
// SHOW LEXICON
// ===========================================================================

export function renderShowLexiconCell(
  source: string,
  result: Extract<ExecuteResult, { statement: "show"; subject: "lexicon" }>
): HTMLElement {
  const { cell, output } = renderCellShell(source, "show-lexicon");
  renderShowLexiconInto(output, result);
  return cell;
}

export function renderShowLexiconInto(
  output: HTMLElement,
  result: Extract<ExecuteResult, { statement: "show"; subject: "lexicon" }>
): void {
  // Filtered + nothing matched: soft informational note. The runtime
  // returns an empty entries array for this case (not an error).
  if (result.filters && result.entries.length === 0) {
    const note = document.createElement("p");
    note.className = "nb-soft-note";
    const named = result.filters.map((f) => `"${f}"`).join(", ");
    note.textContent = `· No entries matching ${named}`;
    output.appendChild(note);
    return;
  }

  // Unfiltered + empty: just say so.
  if (result.entries.length === 0) {
    const note = document.createElement("p");
    note.className = "nb-soft-note";
    note.textContent = "· Lexicon is empty.";
    output.appendChild(note);
    return;
  }

  const regions = result.entries.filter(
    (e): e is RegionLexiconEntry => e.kind === "region"
  );
  const boundaries = result.entries.filter(
    (e): e is BoundaryLexiconEntry => e.kind === "boundary"
  );

  if (regions.length > 0) output.appendChild(renderRegionsTable(regions));
  if (boundaries.length > 0) output.appendChild(renderBoundariesTable(boundaries));
}

// ===========================================================================
// SHOW SCHEMA
// ===========================================================================

export function renderShowSchemaCell(
  source: string,
  result: Extract<ExecuteResult, { statement: "show"; subject: "schema" }>
): HTMLElement {
  const { cell, output } = renderCellShell(source, "show-schema");
  renderShowSchemaInto(output, result);
  return cell;
}

export function renderShowSchemaInto(
  output: HTMLElement,
  result: Extract<ExecuteResult, { statement: "show"; subject: "schema" }>
): void {
  if (result.metrics.length === 0) {
    const note = document.createElement("p");
    note.className = "nb-soft-note";
    note.textContent = "· No metrics in the semantic model.";
    output.appendChild(note);
    return;
  }

  output.appendChild(renderSchemaMetricsTable(result.metrics));
  output.appendChild(renderSchemaDimensionsTable(result.metrics));
}

function renderSchemaMetricsTable(metrics: MetricSummary[]): HTMLElement {
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
function renderSchemaDimensionsTable(metrics: MetricSummary[]): HTMLElement {
  interface DimRow {
    name: string;
    isTime: boolean;
    isPrimaryAnywhere: boolean;
    metrics: string[];
  }
  const byName = new Map<string, DimRow>();
  for (const m of metrics) {
    for (const d of m.dimensions) {
      let row = byName.get(d.name);
      if (!row) {
        row = { name: d.name, isTime: d.isTime, isPrimaryAnywhere: false, metrics: [] };
        byName.set(d.name, row);
      }
      row.metrics.push(m.name);
      if (m.primaryTime === d.name) row.isPrimaryAnywhere = true;
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
// UNREGISTER
// ===========================================================================

export function renderUnregisterCell(
  source: string,
  result: Extract<ExecuteResult, { statement: "unregister" }>
): HTMLElement {
  const { cell, output } = renderCellShell(source, "unregister");
  renderUnregisterInto(output, result);
  return cell;
}

export function renderUnregisterInto(
  output: HTMLElement,
  result: Extract<ExecuteResult, { statement: "unregister" }>
): void {
  if (result.found) {
    const banner = document.createElement("div");
    banner.className = "nb-register-banner";
    const msg = document.createElement("span");
    msg.className = "nb-register-msg";
    msg.textContent = `✓ Unregistered "${result.name}"`;
    banner.appendChild(msg);
    output.appendChild(banner);
  } else {
    const note = document.createElement("p");
    note.className = "nb-soft-note";
    note.textContent = `· No entry named "${result.name}" — nothing to remove.`;
    output.appendChild(note);
  }
}

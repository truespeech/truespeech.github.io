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
import { createLexiconPanel } from "./lexicon-panel.js";
import { createExamplesPanel } from "./examples-panel.js";
import type { ExampleGroup } from "./examples-panel.js";

interface ResolvedConstraint {
  dimension: string;
  operator: string;
  value: string | number | (string | number)[];
}
interface ResolvedRegion {
  timeStart: string;
  timeEnd: string;
  constraints: ResolvedConstraint[];
}
interface Impact {
  metric: string;
  region: ResolvedRegion;
}

interface RegimeDescription {
  label: string;
  description: string;
}

interface RegionLexiconEntry {
  kind: "region";
  name: string;
  impacts: Impact[];
  description: string;
}
interface BoundaryLexiconEntry {
  kind: "boundary";
  name: string;
  at: string;
  constraints: ResolvedConstraint[];
  metrics: string[];
  before: RegimeDescription;
  after: RegimeDescription;
  changeDescription?: string;
}
type LexiconEntry = RegionLexiconEntry | BoundaryLexiconEntry;

interface RegionMatch {
  kind: "region";
  entry: RegionLexiconEntry;
  impact: Impact;
  overlap: ResolvedRegion;
}
interface BoundaryMatch {
  kind: "boundary";
  entry: BoundaryLexiconEntry;
  metric: string;
  crossedAt: string;
  side: "before" | "after" | "straddles";
}
type LexiconMatch = RegionMatch | BoundaryMatch;

interface RuntimeRowDecoration {
  matches: LexiconMatch[];
  severity?: "warn" | "error";
}

interface HistoricalNote {
  boundary: BoundaryLexiconEntry;
  metric: string;
}

type ExecuteResult =
  | {
      statement: "compute";
      semanticQuery: any;
      sql: string;
      results: { columns: string[]; rows: (string | number | null)[][] };
      reconciliation: LexiconMatch[];
      region: ResolvedRegion;
      decorations: RuntimeRowDecoration[];
      historicalNotes: HistoricalNote[];
    }
  | { statement: "register"; entry: LexiconEntry }
  | { statement: "check"; matches: LexiconMatch[] };

type Grain = "day" | "week" | "month" | "quarter" | "year";

interface TsRuntimeApi {
  TrueSpeech: new (opts: {
    semanticLayer: any;
    database: { execute: (sql: string) => Promise<any> };
    lexicon?: any;
  }) => {
    parse(source: string): { ast: any; errors: any[] };
    validate(ast: any): { errors: any[] };
    execute(source: string): Promise<ExecuteResult>;
  };
  osiAdapter: (runtime: any) => any;
  renderError: (error: any, source: string) => string;
  renderRegion: (region: ResolvedRegion) => string;
  formatTimeBucket: (isoStart: string, grain: Grain) => string;
  endOfBucket: (isoStart: string, grain: Grain) => string;
  TrueSpeechExecutionError: new (errors: any[]) => Error & { errors: any[] };
}

// In-memory LexiconAdapter with delete/reset extensions for the panel.
class MemoryLexicon {
  private entries: LexiconEntry[] = [];
  private seed: LexiconEntry[] = [];

  async add(entry: LexiconEntry): Promise<void> {
    this.entries.push(entry);
  }
  async list(): Promise<LexiconEntry[]> {
    return this.entries.map(cloneEntry);
  }

  getEntries(): LexiconEntry[] {
    return this.entries.map(cloneEntry);
  }
  delete(name: string): void {
    this.entries = this.entries.filter((e) => e.name !== name);
  }
  snapshotSeed(): void {
    this.seed = this.entries.map(cloneEntry);
  }
  reset(): void {
    this.entries = this.seed.map(cloneEntry);
  }
  // Both sides are normalized through cloneEntry before serializing —
  // without normalization, the runtime's construction-order of the
  // entry object differs from cloneEntry's, and JSON.stringify produces
  // unequal strings even when the content matches.
  isDirty(): boolean {
    if (this.entries.length !== this.seed.length) return true;
    return (
      JSON.stringify(this.entries.map(cloneEntry)) !==
      JSON.stringify(this.seed)
    );
  }
}

function cloneEntry(e: LexiconEntry): LexiconEntry {
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

    const lexicon = new MemoryLexicon();

    const ts = new tsModule.TrueSpeech({
      semanticLayer: tsModule.osiAdapter(osi),
      database: { execute: dbQuery },
      lexicon,
    });

    for (const stmt of SEED_STATEMENTS) {
      await ts.execute(stmt);
    }
    lexicon.snapshotSeed();

    loadingEl.remove();

    function syncDependentPanels(): void {
      lexiconPanel.refresh();
      examplesPanel.refresh();
    }

    const lexiconPanel = createLexiconPanel({
      getEntries: () => lexicon.getEntries(),
      onDelete: (name) => {
        lexicon.delete(name);
        examplesPanel.refresh();
      },
      onReset: () => {
        lexicon.reset();
        examplesPanel.refresh();
      },
      renderRegion: tsModule.renderRegion,
    });

    const notebook = createNotebook({
      placeholder: "Enter a COMPUTE, REGISTER, or CHECK statement…",
      onSubmit: (source) => handleSubmit(source, ts, tsModule, notebook, syncDependentPanels),
    });

    const exampleGroups: ExampleGroup[] = [
      {
        title: "Basic",
        cards: [
          {
            label: "April 2026 sales (clean baseline)",
            explanation: "No lexicon entries touch April — useful as a baseline for what a clean result looks like. (The sample data ends April 2026, so this is the only naturally-clean post-cut window.)",
            command: "COMPUTE total_sales OVER 2026-04",
          },
          {
            label: "Hits Feb anomaly",
            explanation: "Overlaps q1_data_quality_issue → row flagged amber. Also pre-cut for the enterprise_price_reset boundary → historical footer.",
            command: "COMPUTE total_sales OVER 2026-02",
          },
          {
            label: "Northeast in March",
            explanation: "GROUP BY region; only the northeast row touches the fulfillment-outage region. March is pre-cut for the enterprise boundary → historical footer.",
            command: "COMPUTE total_sales OVER 2026-03 GROUP BY region",
          },
          {
            label: "Whole year 2026 (catches everything)",
            explanation: "Wide annual scope — single row picks up both regions (warns) and straddles the enterprise boundary (red error). Useful for seeing every match type in one query.",
            command: "COMPUTE total_sales OVER 2026",
          },
        ],
      },
      {
        title: "Boundaries",
        cards: [
          {
            label: "AOV across Jan cut (error)",
            explanation: "Single row spans Jan 1, mixing both AOV regimes → red error. The value is incoherent.",
            command: "COMPUTE average_order_value OVER 2025-Q4 to 2026-Q1",
          },
          {
            label: "AOV by quarter (regime labels)",
            explanation: "Same span, GROUP BY quarter → two rows, neither straddles. Each carries its regime label inline.",
            command: "COMPUTE average_order_value OVER 2025-Q4 to 2026-Q1 GROUP BY quarter",
          },
          {
            label: "AOV last year (historical)",
            explanation: "Entirely pre-cut — no row flags, just a soft footer describing the pre-2026 AOV regime.",
            command: "COMPUTE average_order_value OVER 2025",
          },
        ],
      },
      {
        title: "Disambiguation",
        cards: [
          {
            label: "Enterprise across Apr cut",
            explanation: "Query pins enterprise and spans Apr 1 → straddling-row error from the scoped boundary, plus warns from the Feb/March region entries that fall in the span.",
            command:
              "COMPUTE total_sales OVER 2026-Q1 to 2026-Q2 AND product_tier = 'enterprise'",
          },
          {
            label: "By tier (scopes the cut)",
            explanation: "GROUP BY product_tier. Both region entries hit both rows; the enterprise boundary applies only to the enterprise row (red error), while consumer's row carries the region warns alone.",
            command: "COMPUTE total_sales OVER 2026-Q1 to 2026-Q2 GROUP BY product_tier",
          },
          {
            label: "Check Q1",
            explanation: "Lexicon lookup without running the metric query — surfaces every entry matching the Q1 slice.",
            command: "CHECK total_sales, average_order_value OVER 2026-Q1",
          },
        ],
      },
      {
        title: "Registration",
        cards: [
          {
            label: "Register a region",
            explanation: "Adds a new region entry to the lexicon. After running, the lexicon panel refreshes.",
            command:
              `REGISTER region promo_spike\n  IMPACTING total_sales OVER 2026-03-15 to 2026-03-22\n  WITH "Spring promotion ran during this window"`,
          },
          {
            label: "Register a boundary",
            explanation: "Adds a new boundary with BEFORE/AFTER regime descriptions. Modifies the lexicon (dirty state).",
            command:
              `REGISTER boundary tax_rule_change\n  AT 2026-02-01\n  IMPACTING total_sales\n  BEFORE "tax-exclusive" "Sales totals were reported net of sales tax"\n  AFTER  "tax-inclusive" "Sales totals roll up gross of sales tax"`,
          },
        ],
      },
    ];

    const examplesPanel = createExamplesPanel({
      groups: exampleGroups,
      isDirty: () => lexicon.isDirty(),
      onReset: () => {
        lexicon.reset();
        syncDependentPanels();
      },
      onCopy: async (command) => {
        try {
          await navigator.clipboard.writeText(command);
        } catch {
          console.warn("Clipboard write failed; user must copy manually.");
        }
      },
      onRun: (command) => {
        notebook.element.scrollIntoView({ behavior: "smooth", block: "start" });
        notebook.submit(command);
      },
    });

    container.appendChild(lexiconPanel.element);
    container.appendChild(examplesPanel.element);
    container.appendChild(notebook.element);

    notebook.focus();
  } catch (err: unknown) {
    loadingEl.textContent = `Failed to initialize: ${
      err instanceof Error ? err.message : String(err)
    }`;
    loadingEl.style.color = "#f44747";
    console.error("Initialization error:", err);
  }
}

async function handleSubmit(
  source: string,
  ts: ReturnType<TsRuntimeApi["TrueSpeech"] extends new (...a: any) => infer R ? () => R : never>,
  tsModule: TsRuntimeApi,
  notebook: ReturnType<typeof createNotebook>,
  syncDependentPanels: () => void
) {
  const trimmed = source.trim();
  if (trimmed.length === 0) return;

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
        syncDependentPanels();
        break;
      case "check":
        notebook.addCell(renderCheckCell(trimmed, result, tsModule));
        break;
    }
  } catch (err: unknown) {
    notebook.addCell(
      renderErrorCell(trimmed, [{ message: err instanceof Error ? err.message : String(err) }], tsModule)
    );
  }
}

// ===========================================================================
// Cell renderers — each builds an HTMLElement for a notebook cell.
// ===========================================================================

function renderCellShell(source: string, kind: string): {
  cell: HTMLElement;
  output: HTMLElement;
} {
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

function renderComputeCell(
  source: string,
  result: Extract<ExecuteResult, { statement: "compute" }>,
  tsModule: TsRuntimeApi
): HTMLElement {
  const { cell, output } = renderCellShell(source, "compute");

  // Primary result table.
  output.appendChild(renderResultTable(result, tsModule));

  // Reconciliation block (per-entry detail).
  if (result.reconciliation.length > 0) {
    output.appendChild(renderReconciliationBlock(result.reconciliation));
  }

  // Historical notes (entirely-pre-cut queries).
  for (const note of result.historicalNotes) {
    output.appendChild(renderHistoricalBlock(note));
  }

  // Generated SQL, collapsed by default.
  output.appendChild(renderSqlDetails(result.sql));

  return cell;
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
  table.className = "nb-result-table";

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
    tr.className = "nb-row";
    if (decoration.severity) {
      tr.classList.add(`nb-row-${decoration.severity}`);
    }
    // The metric value is the last data column (i.e. not a group-by).
    const metricColIdx = result.results.columns.length - 1;
    for (let j = 0; j < result.results.columns.length; j++) {
      const td = document.createElement("td");
      const cellValue = formatCellValue(row[j], grainByCol.get(j), tsModule);
      td.textContent = cellValue;
      if (j === metricColIdx && decoration.severity) {
        td.classList.add(`nb-cell-value`);
      }
      tr.appendChild(td);
    }
    if (hasNotes) {
      const noteTd = document.createElement("td");
      noteTd.className = "nb-cell-note";
      if (decoration.matches.length > 0) {
        noteTd.textContent = decoration.matches
          .map((m) => formatRowMatchNote(m, tsModule))
          .join("; ");
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

function formatCellValue(
  val: string | number | null,
  grain: Grain | undefined,
  tsModule: TsRuntimeApi
): string {
  if (val === null || val === undefined) return "NULL";
  if (grain && typeof val === "string") {
    const iso = val.slice(0, 10);
    return tsModule.formatTimeBucket(iso, grain);
  }
  if (typeof val === "number") {
    if (Number.isInteger(val)) return val.toString();
    return val.toFixed(2);
  }
  return String(val);
}

function formatRowMatchNote(m: LexiconMatch, tsModule: TsRuntimeApi): string {
  if (m.kind === "region") {
    return `⚠ ${m.entry.name} · ${tsModule.renderRegion(m.overlap)}`;
  }
  if (m.side === "straddles") {
    return `✗ ${m.entry.name} · straddles cut at ${m.crossedAt}`;
  }
  const label =
    m.side === "before" ? m.entry.before.label : m.entry.after.label;
  return `┃ ${m.entry.name} · ${m.side}: ${label}`;
}

function renderReconciliationBlock(matches: LexiconMatch[]): HTMLElement {
  const block = document.createElement("section");
  block.className = "nb-reconciliation";

  const header = document.createElement("header");
  header.className = "nb-block-header";
  header.textContent =
    matches.length === 1
      ? `Reconciliation · 1 entry matched`
      : `Reconciliation · ${matches.length} entries matched`;
  block.appendChild(header);

  const list = document.createElement("ul");
  list.className = "nb-match-list";
  for (const m of matches) {
    list.appendChild(renderMatchItem(m));
  }
  block.appendChild(list);

  return block;
}

function renderMatchItem(m: LexiconMatch): HTMLElement {
  const item = document.createElement("li");
  item.className = `nb-match nb-match-${m.kind}`;

  const head = document.createElement("div");
  head.className = "nb-match-head";

  const kindTag = document.createElement("span");
  kindTag.className = `kind-tag kind-${m.kind}`;
  kindTag.textContent = m.kind;
  head.appendChild(kindTag);

  const name = document.createElement("span");
  name.className = "nb-match-name";
  name.textContent = m.entry.name;
  head.appendChild(name);

  const meta = document.createElement("span");
  meta.className = "nb-match-meta";
  if (m.kind === "region") {
    meta.textContent = m.impact.metric;
  } else {
    meta.textContent = `${m.metric} · cut at ${m.crossedAt}`;
  }
  head.appendChild(meta);

  item.appendChild(head);

  if (m.kind === "region") {
    const desc = document.createElement("p");
    desc.className = "nb-match-desc";
    desc.textContent = m.entry.description;
    item.appendChild(desc);
  } else {
    const regimes = document.createElement("div");
    regimes.className = "regimes";
    regimes.appendChild(renderRegime("before", m.entry.before));
    regimes.appendChild(renderRegime("after", m.entry.after));
    item.appendChild(regimes);

    const change = document.createElement("p");
    change.className = "nb-match-change";
    change.textContent =
      m.entry.changeDescription ??
      `On ${m.crossedAt}, ${m.metric} shifted from "${m.entry.before.label}" to "${m.entry.after.label}".`;
    item.appendChild(change);
  }

  return item;
}

function renderRegime(
  side: "before" | "after",
  regime: RegimeDescription
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = `regime regime-${side}`;

  const tag = document.createElement("span");
  tag.className = "regime-tag";
  tag.textContent = `${side} · ${regime.label}`;
  wrap.appendChild(tag);

  const desc = document.createElement("span");
  desc.className = "regime-desc";
  desc.textContent = regime.description;
  wrap.appendChild(desc);

  return wrap;
}

function renderHistoricalBlock(note: HistoricalNote): HTMLElement {
  const block = document.createElement("aside");
  block.className = "nb-historical";

  const header = document.createElement("header");
  header.className = "nb-block-header nb-historical-header";
  const title = document.createElement("span");
  title.textContent = "ℹ Historical context";
  header.appendChild(title);
  const meta = document.createElement("span");
  meta.className = "nb-block-meta";
  meta.textContent = `${note.boundary.name} · ${note.metric}`;
  header.appendChild(meta);
  block.appendChild(header);

  const lead = document.createElement("p");
  lead.className = "nb-historical-lead";
  lead.textContent = `These values were computed under the pre-cut regime.`;
  block.appendChild(lead);

  const regimes = document.createElement("div");
  regimes.className = "regimes";
  regimes.appendChild(renderRegime("before", note.boundary.before));
  regimes.appendChild(renderRegime("after", note.boundary.after));
  block.appendChild(regimes);

  const foot = document.createElement("p");
  foot.className = "nb-historical-foot";
  foot.textContent = `As of ${note.boundary.at}, ${note.metric} is reported under the "${note.boundary.after.label}" regime.`;
  block.appendChild(foot);

  return block;
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

function renderRegisterCell(
  source: string,
  result: Extract<ExecuteResult, { statement: "register" }>
): HTMLElement {
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
    const list = document.createElement("ul");
    list.className = "nb-register-impacts";
    for (const impact of e.impacts) {
      const li = document.createElement("li");
      li.textContent = `${impact.metric} over ${impact.region.timeStart} to ${impact.region.timeEnd}`;
      list.appendChild(li);
    }
    output.appendChild(list);
    const desc = document.createElement("p");
    desc.className = "nb-register-desc";
    desc.textContent = e.description;
    output.appendChild(desc);
  } else {
    const meta = document.createElement("p");
    meta.className = "nb-register-meta";
    meta.textContent = `Cut at ${e.at} · impacts ${e.metrics.join(", ")}`;
    output.appendChild(meta);
    const regimes = document.createElement("div");
    regimes.className = "regimes";
    regimes.appendChild(renderRegime("before", e.before));
    regimes.appendChild(renderRegime("after", e.after));
    output.appendChild(regimes);
  }

  return cell;
}

function renderCheckCell(
  source: string,
  result: Extract<ExecuteResult, { statement: "check" }>,
  tsModule: TsRuntimeApi
): HTMLElement {
  const { cell, output } = renderCellShell(source, "check");
  if (result.matches.length === 0) {
    const empty = document.createElement("p");
    empty.className = "nb-check-empty";
    empty.textContent = "(no lexicon matches)";
    output.appendChild(empty);
    return cell;
  }
  const header = document.createElement("header");
  header.className = "nb-block-header";
  header.textContent = `${result.matches.length} match${result.matches.length === 1 ? "" : "es"}`;
  output.appendChild(header);

  const list = document.createElement("ul");
  list.className = "nb-match-list";
  for (const m of result.matches) {
    list.appendChild(renderCheckMatchItem(m, tsModule));
  }
  output.appendChild(list);
  return cell;
}

function renderCheckMatchItem(m: LexiconMatch, tsModule: TsRuntimeApi): HTMLElement {
  const item = renderMatchItem(m);
  // Augment region matches with the overlap region — useful in CHECK
  // since there's no row context to anchor the match.
  if (m.kind === "region") {
    const overlap = document.createElement("span");
    overlap.className = "nb-match-overlap";
    overlap.textContent = ` · ${tsModule.renderRegion(m.overlap)}`;
    item.querySelector(".nb-match-head")?.appendChild(overlap);
  }
  return item;
}

function renderErrorCell(
  source: string,
  errors: { message: string }[],
  tsModule: TsRuntimeApi
): HTMLElement {
  const { cell, output } = renderCellShell(source, "error");
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
  return cell;
}

main();

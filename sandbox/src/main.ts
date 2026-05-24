// True Speech v0.3.0 sandbox — wires the runtime to two REPL panels
// (TS top, SQL bottom) over a shared DuckDB instance, with an in-memory
// lexicon rendered as a panel above.
//
// On every TS submit, parse → validate → execute, then dispatch on the
// statement kind: COMPUTE renders SQL + results (with per-row
// reconciliation matches and historical notes), REGISTER appends to the
// lexicon and refreshes the panel, CHECK lists matching entries.
//
// v0.3.0 surface highlights:
//  - Boundary entries carry BEFORE/AFTER regime descriptions
//  - ComputeResult.decorations carries `severity` per row (warn / error)
//  - BoundaryMatch carries a per-row `side` (before / after / straddles)
//  - ComputeResult.historicalNotes — emitted when a query falls entirely
//    behind a boundary; rendered as an informational footer.

import { IMPORTS } from "./config.js";
import { initDatabase, query as dbQuery } from "./db.js";
import { createRepl, createConnector } from "./repl.js";
import type { RowDecoration as ReplRowDecoration } from "./repl.js";
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
  // True iff the lexicon's current entries differ from the snapshotted
  // seed. Used by the examples panel to surface a "lexicon modified"
  // alert so canned-query explanations don't silently mislead.
  //
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

    // Forward-declared so the panels' callbacks can refresh each other
    // without a circular construction.
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

    const tsRepl = createRepl({
      prompt: "ts> ",
      label: "True Speech",
      onSubmit: (input: string) =>
        handleTsCommand(input, ts, tsModule, tsRepl, dbRepl, connector, syncDependentPanels),
    });

    const connector = createConnector();

    const dbRepl = createRepl({
      prompt: "sql> ",
      label: "DuckDB",
      onSubmit: (input: string) => handleSqlCommand(input, dbRepl),
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
          // Clipboard API can fail in some sandboxed iframes; fall back
          // to selecting the command text so the user can copy manually.
          console.warn("Clipboard write failed; user must copy manually.");
        }
      },
      onRun: (command) => {
        tsRepl.element.scrollIntoView({ behavior: "smooth", block: "start" });
        tsRepl.submit(command);
      },
    });

    container.appendChild(lexiconPanel.element);
    container.appendChild(examplesPanel.element);
    container.appendChild(tsRepl.element);
    container.appendChild(connector.element);
    container.appendChild(dbRepl.element);

    tsRepl.focus();
  } catch (err: unknown) {
    loadingEl.textContent = `Failed to initialize: ${
      err instanceof Error ? err.message : String(err)
    }`;
    loadingEl.style.color = "#f44747";
    console.error("Initialization error:", err);
  }
}

async function handleTsCommand(
  input: string,
  ts: ReturnType<TsRuntimeApi["TrueSpeech"] extends new (...a: any) => infer R ? () => R : never>,
  tsModule: TsRuntimeApi,
  tsRepl: ReturnType<typeof createRepl>,
  dbRepl: ReturnType<typeof createRepl>,
  connector: ReturnType<typeof createConnector>,
  syncDependentPanels: () => void
) {
  const trimmed = input.trim();
  if (trimmed.length === 0) return;

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
        syncDependentPanels();
        break;
      case "check":
        renderCheck(result, tsRepl, tsModule);
        break;
    }
  } catch (err: unknown) {
    tsRepl.appendError(err instanceof Error ? err.message : String(err));
  }
}

async function renderCompute(
  result: Extract<ExecuteResult, { statement: "compute" }>,
  tsRepl: ReturnType<typeof createRepl>,
  dbRepl: ReturnType<typeof createRepl>,
  connector: ReturnType<typeof createConnector>,
  tsModule: TsRuntimeApi
) {
  tsRepl.appendSQL(result.sql);

  await connector.flashDown();
  dbRepl.appendOutput(`ts> ${result.sql}`, "repl-echo");
  dbRepl.appendTable(result.results.columns, result.results.rows);

  await new Promise((r) => setTimeout(r, 250));
  await connector.flashUp();

  const tsRows = formatTimeBucketColumns(result, tsModule.formatTimeBucket);
  const replDecorations = mapDecorations(result.decorations, tsModule.renderRegion);
  await tsRepl.appendTable(result.results.columns, tsRows, {
    animate: true,
    decorations: replDecorations,
  });

  if (result.reconciliation.length > 0) {
    tsRepl.appendOutput(
      formatReconciliationFooter(result.reconciliation),
      "repl-reconciliation"
    );
  }

  for (const note of result.historicalNotes) {
    tsRepl.appendOutput(formatHistoricalNote(note), "repl-historical");
  }
}

// Map runtime decorations to the REPL's {highlight, note} shape.
// Region match  → ⚠ <name> · <overlap>
// Boundary side → ┃ <name> · <regime label>            (warn rows)
//                 ✗ <name> · straddles cut at <date>   (error rows)
function mapDecorations(
  runtimeDecs: RuntimeRowDecoration[],
  renderRegion: (r: ResolvedRegion) => string
): (ReplRowDecoration | undefined)[] {
  return runtimeDecs.map((d) => {
    if (!d.matches || d.matches.length === 0) return undefined;
    const note = d.matches.map((m) => formatRowMatch(m, renderRegion)).join("; ");
    return { highlight: d.severity ?? "warn", note };
  });
}

function formatRowMatch(
  m: LexiconMatch,
  renderRegion: (r: ResolvedRegion) => string
): string {
  if (m.kind === "region") {
    return `⚠ ${m.entry.name} · ${renderRegion(m.overlap)}`;
  }
  if (m.side === "straddles") {
    return `✗ ${m.entry.name} · straddles cut at ${m.crossedAt}`;
  }
  const label =
    m.side === "before" ? m.entry.before.label : m.entry.after.label;
  return `┃ ${m.entry.name} · ${m.side}: ${label}`;
}

function formatTimeBucketColumns(
  result: Extract<ExecuteResult, { statement: "compute" }>,
  formatTimeBucket: (isoStart: string, grain: Grain) => string
): (string | number | null)[][] {
  const groupBys: { dimension: string; grain?: Grain }[] =
    result.semanticQuery.groupBy ?? [];
  const grainByCol = new Map<number, Grain>();
  for (let i = 0; i < groupBys.length; i++) {
    const g = groupBys[i].grain;
    if (g) grainByCol.set(i, g);
  }
  if (grainByCol.size === 0) return result.results.rows;

  return result.results.rows.map((row) =>
    row.map((cell, i) => {
      const grain = grainByCol.get(i);
      if (!grain) return cell;
      if (cell == null) return cell;
      const iso = String(cell).slice(0, 10);
      return formatTimeBucket(iso, grain);
    })
  );
}

function renderRegister(
  result: Extract<ExecuteResult, { statement: "register" }>,
  tsRepl: ReturnType<typeof createRepl>
) {
  const e = result.entry;
  if (e.kind === "region") {
    const impactCount = e.impacts.length;
    tsRepl.appendOutput(
      `✓ Registered region "${e.name}" with ${impactCount} impact${impactCount === 1 ? "" : "s"}`,
      "repl-register"
    );
  } else {
    tsRepl.appendOutput(
      `✓ Registered boundary "${e.name}" cut at ${e.at} (${e.metrics.length} metric${e.metrics.length === 1 ? "" : "s"}; before: "${e.before.label}", after: "${e.after.label}")`,
      "repl-register"
    );
  }
}

function renderCheck(
  result: Extract<ExecuteResult, { statement: "check" }>,
  tsRepl: ReturnType<typeof createRepl>,
  tsModule: TsRuntimeApi
) {
  if (result.matches.length === 0) {
    tsRepl.appendOutput("(no lexicon matches)", "repl-check");
    return;
  }
  const header = `${result.matches.length} match${result.matches.length === 1 ? "" : "es"}`;
  tsRepl.appendOutput(
    `${header}\n${formatCheckMatches(result.matches, tsModule.renderRegion)}`,
    "repl-check"
  );
}

function formatReconciliationFooter(matches: LexiconMatch[]): string {
  const header =
    matches.length === 1
      ? `⚠ Reconciliation: 1 lexicon entry matched this region`
      : `⚠ Reconciliation: ${matches.length} lexicon entries matched this region`;
  const body = matches
    .map((m) => {
      if (m.kind === "region") {
        return `  • ${m.entry.name} (region · ${m.impact.metric})\n      "${m.entry.description}"`;
      }
      // Boundary: spell out both regime descriptions and the composed
      // change sentence (or the WITH override, if given).
      const change =
        m.entry.changeDescription ??
        composeChangeSentence(m.entry, m.metric, m.crossedAt);
      return (
        `  • ${m.entry.name} (boundary · ${m.metric} at ${m.crossedAt})\n` +
        `      before "${m.entry.before.label}": ${m.entry.before.description}\n` +
        `      after  "${m.entry.after.label}": ${m.entry.after.description}\n` +
        `      ${change}`
      );
    })
    .join("\n");
  return `${header}\n${body}`;
}

// Runtime-owned wording for the historical-context footer. The pre-cut
// regime is being read; the post-cut regime is "now."
function formatHistoricalNote(note: HistoricalNote): string {
  const b = note.boundary;
  return (
    `ℹ Historical context (${b.name} · ${note.metric})\n` +
    `  These values were computed under the pre-cut regime ("${b.before.label}"):\n` +
    `    "${b.before.description}"\n` +
    `  As of ${b.at}, ${note.metric} is reported under "${b.after.label}":\n` +
    `    "${b.after.description}"`
  );
}

// Runtime-owned change-sentence composition when no WITH override.
function composeChangeSentence(
  entry: BoundaryLexiconEntry,
  metric: string,
  at: string
): string {
  return `On ${at}, ${metric} shifted from "${entry.before.label}" to "${entry.after.label}".`;
}

function formatCheckMatches(
  matches: LexiconMatch[],
  renderRegion: (r: ResolvedRegion) => string
): string {
  return matches
    .map((m) => {
      if (m.kind === "region") {
        const region = renderRegion(m.overlap);
        return `  • ${m.entry.name}  (region · ${m.impact.metric} · ${region})\n      "${m.entry.description}"`;
      }
      return `  • ${m.entry.name}  (boundary · ${m.metric} at ${m.crossedAt})\n      before "${m.entry.before.label}": ${m.entry.before.description}\n      after  "${m.entry.after.label}": ${m.entry.after.description}`;
    })
    .join("\n");
}

function renderErrorList(
  errors: any[],
  source: string,
  renderError: (e: any, s: string) => string,
  tsRepl: ReturnType<typeof createRepl>
) {
  for (const e of errors) {
    tsRepl.appendError(renderError(e, source));
  }
}

async function handleSqlCommand(
  input: string,
  dbRepl: ReturnType<typeof createRepl>
) {
  const trimmed = input.trim();
  if (trimmed.length === 0) return;
  try {
    const result = await dbQuery(trimmed);
    dbRepl.appendTable(result.columns, result.rows);
  } catch (err: unknown) {
    dbRepl.appendError(err instanceof Error ? err.message : String(err));
  }
}

main();

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

interface ResolvedRegion {
  timeStart: string;
  timeEnd: string;
  constraints: { dimension: string; operator: string; value: string | number | (string | number)[] }[];
}
interface Impact {
  metric: string;
  region: ResolvedRegion;
}
interface LexiconEntry {
  name: string;
  impacts: Impact[];
  description: string;
}
interface LexiconMatch {
  entry: LexiconEntry;
  impact: Impact;
  overlap: ResolvedRegion;
}

type ExecuteResult =
  | {
      statement: "compute";
      semanticQuery: any;
      sql: string;
      results: { columns: string[]; rows: (string | number | null)[][] };
      reconciliation: LexiconMatch[];
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
  TrueSpeechExecutionError: new (errors: any[]) => Error & { errors: any[] };
}

// In-memory LexiconAdapter with delete/reset extensions for the panel.
// Snapshot the seed at construction; reset() restores it.
class MemoryLexicon {
  private entries: LexiconEntry[] = [];
  private seed: LexiconEntry[] = [];

  // ----- LexiconAdapter (used by the runtime) -----
  async add(entry: LexiconEntry): Promise<void> {
    this.entries.push(entry);
  }
  async list(): Promise<LexiconEntry[]> {
    return this.entries.map(cloneEntry);
  }

  // ----- Panel API -----
  getEntries(): LexiconEntry[] {
    return this.entries.map(cloneEntry);
  }
  delete(name: string): void {
    this.entries = this.entries.filter((e) => e.name !== name);
  }
  // Capture the current state as the seed (called after running the
  // seed REGISTERs through the runtime).
  snapshotSeed(): void {
    this.seed = this.entries.map(cloneEntry);
  }
  reset(): void {
    this.entries = this.seed.map(cloneEntry);
  }
}

function cloneEntry(e: LexiconEntry): LexiconEntry {
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
  `REGISTER q1_data_quality_issue
     IMPACTING total_sales OVER 2026-02-15 to 2026-02-20
     WITH "Order amounts undercounted by ~12% during a backfill window — investigate before reporting Q1 totals."`,
  `REGISTER northeast_fulfillment_outage
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
      onSubmit: (input: string) =>
        handleTsCommand(input, ts, tsModule, tsRepl, dbRepl, connector, lexiconPanel),
    });

    const connector = createConnector();

    const dbRepl = createRepl({
      prompt: "sql> ",
      label: "DuckDB",
      onSubmit: (input: string) => handleSqlCommand(input, dbRepl),
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
        command:
          "COMPUTE average_order_value OVER 2025-Q4 to 2026-Q1 GROUP BY product_tier",
      },
      {
        label: "Check Q1",
        command: "CHECK total_sales, average_order_value OVER 2026-Q1",
      },
      {
        label: "Register a flag",
        command:
          `REGISTER promo_spike\n  IMPACTING total_sales OVER 2026-03-15 to 2026-03-22\n  WITH "Spring promotion ran during this window"`,
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
  lexiconPanel: ReturnType<typeof createLexiconPanel>
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
        lexiconPanel.refresh();
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
  // The DB panel shows raw rows (it's the database's view of the world).
  dbRepl.appendOutput(`ts> ${result.sql}`, "repl-echo");
  dbRepl.appendTable(result.results.columns, result.results.rows);

  await new Promise((r) => setTimeout(r, 250));
  await connector.flashUp();
  // The TS panel shows time buckets at their natural grain (2026-01,
  // 2026-Q1) instead of as the bucket-start ISO date.
  const tsRows = formatTimeBucketColumns(result, tsModule.formatTimeBucket);
  await tsRepl.appendTable(result.results.columns, tsRows, true);

  if (result.reconciliation.length > 0) {
    tsRepl.appendOutput(
      formatReconciliation(result.reconciliation, tsModule.renderRegion),
      "repl-reconciliation"
    );
  }
}

// Post-process result rows so that columns originating from a time-grain
// GROUP BY render at their natural grain. The runtime's column rename
// makes group-by columns appear in the same order as semanticQuery.groupBy,
// so we match by index — no name parsing required.
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
  const impactCount = e.impacts.length;
  tsRepl.appendOutput(
    `✓ Registered "${e.name}" with ${impactCount} impact${impactCount === 1 ? "" : "s"}`,
    "repl-register"
  );
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
    `${header}\n${formatMatches(result.matches, tsModule.renderRegion)}`,
    "repl-check"
  );
}

function formatReconciliation(
  matches: LexiconMatch[],
  renderRegion: (r: ResolvedRegion) => string
): string {
  const header = matches.length === 1
    ? `⚠ Reconciliation: 1 lexicon entry overlaps this region`
    : `⚠ Reconciliation: ${matches.length} lexicon entries overlap this region`;
  return `${header}\n${formatMatches(matches, renderRegion)}`;
}

function formatMatches(
  matches: LexiconMatch[],
  renderRegion: (r: ResolvedRegion) => string
): string {
  return matches
    .map((m) => {
      const region = renderRegion(m.overlap);
      return `  • ${m.entry.name}  (${m.impact.metric} · ${region})\n      "${m.entry.description}"`;
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

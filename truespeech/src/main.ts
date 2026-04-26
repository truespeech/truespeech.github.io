// True Speech demo — wires the runtime to two REPL panels (TS top,
// SQL bottom) over a shared DuckDB instance.
//
// On every TS submit:
//   1. parse — render any errors as Rust-style caret diagnostics
//   2. validate — same
//   3. execute — show the generated SQL in the TS panel, cascade down
//      to the SQL panel, run, show results, cascade back up
//
// The SQL panel is identical to the OSI demo's: type SQL directly,
// see results.

import { IMPORTS } from "./config.js";
import { initDatabase, query as dbQuery } from "./db.js";
import { createRepl, createConnector } from "./repl.js";

interface TsRuntimeApi {
  TrueSpeech: new (opts: {
    semanticLayer: any;
    database: { execute: (sql: string) => Promise<any> };
  }) => {
    parse(source: string): { ast: any; errors: any[] };
    validate(ast: any): { errors: any[] };
    execute(source: string): Promise<{
      semanticQuery: any;
      sql: string;
      results: { columns: string[]; rows: (string | number | null)[][] };
    }>;
  };
  osiAdapter: (runtime: any) => any;
  renderError: (error: any, source: string) => string;
  TrueSpeechExecutionError: new (errors: any[]) => Error & { errors: any[] };
}

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
    // Load runtimes in parallel. js-yaml URL goes through a const so
    // TypeScript doesn't try to type-check the bare URL.
    const jsYamlUrl = "https://cdn.jsdelivr.net/npm/js-yaml/+esm";
    const [tsModule, osiModule, jsYaml]: [TsRuntimeApi, any, any] =
      await Promise.all([
        import(IMPORTS.trueSpeech) as Promise<TsRuntimeApi>,
        import(IMPORTS.osiRuntime),
        import(jsYamlUrl),
      ]);

    // Build the OSI runtime from YAML.
    const yamlText = await fetch(IMPORTS.semanticModel).then((r) => r.text());
    const modelObj = jsYaml.default.load(yamlText);
    const osi = new osiModule.OsiRuntime(modelObj);

    // Initialize DuckDB with the same retail_sales corpus the OSI demo uses.
    const [schemaSQL, dataSQL] = await Promise.all([
      fetch(IMPORTS.schema).then((r) => r.text()),
      fetch(IMPORTS.data).then((r) => r.text()),
    ]);
    await initDatabase(schemaSQL, dataSQL);

    // Wire the True Speech runtime: OSI as semantic layer, DuckDB as database.
    const ts = new tsModule.TrueSpeech({
      semanticLayer: tsModule.osiAdapter(osi),
      database: { execute: dbQuery },
    });

    loadingEl.remove();

    // REPL panels
    const tsRepl = createRepl({
      prompt: "ts> ",
      label: "True Speech",
      onSubmit: (input: string) =>
        handleTsCommand(input, ts, tsModule.renderError, tsRepl, dbRepl, connector),
    });

    const connector = createConnector();

    const dbRepl = createRepl({
      prompt: "sql> ",
      label: "DuckDB",
      onSubmit: (input: string) => handleSqlCommand(input, dbRepl),
    });

    // Example queries — each demonstrates a different capability.
    const examples = [
      {
        label: "Total 2026 sales",
        command: "COMPUTE total_sales OVER 2026",
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
        label: "February northeast",
        command:
          "COMPUTE total_sales OVER 2026-02 AND region = 'northeast'",
      },
      {
        label: "Q4 to Q1 by tier",
        command:
          "COMPUTE average_order_value OVER 2025-Q4 to 2026-Q1 GROUP BY product_tier",
      },
      {
        label: "Since Jan 15",
        command:
          "COMPUTE total_sales OVER since 2026-01-15 GROUP BY week ORDER BY week",
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
  renderError: TsRuntimeApi["renderError"],
  tsRepl: ReturnType<typeof createRepl>,
  dbRepl: ReturnType<typeof createRepl>,
  connector: ReturnType<typeof createConnector>
) {
  const trimmed = input.trim();
  if (trimmed.length === 0) return;

  // Phase 1: parse
  const { ast, errors: parseErrors } = ts.parse(trimmed);
  if (parseErrors.length > 0) {
    renderErrorList(parseErrors, trimmed, renderError, tsRepl);
    return;
  }
  if (!ast) {
    tsRepl.appendError("Empty input");
    return;
  }

  // Phase 2: validate
  const { errors: validateErrors } = ts.validate(ast);
  if (validateErrors.length > 0) {
    renderErrorList(validateErrors, trimmed, renderError, tsRepl);
    return;
  }

  // Phase 3: execute. Errors at this point should only be DB-level
  // failures since parse/validate already passed.
  try {
    const result = await ts.execute(trimmed);

    // Show the SQL in the TS panel
    tsRepl.appendSQL(result.sql);

    // Cascade down to the DB panel
    await connector.flashDown();
    dbRepl.appendOutput(`ts> ${result.sql}`, "repl-echo");
    dbRepl.appendTable(result.results.columns, result.results.rows);

    // Cascade back up with the results
    await new Promise((r) => setTimeout(r, 250));
    await connector.flashUp();
    await tsRepl.appendTable(
      result.results.columns,
      result.results.rows,
      true
    );
  } catch (err: unknown) {
    tsRepl.appendError(
      err instanceof Error ? err.message : String(err)
    );
  }
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

/**
 * DuckDB-WASM initialization and query helper.
 * Loads DuckDB-WASM from CDN, creates an in-memory database,
 * and provides a simple query interface.
 */

let db: any = null;
let conn: any = null;

/**
 * Initialize DuckDB-WASM with the given schema and data SQL.
 * Loads DuckDB-WASM from CDN on first call.
 */
export async function initDatabase(
  schemaSQL: string,
  dataSQL: string
): Promise<void> {
  // Dynamic import from CDN — TypeScript can't resolve CDN URLs
  const duckdbUrl = "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm/+esm";
  const duckdb: any = await import(/* @vite-ignore */ duckdbUrl);

  const DUCKDB_BUNDLES = await duckdb.selectBundle({
    mvp: {
      mainModule:
        "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm",
      mainWorker:
        "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js",
    },
    eh: {
      mainModule:
        "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm/dist/duckdb-eh.wasm",
      mainWorker:
        "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js",
    },
  });

  // Create a same-origin blob URL for the worker to avoid cross-origin restrictions.
  // The blob simply imports the CDN-hosted worker script.
  const workerUrl = URL.createObjectURL(
    new Blob([`importScripts("${DUCKDB_BUNDLES.mainWorker!}");`], {
      type: "text/javascript",
    })
  );
  const worker = new Worker(workerUrl);
  const logger = new duckdb.ConsoleLogger();
  db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(DUCKDB_BUNDLES.mainModule);
  URL.revokeObjectURL(workerUrl);

  conn = await db.connect();

  // Run schema and data
  await conn.query(schemaSQL);

  // Split data SQL into individual statements and execute
  const statements = dataSQL
    .split(";")
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0);

  for (const stmt of statements) {
    await conn.query(stmt + ";");
  }
}

/**
 * Execute a SQL query and return results as columns + rows.
 */
export async function query(
  sql: string
): Promise<{ columns: string[]; rows: (string | number | null)[][] }> {
  if (!conn) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }

  const result = await conn.query(sql);

  // Extract column names from the Arrow schema
  const columns: string[] = result.schema.fields.map(
    (f: { name: string }) => f.name
  );

  // Convert Arrow table to plain arrays
  const rows: (string | number | null)[][] = [];
  for (let i = 0; i < result.numRows; i++) {
    const row: (string | number | null)[] = [];
    for (let j = 0; j < columns.length; j++) {
      const col = result.getChildAt(j);
      const val = col?.get(i);
      // Convert BigInt to Number for display, handle null
      if (val === null || val === undefined) {
        row.push(null);
      } else if (typeof val === "bigint") {
        row.push(Number(val));
      } else if (val instanceof Date) {
        row.push(val.toISOString().split("T")[0]);
      } else {
        row.push(val);
      }
    }
    rows.push(row);
  }

  return { columns, rows };
}

/**
 * Check if the database is initialized.
 */
export function isReady(): boolean {
  return conn !== null;
}

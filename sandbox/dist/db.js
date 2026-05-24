/**
 * DuckDB-WASM initialization and query helper.
 * Loads DuckDB-WASM from CDN, creates an in-memory database,
 * and provides a simple query interface.
 */
let db = null;
let conn = null;
/**
 * Initialize DuckDB-WASM with the given schema and data SQL.
 * Loads DuckDB-WASM from CDN on first call.
 */
export async function initDatabase(schemaSQL, dataSQL) {
    // Dynamic import from CDN — TypeScript can't resolve CDN URLs
    const duckdbUrl = "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm/+esm";
    const duckdb = await import(/* @vite-ignore */ duckdbUrl);
    const DUCKDB_BUNDLES = await duckdb.selectBundle({
        mvp: {
            mainModule: "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm",
            mainWorker: "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js",
        },
        eh: {
            mainModule: "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm/dist/duckdb-eh.wasm",
            mainWorker: "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js",
        },
    });
    // Create a same-origin blob URL for the worker to avoid cross-origin restrictions.
    // The blob simply imports the CDN-hosted worker script.
    const workerUrl = URL.createObjectURL(new Blob([`importScripts("${DUCKDB_BUNDLES.mainWorker}");`], {
        type: "text/javascript",
    }));
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
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    for (const stmt of statements) {
        await conn.query(stmt + ";");
    }
}
/**
 * Execute a SQL query and return results as columns + rows.
 */
export async function query(sql) {
    if (!conn) {
        throw new Error("Database not initialized. Call initDatabase() first.");
    }
    const result = await conn.query(sql);
    // Extract column names AND type names from the Arrow schema. Arrow
    // type's String() form is like "Timestamp<MILLISECOND>", "Date32",
    // "Int32" — useful for spotting temporal columns that DuckDB returns
    // as raw millis numbers (e.g. DATE_TRUNC results).
    const columns = result.schema.fields.map((f) => f.name);
    const typeNames = result.schema.fields.map((f) => String(f.type));
    // Convert Arrow table to plain arrays
    const rows = [];
    for (let i = 0; i < result.numRows; i++) {
        const row = [];
        for (let j = 0; j < columns.length; j++) {
            const col = result.getChildAt(j);
            const val = col?.get(i);
            const isTemporalCol = typeNames[j].startsWith("Timestamp") ||
                typeNames[j].startsWith("Date");
            if (val === null || val === undefined) {
                row.push(null);
            }
            else if (val instanceof Date) {
                row.push(val.toISOString().split("T")[0]);
            }
            else if (isTemporalCol && (typeof val === "number" || typeof val === "bigint")) {
                // DuckDB-WASM returns TIMESTAMP / DATE values as numeric millis
                // when not surfaced as a Date. Format as YYYY-MM-DD.
                const ms = typeof val === "bigint" ? Number(val) : val;
                row.push(new Date(ms).toISOString().split("T")[0]);
            }
            else if (typeof val === "bigint") {
                row.push(Number(val));
            }
            else {
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
export function isReady() {
    return conn !== null;
}

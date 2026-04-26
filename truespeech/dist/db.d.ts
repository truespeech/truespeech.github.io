/**
 * DuckDB-WASM initialization and query helper.
 * Loads DuckDB-WASM from CDN, creates an in-memory database,
 * and provides a simple query interface.
 */
/**
 * Initialize DuckDB-WASM with the given schema and data SQL.
 * Loads DuckDB-WASM from CDN on first call.
 */
export declare function initDatabase(schemaSQL: string, dataSQL: string): Promise<void>;
/**
 * Execute a SQL query and return results as columns + rows.
 */
export declare function query(sql: string): Promise<{
    columns: string[];
    rows: (string | number | null)[][];
}>;
/**
 * Check if the database is initialized.
 */
export declare function isReady(): boolean;

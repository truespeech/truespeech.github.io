/**
 * Main entry point for the OSI Runtime demo page.
 * Initializes DuckDB, loads the semantic model, and wires the REPL panels.
 */
import { IMPORTS } from "./config.js";
import { initDatabase, query as dbQuery } from "./db.js";
import { createRepl, createConnector } from "./repl.js";
import { parseCommand } from "./command-parser.js";
import { HELP_MAIN, HELP_QUERY, HELP_SQL } from "./help.js";
async function main() {
    const container = document.getElementById("demo");
    if (!container) {
        console.error("No #demo container found");
        return;
    }
    // Show loading state
    const loadingEl = document.createElement("div");
    loadingEl.className = "loading";
    loadingEl.textContent = "Initializing DuckDB and loading data...";
    container.appendChild(loadingEl);
    try {
        // Load the OSI runtime library
        const { OsiRuntime } = await import(IMPORTS.osiRuntime);
        // Fetch the semantic model YAML and parse it
        const jsYamlUrl = "https://cdn.jsdelivr.net/npm/js-yaml/+esm";
        const jsYaml = await import(jsYamlUrl);
        const yamlText = await fetch(IMPORTS.semanticModel).then((r) => r.text());
        const modelObj = jsYaml.default.load(yamlText);
        const runtime = new OsiRuntime(modelObj);
        // Fetch SQL files and initialize DuckDB
        const [schemaSQL, dataSQL] = await Promise.all([
            fetch(IMPORTS.schema).then((r) => r.text()),
            fetch(IMPORTS.data).then((r) => r.text()),
        ]);
        await initDatabase(schemaSQL, dataSQL);
        // Remove loading indicator
        loadingEl.remove();
        // Create REPL panels
        const osiRepl = createRepl({
            prompt: "osi> ",
            label: "OSI Runtime",
            onSubmit: (input) => handleOsiCommand(input, runtime, osiRepl, dbRepl, connector),
        });
        const connector = createConnector();
        const dbRepl = createRepl({
            prompt: "sql> ",
            label: "DuckDB",
            onSubmit: (input) => handleSqlCommand(input, dbRepl),
        });
        // Example query buttons
        const examples = [
            { label: "Total sales", command: "query total_sales" },
            { label: "Sales by region", command: "query total_sales by region" },
            { label: "Weekly sales", command: "query total_sales by order_date:week order by order_date_week limit 10" },
            { label: "Avg order value", command: "query average_order_value" },
            { label: "AOV by tier", command: "query average_order_value by product_tier" },
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
            btn.addEventListener("click", () => osiRepl.setInput(ex.command));
            exampleBar.appendChild(btn);
        }
        container.appendChild(exampleBar);
        container.appendChild(osiRepl.element);
        container.appendChild(connector.element);
        container.appendChild(dbRepl.element);
        // Focus the OSI panel
        osiRepl.focus();
    }
    catch (err) {
        loadingEl.textContent = `Failed to initialize: ${err instanceof Error ? err.message : String(err)}`;
        loadingEl.style.color = "#f44747";
        console.error("Initialization error:", err);
    }
}
async function handleOsiCommand(input, runtime, osiRepl, dbRepl, connector) {
    const parsed = parseCommand(input);
    switch (parsed.type) {
        case "help": {
            if ("command" in parsed && parsed.command === "query") {
                osiRepl.appendOutput(HELP_QUERY);
            }
            else {
                osiRepl.appendOutput(HELP_MAIN);
            }
            break;
        }
        case "metrics": {
            const metrics = runtime.listMetrics();
            if (metrics.length === 0) {
                osiRepl.appendOutput("No metrics defined.");
            }
            else {
                const lines = metrics.map((m) => {
                    const desc = m.description ? `  ${m.description}` : "";
                    return `  ${m.name.padEnd(24)}${desc}`;
                });
                osiRepl.appendOutput(lines.join("\n"));
            }
            break;
        }
        case "dimensions": {
            try {
                const dims = runtime.dimensionsForMetric(parsed.metric);
                if (dims.length === 0) {
                    osiRepl.appendOutput(`No dimensions available for "${parsed.metric}".`);
                }
                else {
                    const lines = dims.map((d) => {
                        const tag = d.isTime ? " (time)" : "";
                        const desc = d.description ? `  ${d.description}` : "";
                        return `  ${(d.name + tag).padEnd(24)}${desc}`;
                    });
                    osiRepl.appendOutput(lines.join("\n"));
                }
            }
            catch (err) {
                osiRepl.appendError(err instanceof Error ? err.message : String(err));
            }
            break;
        }
        case "query": {
            try {
                // Generate SQL
                const sql = runtime.toSQL(parsed.query);
                osiRepl.appendSQL(sql);
                // Cascade down arrows
                await connector.flashDown();
                // Show SQL in DB panel and execute
                dbRepl.appendOutput(`osi> ${sql}`, "repl-echo");
                const result = await dbQuery(sql);
                // Show results in DB panel
                dbRepl.appendTable(result.columns, result.rows);
                // One beat pause — the database work just happened
                await new Promise((r) => setTimeout(r, 250));
                // Cascade up arrows
                await connector.flashUp();
                // Show results in OSI panel, line by line
                await osiRepl.appendTable(result.columns, result.rows, true);
            }
            catch (err) {
                osiRepl.appendError(err instanceof Error ? err.message : String(err));
            }
            break;
        }
        case "error": {
            osiRepl.appendError(parsed.message);
            break;
        }
    }
}
async function handleSqlCommand(input, dbRepl) {
    const trimmed = input.trim().toLowerCase();
    if (trimmed === "help") {
        dbRepl.appendOutput(HELP_SQL);
        return;
    }
    try {
        const result = await dbQuery(input);
        dbRepl.appendTable(result.columns, result.rows);
    }
    catch (err) {
        dbRepl.appendError(err instanceof Error ? err.message : String(err));
    }
}
// Run on page load
main();

/**
 * REPL UI component: a terminal-like panel with input and scrolling output.
 */
/**
 * Create a REPL panel and append it to the container.
 */
export function createRepl(options) {
    const panel = document.createElement("div");
    panel.className = "repl-panel";
    // Label
    if (options.label) {
        const labelEl = document.createElement("div");
        labelEl.className = "repl-label";
        labelEl.textContent = options.label;
        panel.appendChild(labelEl);
    }
    // Output area
    const output = document.createElement("div");
    output.className = "repl-output";
    panel.appendChild(output);
    // Input line
    const inputLine = document.createElement("div");
    inputLine.className = "repl-input-line";
    const promptEl = document.createElement("span");
    promptEl.className = "repl-prompt";
    promptEl.textContent = options.prompt;
    inputLine.appendChild(promptEl);
    const input = document.createElement("input");
    input.type = "text";
    input.className = "repl-input";
    input.spellcheck = false;
    input.autocomplete = "off";
    inputLine.appendChild(input);
    panel.appendChild(inputLine);
    // Command history
    const history = [];
    let historyPos = -1;
    // Handle input
    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            const value = input.value;
            if (!value.trim())
                return;
            // Echo the command
            appendOutput(`${options.prompt}${value}`, "repl-echo");
            // Add to history
            history.unshift(value);
            historyPos = -1;
            input.value = "";
            options.onSubmit(value);
        }
        else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (historyPos < history.length - 1) {
                historyPos++;
                input.value = history[historyPos];
            }
        }
        else if (e.key === "ArrowDown") {
            e.preventDefault();
            if (historyPos > 0) {
                historyPos--;
                input.value = history[historyPos];
            }
            else {
                historyPos = -1;
                input.value = "";
            }
        }
    });
    function scrollToBottom() {
        output.scrollTop = output.scrollHeight;
    }
    function appendOutput(text, className) {
        const line = document.createElement("pre");
        line.className = "repl-line" + (className ? ` ${className}` : "");
        line.textContent = text;
        output.appendChild(line);
        scrollToBottom();
    }
    function appendError(text) {
        appendOutput(text, "repl-error");
    }
    function appendSQL(sql) {
        appendOutput(`→ ${sql}`, "repl-sql");
    }
    async function appendTable(columns, rows, animate = false) {
        const lines = formatTable(columns, rows).split("\n");
        if (!animate) {
            appendOutput(lines.join("\n"), "repl-table");
            return;
        }
        const LINE_DELAY_MS = 80;
        for (const line of lines) {
            appendOutput(line, "repl-table");
            await new Promise((r) => setTimeout(r, LINE_DELAY_MS));
        }
    }
    function clear() {
        output.innerHTML = "";
    }
    function focus() {
        input.focus();
    }
    function submit(command) {
        // Actually execute the command
        appendOutput(`${options.prompt}${command}`, "repl-echo");
        history.unshift(command);
        historyPos = -1;
        input.value = "";
        options.onSubmit(command);
    }
    function setInput(text) {
        input.value = text;
        input.focus();
    }
    // Submit button
    const submitBtn = document.createElement("button");
    submitBtn.className = "repl-submit-btn";
    submitBtn.textContent = "Run ⏎";
    submitBtn.title = "Run command (or press Enter)";
    submitBtn.addEventListener("click", () => {
        const value = input.value.trim();
        if (!value)
            return;
        submit(value);
    });
    inputLine.appendChild(submitBtn);
    return {
        appendOutput,
        appendError,
        appendTable,
        appendSQL,
        clear,
        focus,
        submit,
        setInput,
        element: panel,
    };
}
const ARROW_STEP_MS = 250;
/**
 * Create the connector element between two REPL panels.
 * Has three stacked arrows per direction that cascade sequentially.
 */
export function createConnector() {
    const connector = document.createElement("div");
    connector.className = "repl-connector";
    // Down arrows (SQL flowing to DB)
    const downGroup = document.createElement("div");
    downGroup.className = "connector-group connector-group-down";
    const downArrows = [];
    for (let i = 0; i < 3; i++) {
        const arrow = document.createElement("div");
        arrow.className = "connector-arrow connector-down";
        arrow.textContent = "↓ SQL";
        downGroup.appendChild(arrow);
        downArrows.push(arrow);
    }
    // Up arrows (results flowing back)
    const upGroup = document.createElement("div");
    upGroup.className = "connector-group connector-group-up";
    const upArrows = [];
    for (let i = 0; i < 3; i++) {
        const arrow = document.createElement("div");
        arrow.className = "connector-arrow connector-up";
        arrow.textContent = "↑ Results";
        upGroup.appendChild(arrow);
        upArrows.push(arrow);
    }
    connector.appendChild(downGroup);
    connector.appendChild(upGroup);
    function cascadeSequential(arrows) {
        return new Promise((resolve) => {
            arrows.forEach((arrow, i) => {
                setTimeout(() => {
                    arrow.classList.add("active");
                    setTimeout(() => arrow.classList.remove("active"), ARROW_STEP_MS);
                    if (i === arrows.length - 1) {
                        setTimeout(resolve, ARROW_STEP_MS);
                    }
                }, i * ARROW_STEP_MS);
            });
        });
    }
    function flashDown() {
        return cascadeSequential(downArrows);
    }
    function flashUp() {
        return cascadeSequential([...upArrows].reverse());
    }
    return { element: connector, flashDown, flashUp };
}
/**
 * Format columns and rows into a psql-style ASCII table.
 */
function formatTable(columns, rows) {
    if (columns.length === 0)
        return "(no columns)";
    if (rows.length === 0)
        return "(no rows)";
    // Calculate column widths
    const widths = columns.map((col) => col.length);
    for (const row of rows) {
        for (let i = 0; i < columns.length; i++) {
            const val = formatValue(row[i]);
            widths[i] = Math.max(widths[i], val.length);
        }
    }
    const pad = (str, width) => str.padEnd(width);
    const sep = widths.map((w) => "─".repeat(w + 2)).join("┼");
    const lines = [];
    // Header
    lines.push("┌" + widths.map((w) => "─".repeat(w + 2)).join("┬") + "┐");
    lines.push("│" +
        columns.map((col, i) => ` ${pad(col, widths[i])} `).join("│") +
        "│");
    lines.push("├" + sep + "┤");
    // Rows
    for (const row of rows) {
        lines.push("│" +
            columns
                .map((_, i) => ` ${pad(formatValue(row[i]), widths[i])} `)
                .join("│") +
            "│");
    }
    // Footer
    lines.push("└" + widths.map((w) => "─".repeat(w + 2)).join("┴") + "┘");
    lines.push(`(${rows.length} row${rows.length === 1 ? "" : "s"})`);
    return lines.join("\n");
}
function formatValue(val) {
    if (val === null || val === undefined)
        return "NULL";
    if (typeof val === "number") {
        // Format numbers nicely
        if (Number.isInteger(val))
            return val.toString();
        return val.toFixed(2);
    }
    return String(val);
}

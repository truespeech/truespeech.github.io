/**
 * REPL UI component: a terminal-like panel with input and scrolling output.
 */

export interface ReplOptions {
  prompt: string;
  onSubmit: (input: string) => void | Promise<void>;
  label?: string;
}

export interface RowDecoration {
  highlight?: "warn";
  note?: string;
}

export interface AppendTableOptions {
  animate?: boolean;
  // index-aligned with rows; rows without an entry render normally.
  decorations?: (RowDecoration | undefined)[];
}

export interface Repl {
  appendOutput(text: string, className?: string): void;
  appendError(text: string): void;
  appendTable(
    columns: string[],
    rows: (string | number | null)[][],
    options?: AppendTableOptions
  ): Promise<void>;
  appendSQL(sql: string): void;
  clear(): void;
  focus(): void;
  submit(command: string): void;
  setInput(text: string): void;
  element: HTMLElement;
}

/**
 * Create a REPL panel and append it to the container.
 */
export function createRepl(options: ReplOptions): Repl {
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
  const history: string[] = [];
  let historyPos = -1;

  // Handle input
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const value = input.value;
      if (!value.trim()) return;

      // Echo the command
      appendOutput(`${options.prompt}${value}`, "repl-echo");

      // Add to history
      history.unshift(value);
      historyPos = -1;

      input.value = "";
      options.onSubmit(value);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (historyPos < history.length - 1) {
        historyPos++;
        input.value = history[historyPos];
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyPos > 0) {
        historyPos--;
        input.value = history[historyPos];
      } else {
        historyPos = -1;
        input.value = "";
      }
    }
  });

  function scrollToBottom() {
    output.scrollTop = output.scrollHeight;
  }

  function appendOutput(text: string, className?: string): void {
    const line = document.createElement("pre");
    line.className = "repl-line" + (className ? ` ${className}` : "");
    line.textContent = text;
    output.appendChild(line);
    scrollToBottom();
  }

  function appendError(text: string): void {
    appendOutput(text, "repl-error");
  }

  function appendSQL(sql: string): void {
    appendOutput(`→ ${sql}`, "repl-sql");
  }

  async function appendTable(
    columns: string[],
    rows: (string | number | null)[][],
    options: AppendTableOptions = {}
  ): Promise<void> {
    const maxWidth = availableChars(output);
    const lines = formatTable(columns, rows, options.decorations, maxWidth);
    const LINE_DELAY_MS = 80;
    for (const line of lines) {
      appendTableLine(line);
      if (options.animate) {
        await new Promise((r) => setTimeout(r, LINE_DELAY_MS));
      }
    }
  }

  // Measure the actual rendered width of a monospace character once,
  // then derive how many chars fit across the output area. Using the
  // real measurement (rather than an approximation) keeps the table
  // sized to whatever font/size the panel is actually rendering at.
  let cachedCharWidth: number | null = null;
  function charWidth(): number {
    if (cachedCharWidth !== null) return cachedCharWidth;
    const probe = document.createElement("span");
    probe.style.fontFamily =
      '"SF Mono", "Menlo", "Consolas", "Liberation Mono", monospace';
    probe.style.fontSize = "13px";
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.whiteSpace = "pre";
    probe.textContent = "M".repeat(100);
    output.appendChild(probe);
    const w = probe.getBoundingClientRect().width / 100;
    output.removeChild(probe);
    if (w > 0) cachedCharWidth = w;
    return w > 0 ? w : 8;
  }

  function availableChars(container: HTMLElement): number {
    const style = getComputedStyle(container);
    const padL = parseFloat(style.paddingLeft) || 0;
    const padR = parseFloat(style.paddingRight) || 0;
    const usable = container.clientWidth - padL - padR;
    // Subtract a small safety margin for scroll-bar / sub-pixel rounding.
    return Math.max(40, Math.floor(usable / charWidth()) - 2);
  }

  // Render one structured table line as a <pre> containing text nodes
  // for plain segments and <span class="..."> for colored ones, so cell-
  // level coloring composes cleanly with the box-drawing.
  function appendTableLine(line: TableLine): void {
    const pre = document.createElement("pre");
    pre.className = "repl-line repl-table";
    for (const seg of line.segments) {
      if (seg.className) {
        const span = document.createElement("span");
        span.className = seg.className;
        span.textContent = seg.text;
        pre.appendChild(span);
      } else {
        pre.appendChild(document.createTextNode(seg.text));
      }
    }
    output.appendChild(pre);
    scrollToBottom();
  }

  function clear(): void {
    output.innerHTML = "";
  }

  function focus(): void {
    input.focus();
  }

  function submit(command: string): void {
    // Actually execute the command
    appendOutput(`${options.prompt}${command}`, "repl-echo");
    history.unshift(command);
    historyPos = -1;
    input.value = "";
    options.onSubmit(command);
  }

  function setInput(text: string): void {
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
    if (!value) return;
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
export function createConnector(): {
  element: HTMLElement;
  flashDown: () => Promise<void>;
  flashUp: () => Promise<void>;
} {
  const connector = document.createElement("div");
  connector.className = "repl-connector";

  // Down arrows (SQL flowing to DB)
  const downGroup = document.createElement("div");
  downGroup.className = "connector-group connector-group-down";
  const downArrows: HTMLElement[] = [];
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
  const upArrows: HTMLElement[] = [];
  for (let i = 0; i < 3; i++) {
    const arrow = document.createElement("div");
    arrow.className = "connector-arrow connector-up";
    arrow.textContent = "↑ Results";
    upGroup.appendChild(arrow);
    upArrows.push(arrow);
  }

  connector.appendChild(downGroup);
  connector.appendChild(upGroup);

  function cascadeSequential(arrows: HTMLElement[]): Promise<void> {
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

  function flashDown(): Promise<void> {
    return cascadeSequential(downArrows);
  }

  function flashUp(): Promise<void> {
    return cascadeSequential([...upArrows].reverse());
  }

  return { element: connector, flashDown, flashUp };
}

interface TextSegment {
  text: string;
  className?: string;
}

// A table line is a sequence of text segments concatenated to form one
// visible row. Most segments are plain text (borders, padding); some
// carry a className so the renderer can wrap them in a colored span —
// e.g. the metric cell + note cell on a reconciliation-matched row.
interface TableLine {
  segments: TextSegment[];
}

const plainLine = (text: string): TableLine => ({
  segments: [{ text }],
});

// Lower bound on the note column width when we have to shrink it to
// keep the table inside the panel — narrower than this and notes wrap
// to absurd shapes, so we'd rather let a really long note push past.
const MIN_NOTE_WIDTH = 30;

/**
 * Format columns and rows into a psql-style ASCII table. Returns the
 * structured line list so each row line can carry a per-row className
 * (e.g. for warning highlighting). If any decoration carries a `note`,
 * an extra "note" column is appended on the right; long note content
 * wraps within the cell, producing multi-line rows whose data cells pad
 * vertically to keep the box-drawing aligned.
 */
function formatTable(
  columns: string[],
  rows: (string | number | null)[][],
  decorations?: (RowDecoration | undefined)[],
  maxWidth?: number
): TableLine[] {
  if (columns.length === 0) return [plainLine("(no columns)")];
  if (rows.length === 0) return [plainLine("(no rows)")];

  const hasNotes = decorations?.some((d) => d?.note) ?? false;
  const cols = hasNotes ? [...columns, "note"] : columns;
  const augmentedRows: (string | number | null)[][] = hasNotes
    ? rows.map((row, i) => [...row, decorations?.[i]?.note ?? ""])
    : rows;

  const noteColIdx = hasNotes ? cols.length - 1 : -1;
  // The metric column is the last data column (just before the note
  // column when one exists). Used to colorize the impacted value on
  // reconciliation-matched rows.
  const metricColIdx = noteColIdx >= 0 ? noteColIdx - 1 : cols.length - 1;

  // Compute natural column widths.
  const widths = cols.map((col) => col.length);
  for (const row of augmentedRows) {
    for (let i = 0; i < cols.length; i++) {
      const val = formatValue(row[i]);
      widths[i] = Math.max(widths[i], val.length);
    }
  }

  // If the natural table would overflow the available panel width and
  // there's a note column, shrink only the note column to fit (down to
  // MIN_NOTE_WIDTH). Border/padding overhead is 2 chars per column for
  // the surrounding spaces, plus 1 for the leftmost border.
  if (noteColIdx >= 0 && maxWidth !== undefined) {
    const overhead = 2 * cols.length + 1;
    const naturalTotal =
      widths.reduce((a, b) => a + b, 0) + overhead;
    if (naturalTotal > maxWidth) {
      const shrinkBy = naturalTotal - maxWidth;
      widths[noteColIdx] = Math.max(
        MIN_NOTE_WIDTH,
        widths[noteColIdx] - shrinkBy
      );
    }
  }

  const pad = (str: string, width: number) => str.padEnd(width);
  const sep = widths.map((w) => "─".repeat(w + 2)).join("┼");

  const lines: TableLine[] = [];

  // Header
  lines.push(
    plainLine("┌" + widths.map((w) => "─".repeat(w + 2)).join("┬") + "┐")
  );
  lines.push(
    plainLine(
      "│" +
        cols.map((col, i) => ` ${pad(col, widths[i])} `).join("│") +
        "│"
    )
  );
  lines.push(plainLine("├" + sep + "┤"));

  // Rows — each cell becomes a list of wrapped lines (data cells: one
  // line; note cell: possibly several). The row height is the max,
  // and shorter cells pad with empty lines. When a row matches a
  // reconciliation entry, only the metric cell and note cell get the
  // warn color — the borders, padding, and other cells stay default.
  for (let i = 0; i < augmentedRows.length; i++) {
    const row = augmentedRows[i];
    const cellLines: string[][] = cols.map((_, j) => {
      const text = formatValue(row[j]);
      if (j === noteColIdx) return wrapText(text, widths[j]);
      return [text];
    });
    const height = Math.max(...cellLines.map((c) => c.length));
    const warn = decorations?.[i]?.highlight === "warn";

    for (let h = 0; h < height; h++) {
      const segments: TextSegment[] = [];
      for (let j = 0; j < cols.length; j++) {
        const cellText = ` ${pad(cellLines[j][h] ?? "", widths[j])} `;
        // Border before this cell.
        segments.push({ text: "│" });
        // Cell content — colored when the row is matched and the cell
        // is either the metric value or the note text.
        const colored = warn && (j === metricColIdx || j === noteColIdx);
        segments.push(
          colored
            ? { text: cellText, className: "repl-warn-cell" }
            : { text: cellText }
        );
      }
      segments.push({ text: "│" });
      lines.push({ segments });
    }
  }

  // Footer
  lines.push(
    plainLine("└" + widths.map((w) => "─".repeat(w + 2)).join("┴") + "┘")
  );
  lines.push(plainLine(`(${rows.length} row${rows.length === 1 ? "" : "s"})`));

  return lines;
}

// Word-wrap text to a maximum line width, breaking at spaces where
// possible and falling back to hard breaks for unbroken runs.
function wrapText(text: string, maxWidth: number): string[] {
  if (text.length <= maxWidth) return [text];
  const out: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    if (text.length - cursor <= maxWidth) {
      out.push(text.slice(cursor));
      break;
    }
    const window = text.slice(cursor, cursor + maxWidth + 1);
    const lastSpace = window.lastIndexOf(" ");
    if (lastSpace > 0) {
      out.push(text.slice(cursor, cursor + lastSpace).trimEnd());
      cursor += lastSpace + 1;
    } else {
      out.push(text.slice(cursor, cursor + maxWidth));
      cursor += maxWidth;
    }
  }
  return out;
}

function formatValue(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "number") {
    // Format numbers nicely
    if (Number.isInteger(val)) return val.toString();
    return val.toFixed(2);
  }
  return String(val);
}

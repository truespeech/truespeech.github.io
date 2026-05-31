// Standalone interactive cell for the tutorial page.
//
// Unlike the sandbox notebook (an append-only stack), each tutorial
// cell has a fixed position and a single result area that's
// overwritten on every run. The reader can edit the input freely and
// re-run as many times as they like.
//
// Each cell owns its own MemoryLexicon + TrueSpeech instance so cells
// can't interfere with one another. The DuckDB database and the OSI
// semantic layer are shared (both read-only) — only the lexicon is
// per-cell. A Reset button restores the cell's lexicon to its seed.
//
// Each cell carries a menu of canned inputs; for each, the reader sees
// the code and a plain-English explanation, with Copy (load into the
// editor) and Run (load + execute) buttons.

import { MemoryLexicon } from "../../sandbox/dist/runtime.js";
import type { TsRuntimeApi, TsInstance } from "../../sandbox/dist/runtime.js";
import { executeAndRenderInto, renderCellShell } from "../../sandbox/dist/render.js";

export interface CannedInput {
  code: string;
  explanation: string;
}

export interface StandaloneCellConfig {
  // The menu of example inputs shown above the editor.
  cannedInputs: CannedInput[];
  // REGISTER statements run once to seed this cell's lexicon. The
  // Reset button restores to exactly this state.
  seedStatements?: string[];
  // What to prefill the editor with (and auto-run on load). Defaults
  // to the first canned input's code.
  initialInput?: string;
}

export interface CellDeps {
  tsModule: TsRuntimeApi;
  // Shared, read-only across all cells.
  semanticLayer: any;
  dbExecute: (sql: string) => Promise<any>;
}

// Create a runtime instance with its own lexicon, seeded with the
// given REGISTER statements and snapshotted so the lexicon can be
// reset back to this state. The DB + semantic layer are shared.
export async function makeSeededTs(
  deps: CellDeps,
  seedStatements: string[] = []
): Promise<{ ts: TsInstance; lexicon: MemoryLexicon }> {
  const lexicon = new MemoryLexicon();
  const ts: TsInstance = new deps.tsModule.TrueSpeech({
    semanticLayer: deps.semanticLayer,
    database: { execute: deps.dbExecute },
    lexicon,
    timeLiteralYears: [2025, 2026],
  });
  for (const stmt of seedStatements) {
    await ts.execute(stmt);
  }
  lexicon.snapshotSeed();
  return { ts, lexicon };
}

// A frozen cell — looks like a notebook cell (input header + output)
// but is non-interactive. Run once at load against its own seeded
// lexicon so the output is real runtime output, never hand-authored.
export async function createFrozenCell(
  source: string,
  deps: CellDeps,
  seedStatements: string[] = []
): Promise<HTMLElement> {
  const { ts } = await makeSeededTs(deps, seedStatements);
  const { cell, output } = renderCellShell(source, "frozen");
  cell.classList.add("tut-frozen");
  await executeAndRenderInto(output, source, ts, deps.tsModule);
  return cell;
}

// Build, seed, and wire one interactive cell. Async because seeding
// the lexicon runs REGISTER statements through the runtime.
export async function createStandaloneCell(
  config: StandaloneCellConfig,
  deps: CellDeps
): Promise<HTMLElement> {
  const { ts, lexicon } = await makeSeededTs(deps, config.seedStatements ?? []);

  const cell = document.createElement("article");
  cell.className = "nb-cell tut-cell";

  // ----- Canned-input menu -----
  if (config.cannedInputs.length > 0) {
    const canned = document.createElement("div");
    canned.className = "tut-canned";
    const label = document.createElement("p");
    label.className = "tut-canned-label";
    label.textContent = "Try these";
    canned.appendChild(label);

    for (const item of config.cannedInputs) {
      canned.appendChild(renderCannedItem(item, runWith, loadInto));
    }
    cell.appendChild(canned);
  }

  // ----- Editable input band -----
  const inputBand = document.createElement("div");
  inputBand.className = "nb-cell-input tut-cell-input";

  const eyebrow = document.createElement("span");
  eyebrow.className = "nb-cell-label";
  eyebrow.textContent = "input";
  inputBand.appendChild(eyebrow);

  const editor = document.createElement("textarea");
  editor.className = "tut-cell-editor";
  editor.spellcheck = false;
  editor.autocapitalize = "off";
  editor.setAttribute("autocomplete", "off");
  editor.rows = 1;
  inputBand.appendChild(editor);

  const controls = document.createElement("div");
  controls.className = "tut-cell-controls";
  const runBtn = document.createElement("button");
  runBtn.className = "tut-btn tut-btn-run";
  runBtn.textContent = "Run";
  runBtn.addEventListener("click", () => void run());
  controls.appendChild(runBtn);

  const resetBtn = document.createElement("button");
  resetBtn.className = "tut-btn tut-btn-reset";
  resetBtn.textContent = "Reset lexicon";
  resetBtn.title = "Restore this cell's lexicon to its starting state";
  resetBtn.addEventListener("click", () => {
    lexicon.reset();
    output.innerHTML = "";
    const note = document.createElement("p");
    note.className = "nb-soft-note";
    note.textContent = "· Lexicon reset to its starting state.";
    output.appendChild(note);
  });
  controls.appendChild(resetBtn);

  inputBand.appendChild(controls);
  cell.appendChild(inputBand);

  // ----- Result area (overwritten on each run) -----
  const output = document.createElement("div");
  output.className = "nb-cell-output tut-cell-output";
  cell.appendChild(output);

  // ----- Editor behavior -----
  function autosize(): void {
    editor.style.height = "auto";
    editor.style.height = `${Math.min(editor.scrollHeight, 320)}px`;
  }
  editor.addEventListener("input", autosize);
  editor.addEventListener("keydown", (e) => {
    // Cmd/Ctrl+Enter runs; plain Enter inserts a newline (statements
    // are often multi-line, e.g. REGISTER).
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void run();
    }
  });

  function loadInto(code: string): void {
    editor.value = code;
    autosize();
    editor.focus();
  }

  async function run(): Promise<void> {
    await executeAndRenderInto(output, editor.value, ts, deps.tsModule);
  }

  async function runWith(code: string): Promise<void> {
    loadInto(code);
    await run();
  }

  // Prefill + auto-run the initial input so the cell shows a result on
  // load.
  const initial = config.initialInput ?? config.cannedInputs[0]?.code ?? "";
  editor.value = initial;
  autosize();
  if (initial.trim().length > 0) {
    await run();
  }

  return cell;
}

function renderCannedItem(
  item: CannedInput,
  runWith: (code: string) => void,
  loadInto: (code: string) => void
): HTMLElement {
  const row = document.createElement("div");
  row.className = "tut-canned-item";

  const code = document.createElement("pre");
  code.className = "tut-canned-code";
  code.textContent = item.code;
  row.appendChild(code);

  const desc = document.createElement("p");
  desc.className = "tut-canned-desc";
  desc.textContent = item.explanation;
  row.appendChild(desc);

  const btns = document.createElement("div");
  btns.className = "tut-canned-btns";

  const copyBtn = document.createElement("button");
  copyBtn.className = "tut-btn tut-btn-copy";
  copyBtn.textContent = "Copy";
  copyBtn.title = "Load into the editor (edit before running)";
  copyBtn.addEventListener("click", () => loadInto(item.code));
  btns.appendChild(copyBtn);

  const runBtn = document.createElement("button");
  runBtn.className = "tut-btn tut-btn-run";
  runBtn.textContent = "Run";
  runBtn.title = "Load into the editor and run";
  runBtn.addEventListener("click", () => runWith(item.code));
  btns.appendChild(runBtn);

  row.appendChild(btns);
  return row;
}

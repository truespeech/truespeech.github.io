// Notebook surface: a scrolling stack of cells with a single input
// field at the bottom. Each user submission becomes a cell — input
// header + structured HTML output — appended to the bottom of the
// stack. History stays visible so users can compare results.
//
// The notebook is dumb about what goes into cells: callers build the
// cell DOM themselves (via the cell renderers in main.ts that know the
// runtime types) and hand it to `addCell()`. The notebook handles
// input editing, history navigation, submit dispatch, scrolling,
// and Tab autocomplete (via an onComplete callback the caller wires
// to the runtime's complete() method).

// Minimal shape of a CompletionResult — kept local so this file
// doesn't need to import the runtime's type. Mirror of
// CompletionResult from the runtime's adapters.ts.
interface CompletionItem {
  text: string;
  kind:
    | "keyword"
    | "soft-keyword"
    | "metric"
    | "dimension"
    | "grain"
    | "operator"
    | "lexicon-entry"
    | "time-literal"
    | "string-literal"
    | "number-literal"
    | "identifier";
  hint?: string;
}

interface CompletionPayload {
  prefix: string;
  start: number;
  end: number;
  candidates: CompletionItem[];
}

export interface NotebookOptions {
  // Called with the user's input text when they hit Enter or click Run.
  // The callback is responsible for executing the source and calling
  // `addCell()` with the rendered output cell.
  onSubmit(source: string): void | Promise<void>;
  // Tab autocomplete handler. Given the current input text and cursor
  // position, return the set of valid next tokens. Typically wired to
  // the runtime's TrueSpeech.complete() method.
  onComplete?(source: string, position: number): Promise<CompletionPayload>;
  // Placeholder text in the input field.
  placeholder?: string;
}

export interface Notebook {
  element: HTMLElement;
  submit(source: string): void;
  setInput(text: string): void;
  addCell(element: HTMLElement): void;
  focus(): void;
}

export function createNotebook(opts: NotebookOptions): Notebook {
  const panel = document.createElement("div");
  panel.className = "notebook";

  const cells = document.createElement("div");
  cells.className = "notebook-cells";
  panel.appendChild(cells);

  const inputWrap = document.createElement("div");
  inputWrap.className = "notebook-input";

  const prompt = document.createElement("span");
  prompt.className = "notebook-prompt";
  prompt.textContent = "ts>";
  inputWrap.appendChild(prompt);

  // The input is wrapped so the autocomplete dropdown can be
  // absolutely positioned relative to the editable area.
  const editor = document.createElement("div");
  editor.className = "notebook-editor";

  // Use a textarea so multi-line REGISTER statements display naturally.
  // Auto-grow up to a max height; Enter submits, Shift+Enter inserts a
  // newline.
  const input = document.createElement("textarea");
  input.className = "notebook-input-field";
  input.rows = 1;
  input.spellcheck = false;
  input.autocomplete = "off";
  input.placeholder = opts.placeholder ?? "Enter a TS statement (press Tab to see what you can enter)";
  editor.appendChild(input);

  const dropdown = document.createElement("div");
  dropdown.className = "notebook-completions";
  dropdown.setAttribute("aria-hidden", "true");
  dropdown.style.display = "none";
  editor.appendChild(dropdown);

  inputWrap.appendChild(editor);

  const runBtn = document.createElement("button");
  runBtn.className = "notebook-run-btn";
  runBtn.textContent = "Run ⏎";
  runBtn.title = "Run statement (or press Enter)";
  inputWrap.appendChild(runBtn);

  panel.appendChild(inputWrap);

  // History of submitted statements; up/down arrows navigate it.
  const history: string[] = [];
  let historyPos = -1;

  // Cycle state for Tab autocomplete. Tab #1 with multiple candidates
  // shows the dropdown but doesn't insert. Tab #2 inserts the first
  // concrete candidate. Tab #3 replaces it with the second, and so on.
  // Any input change (typing, cursor move) clears the cycle.
  interface CycleState {
    // Concrete candidates (text !== "") in the order they were returned.
    candidates: CompletionItem[];
    // Where in `candidates` we last inserted, or -1 if we've only
    // shown the dropdown without inserting yet.
    index: number;
    // Source offset where the inserted text starts (i.e. the original
    // prefix's start position).
    replaceStart: number;
    // Length of the currently-inserted candidate text (or the original
    // prefix length if nothing's been inserted yet).
    replaceLength: number;
  }
  let cycle: CycleState | null = null;

  function autosize(): void {
    input.style.height = "auto";
    const max = 240;
    const next = Math.min(input.scrollHeight, max);
    input.style.height = `${next}px`;
  }

  function doSubmit(): void {
    const value = input.value;
    if (!value.trim()) return;
    history.unshift(value);
    historyPos = -1;
    input.value = "";
    autosize();
    closeDropdown();
    void opts.onSubmit(value);
  }

  function closeDropdown(): void {
    dropdown.style.display = "none";
    dropdown.innerHTML = "";
    dropdown.setAttribute("aria-hidden", "true");
    cycle = null;
  }

  function renderDropdown(
    items: CompletionItem[],
    highlightIdx: number,
    onSelect?: (item: CompletionItem) => void
  ): void {
    dropdown.innerHTML = "";
    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "notebook-completions-empty";
      empty.textContent = "(no completions)";
      dropdown.appendChild(empty);
      dropdown.style.display = "";
      dropdown.setAttribute("aria-hidden", "false");
      return;
    }
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const row = document.createElement("div");
      row.className = "notebook-completion";
      if (i === highlightIdx) row.classList.add("notebook-completion-active");

      const text = document.createElement("span");
      text.className = "notebook-completion-text";
      // Non-concrete kinds (empty text) render as italicized hint
      // labels — they're affordances, not insertable.
      if (item.text === "") {
        text.classList.add("notebook-completion-hint-text");
        text.textContent = item.hint ? `〈${item.hint}〉` : `〈${item.kind}〉`;
      } else {
        text.textContent = item.text;
      }
      row.appendChild(text);

      const kind = document.createElement("span");
      kind.className = "notebook-completion-kind";
      kind.textContent = item.kind;
      row.appendChild(kind);

      if (item.hint && item.text !== "") {
        const hint = document.createElement("span");
        hint.className = "notebook-completion-hint";
        hint.textContent = item.hint;
        row.appendChild(hint);
      }

      // Make concrete candidates clickable. mousedown.preventDefault
      // keeps the input focused so the input's blur handler doesn't
      // race the click and close the dropdown before it fires.
      if (item.text !== "" && onSelect) {
        row.classList.add("notebook-completion-clickable");
        row.addEventListener("mousedown", (e) => {
          e.preventDefault();
        });
        row.addEventListener("click", () => {
          onSelect(item);
        });
      }

      dropdown.appendChild(row);
    }
    dropdown.style.display = "";
    dropdown.setAttribute("aria-hidden", "false");
  }

  // Handle a click on a dropdown candidate. Uses the active cycle's
  // replaceStart/replaceLength to know what to replace, inserts, then
  // closes the dropdown. Cycle is cleared by closeDropdown so the
  // next Tab is fresh.
  function selectFromDropdown(item: CompletionItem): void {
    if (!cycle) return;
    insertCandidate(item, cycle);
    closeDropdown();
    input.focus({ preventScroll: true });
  }

  function insertCandidate(
    candidate: CompletionItem,
    state: CycleState
  ): void {
    const before = input.value.slice(0, state.replaceStart);
    const after = input.value.slice(state.replaceStart + state.replaceLength);
    const inserted = candidate.text;
    input.value = before + inserted + after;
    state.replaceLength = inserted.length;
    const newCursor = state.replaceStart + inserted.length;
    input.setSelectionRange(newCursor, newCursor);
    autosize();
  }

  async function handleTab(): Promise<void> {
    if (!opts.onComplete) return;

    // If we're already cycling, advance to the next candidate.
    if (cycle) {
      if (cycle.candidates.length === 0) return;
      cycle.index = (cycle.index + 1) % cycle.candidates.length;
      insertCandidate(cycle.candidates[cycle.index], cycle);
      renderDropdown(cycle.candidates, cycle.index, selectFromDropdown);
      return;
    }

    // Fresh Tab — call the completer.
    const pos = input.selectionStart ?? input.value.length;
    const result = await opts.onComplete(input.value, pos);

    const concrete = result.candidates.filter((c) => c.text !== "");
    const all = result.candidates;

    if (concrete.length === 0) {
      // Nothing to insert. Show the dropdown (which will list any
      // non-concrete hints) so the user knows Tab did something, but
      // don't start a cycle.
      if (all.length === 0) return;
      renderDropdown(all, -1);
      return;
    }

    if (concrete.length === 1) {
      // Single match — insert directly, no dropdown.
      const state: CycleState = {
        candidates: concrete,
        index: 0,
        replaceStart: result.start,
        replaceLength: result.end - result.start,
      };
      insertCandidate(concrete[0], state);
      // After inserting a single-match completion, leave no cycle —
      // user moves on. Don't store `cycle` so the next Tab is fresh.
      return;
    }

    // Multiple matches. Show the dropdown but don't insert yet.
    cycle = {
      candidates: concrete,
      index: -1,
      replaceStart: result.start,
      replaceLength: result.end - result.start,
    };
    renderDropdown(all, -1, selectFromDropdown);
  }

  input.addEventListener("input", () => {
    autosize();
    // Any text edit invalidates the cycle.
    closeDropdown();
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && !e.shiftKey) {
      e.preventDefault();
      void handleTab();
      return;
    }
    if (e.key === "Escape") {
      if (dropdown.style.display !== "none") {
        e.preventDefault();
        closeDropdown();
      }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSubmit();
      return;
    }
    if (e.key === "ArrowUp" && input.selectionStart === 0) {
      e.preventDefault();
      if (historyPos < history.length - 1) {
        historyPos++;
        input.value = history[historyPos];
        autosize();
        const end = input.value.length;
        input.setSelectionRange(end, end);
        closeDropdown();
      }
    } else if (e.key === "ArrowDown" && input.selectionStart === input.value.length) {
      e.preventDefault();
      if (historyPos > 0) {
        historyPos--;
        input.value = history[historyPos];
        autosize();
        const end = input.value.length;
        input.setSelectionRange(end, end);
        closeDropdown();
      } else {
        historyPos = -1;
        input.value = "";
        autosize();
        closeDropdown();
      }
    }
  });

  input.addEventListener("blur", () => {
    // Small delay so a future click on a dropdown row (if we ever add
    // mouse interaction) still registers before the dropdown closes.
    setTimeout(closeDropdown, 150);
  });

  runBtn.addEventListener("click", doSubmit);

  function addCell(element: HTMLElement): void {
    cells.appendChild(element);
    requestAnimationFrame(() => {
      element.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  }

  function submit(source: string): void {
    input.value = source;
    autosize();
    doSubmit();
  }

  function setInput(text: string): void {
    input.value = text;
    autosize();
    input.focus();
  }

  function focus(): void {
    input.focus({ preventScroll: true });
  }

  return { element: panel, submit, setInput, addCell, focus };
}

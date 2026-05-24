// Notebook surface: a scrolling stack of cells with a single input
// field at the bottom. Each user submission becomes a cell — input
// header + structured HTML output — appended to the bottom of the
// stack. History stays visible so users can compare results.
//
// The notebook is dumb about what goes into cells: callers build the
// cell DOM themselves (via the cell renderers in main.ts that know the
// runtime types) and hand it to `addCell()`. The notebook handles
// input editing, history navigation, submit dispatch, and scrolling.
export function createNotebook(opts) {
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
    // Use a textarea so multi-line REGISTER statements display naturally.
    // Auto-grow up to a max height; Enter submits, Shift+Enter inserts a
    // newline.
    const input = document.createElement("textarea");
    input.className = "notebook-input-field";
    input.rows = 1;
    input.spellcheck = false;
    input.autocomplete = "off";
    input.placeholder = opts.placeholder ?? "Enter a TS statement";
    inputWrap.appendChild(input);
    const runBtn = document.createElement("button");
    runBtn.className = "notebook-run-btn";
    runBtn.textContent = "Run ⏎";
    runBtn.title = "Run statement (or press Enter)";
    inputWrap.appendChild(runBtn);
    panel.appendChild(inputWrap);
    // History of submitted statements; up/down arrows in the input
    // navigate it (when the cursor is on the first/last line).
    const history = [];
    let historyPos = -1;
    function autosize() {
        input.style.height = "auto";
        const max = 240;
        const next = Math.min(input.scrollHeight, max);
        input.style.height = `${next}px`;
    }
    function doSubmit() {
        const value = input.value;
        if (!value.trim())
            return;
        history.unshift(value);
        historyPos = -1;
        input.value = "";
        autosize();
        void opts.onSubmit(value);
    }
    input.addEventListener("input", autosize);
    input.addEventListener("keydown", (e) => {
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
                // Cursor at end so user can edit.
                const end = input.value.length;
                input.setSelectionRange(end, end);
            }
        }
        else if (e.key === "ArrowDown" && input.selectionStart === input.value.length) {
            e.preventDefault();
            if (historyPos > 0) {
                historyPos--;
                input.value = history[historyPos];
                autosize();
                const end = input.value.length;
                input.setSelectionRange(end, end);
            }
            else {
                historyPos = -1;
                input.value = "";
                autosize();
            }
        }
    });
    runBtn.addEventListener("click", doSubmit);
    function addCell(element) {
        cells.appendChild(element);
        // Smoothly bring the new cell into view; users can still scroll up
        // through history afterwards.
        requestAnimationFrame(() => {
            element.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
    }
    function submit(source) {
        input.value = source;
        autosize();
        doSubmit();
    }
    function setInput(text) {
        input.value = text;
        autosize();
        input.focus();
    }
    function focus() {
        input.focus({ preventScroll: true });
    }
    return { element: panel, submit, setInput, addCell, focus };
}

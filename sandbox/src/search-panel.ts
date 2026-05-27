// Sandbox sample search — Fuse.js fuzzy search over the sample
// library, plus a "show N random samples" button for serendipitous
// exploration. Lives below the notebook (no vertical-real-estate
// pressure, so results render as a real table).
//
// Each result row shows the sample's code + description and exposes
// Run + Copy buttons. The hidden `keywords` field on each sample
// feeds Fuse but isn't rendered.

import type { Sample } from "./samples.js";

export interface SearchPanelOptions {
  samples: Sample[];
  onRun(code: string): void | Promise<void>;
  onCopy(code: string): void | Promise<void>;
  // How many random samples to surface when the user clicks the
  // random button. Defaults to 5.
  randomCount?: number;
}

export interface SearchPanel {
  element: HTMLElement;
}

interface FuseLike {
  search(query: string): { item: Sample }[];
}

interface FuseConstructor {
  new (list: Sample[], options: unknown): FuseLike;
}

const FUSE_URL = "https://cdn.jsdelivr.net/npm/fuse.js@7/dist/fuse.mjs";

export function createSearchPanel(opts: SearchPanelOptions): SearchPanel {
  const randomCount = opts.randomCount ?? 5;

  const panel = document.createElement("section");
  panel.className = "search-panel";

  const header = document.createElement("div");
  header.className = "search-panel-header";

  const title = document.createElement("h3");
  title.className = "search-panel-title";
  title.textContent = "Sample library";
  header.appendChild(title);

  const help = document.createElement("p");
  help.className = "search-panel-help";
  help.textContent = `Type to search across ${opts.samples.length} sample statements — by description, by code, or by keyword. Results appear below.`;
  header.appendChild(help);

  panel.appendChild(header);

  const controls = document.createElement("div");
  controls.className = "search-panel-controls";

  const input = document.createElement("input");
  input.type = "search";
  input.className = "search-panel-input";
  input.placeholder = "Search samples…";
  input.spellcheck = false;
  input.autocomplete = "off";
  controls.appendChild(input);

  const randomBtn = document.createElement("button");
  randomBtn.className = "search-panel-random-btn";
  randomBtn.textContent = `🎲 Show ${randomCount} random`;
  randomBtn.title = "Surface a random handful of samples";
  controls.appendChild(randomBtn);

  panel.appendChild(controls);

  const statusEl = document.createElement("div");
  statusEl.className = "search-panel-status";
  panel.appendChild(statusEl);

  const tableWrap = document.createElement("div");
  tableWrap.className = "search-panel-results";
  panel.appendChild(tableWrap);

  // Async load Fuse from CDN. Until it's loaded, the search input is
  // disabled and shows a loading message; the random button still
  // works (it doesn't depend on Fuse). Initial state shows nothing.
  let fuse: FuseLike | null = null;
  input.disabled = true;
  setStatus("Loading search index…");

  (async () => {
    try {
      const mod: { default: FuseConstructor } = await import(
        /* @vite-ignore */ FUSE_URL
      );
      fuse = new mod.default(opts.samples, {
        keys: [
          { name: "description", weight: 0.5 },
          { name: "keywords", weight: 0.4 },
          { name: "code", weight: 0.3 },
          { name: "group", weight: 0.2 },
        ],
        threshold: 0.4,
        minMatchCharLength: 2,
        ignoreLocation: true,
      });
      input.disabled = false;
      setStatus("");
      input.placeholder = `Search ${opts.samples.length} samples…`;
    } catch (err) {
      setStatus(`Failed to load search: ${err instanceof Error ? err.message : String(err)}`);
    }
  })();

  function setStatus(text: string): void {
    statusEl.textContent = text;
    statusEl.style.display = text ? "" : "none";
  }

  function renderResults(samples: Sample[]): void {
    tableWrap.innerHTML = "";
    if (samples.length === 0) {
      const empty = document.createElement("p");
      empty.className = "search-panel-empty";
      empty.textContent = "No matches.";
      tableWrap.appendChild(empty);
      return;
    }
    const table = document.createElement("table");
    table.className = "search-panel-table";
    const tbody = document.createElement("tbody");
    for (const s of samples) {
      tbody.appendChild(renderRow(s));
    }
    table.appendChild(tbody);
    tableWrap.appendChild(table);
  }

  function renderRow(s: Sample): HTMLElement {
    const tr = document.createElement("tr");
    tr.className = "search-result-row";

    const codeCell = document.createElement("td");
    codeCell.className = "search-result-code-cell";
    const groupTag = document.createElement("span");
    groupTag.className = "search-result-group";
    groupTag.textContent = s.group;
    codeCell.appendChild(groupTag);
    const code = document.createElement("pre");
    code.className = "search-result-code";
    code.textContent = s.code;
    codeCell.appendChild(code);
    tr.appendChild(codeCell);

    const descCell = document.createElement("td");
    descCell.className = "search-result-desc-cell";
    const desc = document.createElement("p");
    desc.className = "search-result-desc";
    desc.textContent = s.description;
    descCell.appendChild(desc);
    tr.appendChild(descCell);

    const actionsCell = document.createElement("td");
    actionsCell.className = "search-result-actions-cell";
    const runBtn = document.createElement("button");
    runBtn.className = "search-result-btn search-result-btn-run";
    runBtn.textContent = "▶ Run";
    runBtn.title = "Run in the notebook";
    runBtn.addEventListener("click", () => opts.onRun(s.code));
    actionsCell.appendChild(runBtn);
    const copyBtn = document.createElement("button");
    copyBtn.className = "search-result-btn search-result-btn-copy";
    copyBtn.textContent = "📋 Copy";
    copyBtn.title = "Copy to clipboard";
    copyBtn.addEventListener("click", async () => {
      await opts.onCopy(s.code);
      const orig = copyBtn.textContent;
      copyBtn.textContent = "✓ Copied";
      setTimeout(() => {
        copyBtn.textContent = orig;
      }, 1200);
    });
    actionsCell.appendChild(copyBtn);
    tr.appendChild(actionsCell);

    return tr;
  }

  function showRandom(): void {
    // Fisher-Yates pull of `randomCount` distinct samples.
    const pool = opts.samples.slice();
    const out: Sample[] = [];
    const n = Math.min(randomCount, pool.length);
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(Math.random() * pool.length);
      out.push(pool[idx]);
      pool.splice(idx, 1);
    }
    renderResults(out);
    setStatus(`${out.length} random sample${out.length === 1 ? "" : "s"}`);
  }

  function runSearch(): void {
    const q = input.value.trim();
    if (q.length === 0) {
      renderResults([]);
      setStatus("");
      return;
    }
    if (!fuse) return;
    const hits = fuse.search(q).map((r) => r.item);
    renderResults(hits);
    setStatus(`${hits.length} result${hits.length === 1 ? "" : "s"} for "${q}"`);
  }

  input.addEventListener("input", runSearch);
  randomBtn.addEventListener("click", showRandom);

  return { element: panel };
}

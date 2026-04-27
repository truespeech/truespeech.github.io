// Lexicon panel UI: a list of registered entries above the REPL.
//
// Renders the current lexicon as one row per entry with a delete button;
// has a Reset button in the header that restores the original seed.
// The panel is dumb — it asks `getEntries()` whenever `refresh()` is
// called, so callers just need to wire mutations to a refresh.

interface ResolvedRegion {
  timeStart: string;
  timeEnd: string;
  constraints: { dimension: string; operator: string; value: string | number | (string | number)[] }[];
}

interface Impact {
  metric: string;
  region: ResolvedRegion;
}

interface LexiconEntry {
  name: string;
  impacts: Impact[];
  description: string;
}

export interface LexiconPanelOptions {
  getEntries(): LexiconEntry[];
  onDelete(name: string): void | Promise<void>;
  onReset(): void | Promise<void>;
  renderRegion(region: ResolvedRegion): string;
}

export interface LexiconPanel {
  element: HTMLElement;
  refresh(): void;
}

export function createLexiconPanel(opts: LexiconPanelOptions): LexiconPanel {
  const panel = document.createElement("div");
  panel.className = "lexicon-panel";

  const header = document.createElement("div");
  header.className = "lexicon-header";

  const title = document.createElement("span");
  title.className = "lexicon-title";
  title.textContent = "Lexicon";
  header.appendChild(title);

  const count = document.createElement("span");
  count.className = "lexicon-count";
  header.appendChild(count);

  const spacer = document.createElement("span");
  spacer.style.flex = "1";
  header.appendChild(spacer);

  const resetBtn = document.createElement("button");
  resetBtn.className = "lexicon-reset";
  resetBtn.textContent = "Reset";
  resetBtn.title = "Restore the original seeded entries";
  resetBtn.addEventListener("click", async () => {
    await opts.onReset();
    refresh();
  });
  header.appendChild(resetBtn);

  panel.appendChild(header);

  const list = document.createElement("div");
  list.className = "lexicon-entries";
  panel.appendChild(list);

  function refresh(): void {
    const entries = opts.getEntries();
    list.innerHTML = "";

    count.textContent = entries.length === 1
      ? "1 entry"
      : `${entries.length} entries`;

    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "lexicon-empty";
      empty.textContent = "No entries. Try: REGISTER my_event IMPACTING total_sales OVER 2026-Q1 WITH \"…\"";
      list.appendChild(empty);
      return;
    }

    for (const entry of entries) {
      list.appendChild(renderEntry(entry, opts, refresh));
    }
  }

  refresh();

  return { element: panel, refresh };
}

function renderEntry(
  entry: LexiconEntry,
  opts: LexiconPanelOptions,
  refresh: () => void
): HTMLElement {
  const row = document.createElement("div");
  row.className = "lexicon-entry";

  const main = document.createElement("div");
  main.className = "lexicon-entry-main";

  const name = document.createElement("span");
  name.className = "lexicon-entry-name";
  name.textContent = entry.name;
  main.appendChild(name);

  for (const impact of entry.impacts) {
    const impactEl = document.createElement("span");
    impactEl.className = "lexicon-entry-impact";
    impactEl.textContent = `${impact.metric} · ${opts.renderRegion(impact.region)}`;
    main.appendChild(impactEl);
  }

  const desc = document.createElement("div");
  desc.className = "lexicon-entry-desc";
  desc.textContent = `"${entry.description}"`;

  const body = document.createElement("div");
  body.className = "lexicon-entry-body";
  body.appendChild(main);
  body.appendChild(desc);

  const del = document.createElement("button");
  del.className = "lexicon-entry-delete";
  del.textContent = "×";
  del.title = `Delete ${entry.name}`;
  del.addEventListener("click", async () => {
    await opts.onDelete(entry.name);
    refresh();
  });

  row.appendChild(body);
  row.appendChild(del);
  return row;
}

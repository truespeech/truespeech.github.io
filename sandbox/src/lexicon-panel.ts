// Lexicon panel UI: a list of registered entries above the REPL.
//
// Renders the current lexicon as one row per entry with a delete button;
// has a Reset button in the header that restores the original seed.
// The panel is dumb — it asks `getEntries()` whenever `refresh()` is
// called, so callers just need to wire mutations to a refresh.
//
// As of v0.2.0 the lexicon is multi-kind: `region` entries carry per-
// metric impact regions; `boundary` entries carry a single AT date plus
// optional categorical scope, and a flat list of impacted metrics.

interface ResolvedConstraint {
  dimension: string;
  operator: string;
  value: string | number | (string | number)[];
}

interface ResolvedRegion {
  timeStart: string;
  timeEnd: string;
  constraints: ResolvedConstraint[];
}

interface Impact {
  metric: string;
  region: ResolvedRegion;
}

interface RegionLexiconEntry {
  kind: "region";
  name: string;
  impacts: Impact[];
  description: string;
}

interface RegimeDescription {
  label: string;
  description: string;
}

interface BoundaryLexiconEntry {
  kind: "boundary";
  name: string;
  at: string;
  constraints: ResolvedConstraint[];
  metrics: string[];
  before: RegimeDescription;
  after: RegimeDescription;
  changeDescription?: string;
}

type LexiconEntry = RegionLexiconEntry | BoundaryLexiconEntry;

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
      empty.textContent = "No entries. Try: REGISTER region my_event IMPACTING total_sales OVER 2026-Q1 WITH \"…\"";
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
  row.className = `lexicon-entry lexicon-entry-${entry.kind}`;

  const main = document.createElement("div");
  main.className = "lexicon-entry-main";

  // Shared kind-tag styling: same pill class used in notebook cells,
  // so a "boundary" tag in the lexicon looks identical to a "boundary"
  // tag in a reconciliation block.
  const kindBadge = document.createElement("span");
  kindBadge.className = `kind-tag kind-${entry.kind}`;
  kindBadge.textContent = entry.kind;
  main.appendChild(kindBadge);

  const name = document.createElement("span");
  name.className = "lexicon-entry-name";
  name.textContent = entry.name;
  main.appendChild(name);

  if (entry.kind === "region") {
    for (const impact of entry.impacts) {
      const impactEl = document.createElement("span");
      impactEl.className = "lexicon-entry-impact";
      impactEl.textContent = `${impact.metric} · ${opts.renderRegion(impact.region)}`;
      main.appendChild(impactEl);
    }
  } else {
    const cutEl = document.createElement("span");
    cutEl.className = "lexicon-entry-impact";
    const scope = entry.constraints.length > 0
      ? ` · ${entry.constraints.map(renderConstraint).join(" AND ")}`
      : "";
    cutEl.textContent = `${entry.metrics.join(", ")} · cut at ${entry.at}${scope}`;
    main.appendChild(cutEl);
  }

  const body = document.createElement("div");
  body.className = "lexicon-entry-body";
  body.appendChild(main);

  if (entry.kind === "region") {
    const desc = document.createElement("div");
    desc.className = "lexicon-entry-desc";
    desc.textContent = `"${entry.description}"`;
    body.appendChild(desc);
  } else {
    body.appendChild(renderRegimeRow("before", entry.before));
    body.appendChild(renderRegimeRow("after", entry.after));
  }

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

function renderConstraint(c: ResolvedConstraint): string {
  if (Array.isArray(c.value)) {
    const op = c.operator === "not_in" ? "NOT IN" : "IN";
    return `${c.dimension} ${op} (${c.value.map(renderScalar).join(", ")})`;
  }
  return `${c.dimension} ${c.operator} ${renderScalar(c.value)}`;
}

function renderScalar(v: string | number): string {
  return typeof v === "string" ? `'${v}'` : String(v);
}

// Render one regime row (before/after) with the shared .regime-tag
// pill + prose. DOM-built so the user-authored label/description
// strings never go through innerHTML.
function renderRegimeRow(
  side: "before" | "after",
  regime: { label: string; description: string }
): HTMLElement {
  const row = document.createElement("div");
  row.className = "regime";

  const tag = document.createElement("span");
  tag.className = "regime-tag";
  tag.textContent = `${side} · ${regime.label}`;
  row.appendChild(tag);

  const desc = document.createElement("span");
  desc.className = "regime-desc";
  desc.textContent = regime.description;
  row.appendChild(desc);

  return row;
}

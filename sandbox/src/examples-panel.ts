// Canned-queries panel: grouped vertical list of pre-built TS statements
// with per-card Run + Copy actions, and a header alert that surfaces when
// the lexicon has drifted from its seed state (the cards' explanations
// describe behavior assuming the seed; if the user has mutated the
// lexicon, the descriptions may no longer match what they'll see).

export interface ExampleCard {
  // Short heading shown at the top of the card.
  label: string;
  // One-line explanation of what the query does and how it interacts
  // with the seed lexicon. Stays accurate as long as the lexicon hasn't
  // been mutated; the dirty-state alert at the top of the panel tells
  // the user when that assumption no longer holds.
  explanation: string;
  // The TS source to populate (Copy) or run (Run).
  command: string;
}

export interface ExampleGroup {
  title: string;
  cards: ExampleCard[];
}

export interface ExamplesPanelOptions {
  groups: ExampleGroup[];
  // Whether the lexicon has been mutated from its seed state. Called on
  // every refresh() so the panel can show / hide the dirty alert and
  // apply the muted styling to cards.
  isDirty(): boolean;
  // Invoked when the user clicks Reset in the dirty alert. The callback
  // should restore the seed lexicon and trigger a refresh of any
  // dependent panels.
  onReset(): void | Promise<void>;
  // Run a command: scroll to the REPL, paste the command, submit it.
  onRun(command: string): void | Promise<void>;
  // Copy a command to the clipboard.
  onCopy(command: string): void | Promise<void>;
}

export interface ExamplesPanel {
  element: HTMLElement;
  refresh(): void;
}

export function createExamplesPanel(opts: ExamplesPanelOptions): ExamplesPanel {
  const panel = document.createElement("div");
  panel.className = "examples-panel";

  // Dirty alert sits at the top; rendered conditionally on every refresh.
  const alertSlot = document.createElement("div");
  alertSlot.className = "examples-alert-slot";
  panel.appendChild(alertSlot);

  // Groups container — built once, never rebuilt (the cards' contents
  // are static; only the muted-state styling toggles per refresh).
  const groupsEl = document.createElement("div");
  groupsEl.className = "examples-groups";
  panel.appendChild(groupsEl);

  for (const group of opts.groups) {
    const groupEl = document.createElement("section");
    groupEl.className = "examples-group";

    const heading = document.createElement("h3");
    heading.className = "examples-group-title";
    heading.textContent = group.title;
    groupEl.appendChild(heading);

    for (const card of group.cards) {
      groupEl.appendChild(renderCard(card, opts));
    }
    groupsEl.appendChild(groupEl);
  }

  function refresh(): void {
    alertSlot.innerHTML = "";
    const dirty = opts.isDirty();
    if (dirty) {
      alertSlot.appendChild(renderAlert(opts));
      panel.classList.add("is-dirty");
    } else {
      panel.classList.remove("is-dirty");
    }
  }

  refresh();

  return { element: panel, refresh };
}

function renderCard(
  card: ExampleCard,
  opts: ExamplesPanelOptions
): HTMLElement {
  const cardEl = document.createElement("div");
  cardEl.className = "example-card";

  const header = document.createElement("div");
  header.className = "example-card-header";

  const labelEl = document.createElement("span");
  labelEl.className = "example-card-label";
  labelEl.textContent = card.label;
  header.appendChild(labelEl);

  const actions = document.createElement("div");
  actions.className = "example-card-actions";

  const runBtn = document.createElement("button");
  runBtn.className = "example-card-btn example-card-btn-run";
  runBtn.title = "Run in the console";
  runBtn.textContent = "▶ Run";
  runBtn.addEventListener("click", () => opts.onRun(card.command));
  actions.appendChild(runBtn);

  const copyBtn = document.createElement("button");
  copyBtn.className = "example-card-btn example-card-btn-copy";
  copyBtn.title = "Copy to clipboard";
  copyBtn.textContent = "📋 Copy";
  copyBtn.addEventListener("click", async () => {
    await opts.onCopy(card.command);
    // Brief affordance — flip the label so the click registers visibly.
    const original = copyBtn.textContent;
    copyBtn.textContent = "✓ Copied";
    setTimeout(() => {
      copyBtn.textContent = original;
    }, 1200);
  });
  actions.appendChild(copyBtn);

  header.appendChild(actions);
  cardEl.appendChild(header);

  const explanation = document.createElement("p");
  explanation.className = "example-card-explanation";
  explanation.textContent = card.explanation;
  cardEl.appendChild(explanation);

  const command = document.createElement("pre");
  command.className = "example-card-command";
  command.textContent = card.command;
  cardEl.appendChild(command);

  return cardEl;
}

function renderAlert(opts: ExamplesPanelOptions): HTMLElement {
  const alert = document.createElement("div");
  alert.className = "examples-alert";

  const msg = document.createElement("span");
  msg.className = "examples-alert-msg";
  msg.textContent =
    "Lexicon has been modified from its seed state. The descriptions below assume the seed entries — they may not describe what you'll see.";
  alert.appendChild(msg);

  const resetBtn = document.createElement("button");
  resetBtn.className = "examples-alert-reset";
  resetBtn.textContent = "Reset lexicon";
  resetBtn.addEventListener("click", () => opts.onReset());
  alert.appendChild(resetBtn);

  return alert;
}

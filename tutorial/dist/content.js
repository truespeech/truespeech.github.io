// Tutorial content outline.
//
// The page is a flat list of blocks rendered top-to-bottom into
// #tutorial. A block is either prose/headings (html), a frozen
// (non-interactive, run-once) cell, or an interactive standalone cell
// with a menu of canned inputs. main.ts walks this list and builds the
// DOM; the per-cell runtime/lexicon wiring lives in standalone-cell.ts.
// ---------------------------------------------------------------------------
// Seed lexicons (REGISTER statements run once to set up a cell).
// ---------------------------------------------------------------------------
const SEED_REGIONS = [
    `REGISTER region q1_data_quality_issue
     IMPACTING total_sales OVER 2026-02-15 to 2026-02-20
     WITH "Order amounts undercounted by ~12% during a backfill window — investigate before reporting Q1 totals."`,
    `REGISTER region northeast_fulfillment_outage
     IMPACTING total_sales OVER 2026-03-08 to 2026-03-12 AND region = 'northeast'
     WITH "Northeast distribution center went offline; orders deferred or lost during this window."`,
];
const SEED_AOV_BOUNDARY = [
    `REGISTER boundary aov_definition_change
     AT 2026-01-01
     IMPACTING average_order_value
     BEFORE "v1 (refund-inclusive)" "AOV included refund-adjusted amounts; values are systematically higher than the post-cut figure."
     AFTER  "v2 (refund-excluding)" "AOV excludes refunds; closer to the gross-of-refunds figure that the finance team reports."`,
];
const SEED_ALL = [
    ...SEED_REGIONS,
    ...SEED_AOV_BOUNDARY,
    `REGISTER boundary enterprise_price_reset
     AT 2026-04-01 AND product_tier = 'enterprise'
     IMPACTING total_sales
     BEFORE "v1 enterprise pricing" "Enterprise tier list prices set during the 2025 reset; promo discounts were active."
     AFTER  "v2 enterprise pricing" "Enterprise tier prices were lifted ~20%, and all promo discounts retired on Apr 1."`,
];
// ---------------------------------------------------------------------------
// The outline.
// ---------------------------------------------------------------------------
export const OUTLINE = [
    // ===================== CORE CONCEPTS =====================
    {
        kind: "html",
        html: `
      <section class="tut-section">
        <h2>Core concepts</h2>
        <p>Four ideas carry the whole language. The cells below are frozen snapshots — read them, don't run them. You'll get hands-on in the next section.</p>
      </section>`,
    },
    {
        kind: "html",
        html: `
      <div class="tut-concept">
        <h3>1 · A query language for your semantic layer</h3>
        <p>A <code>COMPUTE</code> statement names a metric and scopes it. It reads like SQL but talks to a <em>semantic layer</em> — so you query business metrics (<code>total_sales</code>) and dimensions (<code>region</code>), not raw tables and joins. <code>GROUP BY</code>, <code>ORDER BY</code>, and <code>LIMIT</code> work as you'd expect.</p>
      </div>`,
    },
    { kind: "frozen", source: "COMPUTE total_sales OVER 2026-Q1 GROUP BY region" },
    {
        kind: "html",
        html: `
      <div class="tut-concept">
        <h3>2 · A mini-language for time</h3>
        <p>Every metric has a primary time axis, and the <code>OVER</code> clause speaks a compact calendar language for it: a year (<code>2026</code>), quarter (<code>2026-Q1</code>), month (<code>2026-02</code>), or day (<code>2026-02-15</code>); a range (<code>2025-Q4 to 2026-Q1</code>); open-ended bounds (<code>since 2026-01</code>, <code>until 2026-Q2</code>); or <code>all time</code>. See the <a href="reference.html#over-clause">reference</a> for the full grammar.</p>
      </div>`,
    },
    { kind: "frozen", source: "COMPUTE total_sales OVER 2025-Q4 to 2026-Q1" },
    {
        kind: "html",
        html: `
      <div class="tut-concept">
        <h3>3 · A lexicon of what you know</h3>
        <p>The <strong>lexicon</strong> captures things an analyst knows about the data that the data can't say for itself. It holds two kinds of entries. A <strong>region</strong> is a patch of suspect or special data — a bot attack, an outage, a backfill window. A <strong>boundary</strong> is a cut in time where a metric's meaning changed — a redefinition, a pricing reset — so values on either side aren't comparable.</p>
      </div>`,
    },
    { kind: "frozen", source: "SHOW LEXICON", seed: SEED_ALL },
    {
        kind: "html",
        html: `
      <div class="tut-concept">
        <h3>4 · Context shows up in your results</h3>
        <p>You don't have to remember the lexicon. When you run a query, the runtime checks which entries apply and folds them into the result — a note on each affected row, and the relevant entries listed below. Here a query spans the AOV definition change, so each quarter is tagged with the regime it belongs to.</p>
      </div>`,
    },
    {
        kind: "frozen",
        source: "COMPUTE average_order_value OVER 2025-Q4 to 2026-Q1 GROUP BY quarter",
        seed: SEED_AOV_BOUNDARY,
    },
    // ===================== LANGUAGE FEATURES =====================
    {
        kind: "html",
        html: `
      <section class="tut-section">
        <h2>Language features</h2>
        <p>Now the hands-on part. Each cell below is live and independent — edit the input and run it as many times as you like, or pick one of the canned inputs. Each cell keeps its own lexicon, so you can't break one cell by experimenting in another; the <strong>Reset lexicon</strong> button restores a cell to its starting state.</p>
      </section>`,
    },
    {
        kind: "html",
        html: `
      <div class="tut-concept">
        <h3>The data: NorthStar Goods</h3>
        <p><strong>NorthStar Goods</strong> is a fictional mid-size US retailer. The dataset is ~200 orders spanning January 2025 through April 2026, across four regions (northeast, southeast, midwest, west) and two product tiers (consumer, enterprise). The semantic layer exposes two metrics — <code>total_sales</code> and <code>average_order_value</code> — both keyed on order date. Here's the shape:</p>
      </div>`,
    },
    { kind: "frozen", source: "SHOW SCHEMA" },
    // ----- Cell 1: COMPUTE basics -----
    {
        kind: "html",
        html: `
      <div class="tut-concept">
        <h3>Querying with COMPUTE</h3>
        <p>Start with an empty lexicon — just querying. Work through these to see scoping, grouping, constraints, and ordering. Edit any of them and re-run.</p>
      </div>`,
    },
    {
        kind: "interactive",
        config: {
            seedStatements: [],
            cannedInputs: [
                {
                    code: "COMPUTE total_sales OVER all time",
                    explanation: "The simplest query: one metric, no time filter. OVER is always required — all time means “don't scope the time axis.”",
                },
                {
                    code: "COMPUTE total_sales OVER 2026-Q1",
                    explanation: "Scope to a calendar period. Try 2026, 2026-02, or a single day like 2026-02-15.",
                },
                {
                    code: "COMPUTE total_sales OVER 2026 GROUP BY region",
                    explanation: "Break the metric out by a dimension — one row per region for 2026.",
                },
                {
                    code: "COMPUTE average_order_value OVER 2026 AND product_tier = 'enterprise'",
                    explanation: "Add a constraint with AND — here, average only enterprise-tier orders.",
                },
                {
                    code: "COMPUTE total_sales OVER 2026 GROUP BY region ORDER BY total_sales DESC LIMIT 3",
                    explanation: "Sort and cap the rows: the top three regions by sales in 2026.",
                },
            ],
        },
    },
    // ----- Cell 2: Regions, reading -----
    {
        kind: "html",
        html: `
      <div class="tut-concept">
        <h3>Regions in your results</h3>
        <p>This cell's lexicon is preloaded with two regions: a Q1 data-quality window on <code>total_sales</code>, and a northeast fulfillment outage scoped to <code>region = 'northeast'</code>. Run queries that overlap them and watch the context appear; run one that doesn't and it stays clean. <a href="reference.html#register-region">Region reference →</a></p>
      </div>`,
    },
    {
        kind: "interactive",
        config: {
            seedStatements: SEED_REGIONS,
            cannedInputs: [
                {
                    code: "COMPUTE total_sales OVER 2026-02",
                    explanation: "February overlaps the q1_data_quality_issue region. Note the “note” column and the “Lexicon entries in scope” table below the result.",
                },
                {
                    code: "CHECK total_sales OVER 2026-02",
                    explanation: "CHECK asks the lexicon directly which entries apply — no metric is computed.",
                },
                {
                    code: "COMPUTE total_sales OVER 2026-03 AND region = 'northeast'",
                    explanation: "The outage region is scoped to region = 'northeast'. It triggers here; change the region and it won't.",
                },
                {
                    code: "COMPUTE total_sales OVER 2025-Q3",
                    explanation: "Nothing in the lexicon overlaps Q3 2025 — a clean result, no note column.",
                },
            ],
        },
    },
    // ----- Cell 3: REGISTER regions -----
    {
        kind: "html",
        html: `
      <div class="tut-concept">
        <h3>Writing regions with REGISTER</h3>
        <p>This cell starts with an empty lexicon. Register a region yourself, then query against it. A region names the metric it affects, the time window, an optional dimension scope, and a human-readable note.</p>
      </div>`,
    },
    {
        kind: "interactive",
        config: {
            seedStatements: [],
            initialInput: 'REGISTER region holiday_promo_2025\n  IMPACTING total_sales OVER 2025-11-25 to 2025-11-30\n  WITH "Black Friday promotion inflated sales well above the baseline trend."',
            cannedInputs: [
                {
                    code: 'REGISTER region holiday_promo_2025\n  IMPACTING total_sales OVER 2025-11-25 to 2025-11-30\n  WITH "Black Friday promotion inflated sales well above the baseline trend."',
                    explanation: "Define a region: the metric, the time window (a day or a range), and a note.",
                },
                {
                    code: "COMPUTE total_sales OVER 2025-11 GROUP BY week",
                    explanation: "Query November 2025 — the region you just registered surfaces against the weeks it overlaps.",
                },
                {
                    code: "CHECK total_sales OVER 2025-Q4",
                    explanation: "Confirm the entry is in the lexicon and applies to Q4.",
                },
                {
                    code: "REGISTER region west_coast_heatwave\n  IMPACTING total_sales OVER 2025-07-01 to 2025-07-14 AND region = 'west'\n  WITH \"Heatwave drove unusual demand in the west region.\"",
                    explanation: "Scope a region to specific dimension values with AND — only the west region in the window is flagged.",
                },
                {
                    code: "SHOW LEXICON",
                    explanation: "See everything you've registered in this cell. Reset lexicon clears it back to empty.",
                },
            ],
        },
    },
    // ----- Cell 4: Boundaries, reading -----
    {
        kind: "html",
        html: `
      <div class="tut-concept">
        <h3>Boundaries in your results</h3>
        <p>This cell's lexicon holds one boundary: the AOV definition changed on Jan 1, 2026. A boundary's whole job is to catch queries that mix incomparable regimes. Watch how the same data is flagged differently depending on whether a row spans the cut. <a href="reference.html#register-boundary">Boundary reference →</a></p>
      </div>`,
    },
    {
        kind: "interactive",
        config: {
            seedStatements: SEED_AOV_BOUNDARY,
            cannedInputs: [
                {
                    code: "COMPUTE average_order_value OVER 2025-Q4 to 2026-Q1",
                    explanation: "This range straddles the cut. The single value blends two definitions, so it's flagged red — don't read it as one number.",
                },
                {
                    code: "COMPUTE average_order_value OVER 2025-Q4 to 2026-Q1 GROUP BY quarter",
                    explanation: "Same range, split by quarter. Now each row sits cleanly on one side — Q4 tagged (before), Q1 (after) — amber, not red.",
                },
                {
                    code: "COMPUTE average_order_value OVER 2025-Q3",
                    explanation: "Entirely before the cut: fine in isolation, but you get a historical-context footer that it predates the current definition.",
                },
                {
                    code: "CHECK average_order_value OVER 2025-Q4 to 2026-Q1",
                    explanation: "Ask the lexicon directly which boundaries this query crosses.",
                },
            ],
        },
    },
    // ----- Cell 5: REGISTER boundaries + mixed -----
    {
        kind: "html",
        html: `
      <div class="tut-concept">
        <h3>Writing boundaries — and mixing both kinds</h3>
        <p>Register a boundary yourself, then add a region alongside it. The lexicon holds both kinds at once, and a single query can surface whichever entries touch its rows.</p>
      </div>`,
    },
    {
        kind: "interactive",
        config: {
            seedStatements: [],
            initialInput: 'REGISTER boundary loyalty_program_launch\n  AT 2025-09-01\n  IMPACTING average_order_value\n  BEFORE "pre-loyalty" "Order values before the loyalty program; no points-driven basket inflation."\n  AFTER "post-loyalty" "Loyalty points encouraged larger baskets; AOV stepped up."',
            cannedInputs: [
                {
                    code: 'REGISTER boundary loyalty_program_launch\n  AT 2025-09-01\n  IMPACTING average_order_value\n  BEFORE "pre-loyalty" "Order values before the loyalty program; no points-driven basket inflation."\n  AFTER "post-loyalty" "Loyalty points encouraged larger baskets; AOV stepped up."',
                    explanation: "Define a boundary: a cut at an instant, the metric it affects, and a description of each side.",
                },
                {
                    code: "COMPUTE average_order_value OVER 2025-Q3 to 2025-Q4",
                    explanation: "Query across Sep 1, 2025 — the boundary you just registered flags the straddle.",
                },
                {
                    code: 'REGISTER region promo_glitch\n  IMPACTING average_order_value OVER 2025-10-10 to 2025-10-12\n  WITH "A pricing glitch briefly discounted orders; AOV dipped."',
                    explanation: "Add a region too — now the lexicon holds a boundary and a region affecting the same metric.",
                },
                {
                    code: "COMPUTE average_order_value OVER 2025-Q4 GROUP BY month",
                    explanation: "A mixed query: the boundary and the region can each surface against the rows they touch.",
                },
                {
                    code: "SHOW LEXICON",
                    explanation: "Everything registered in this cell — a boundary and a region, side by side.",
                },
            ],
        },
    },
    // ===================== CLOSING =====================
    {
        kind: "html",
        html: `
      <section class="tut-section tut-closing">
        <h2>Where to next</h2>
        <p>That's the language. Keep experimenting in the <a href="sandbox.html">sandbox</a> — a free-form notebook over the same NorthStar data — or look up the exact grammar and semantics in the <a href="reference.html">reference</a>.</p>
      </section>`,
    },
];

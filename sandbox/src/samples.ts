// Sample TS statements for the Sandbox's search-based exploration.
// Each entry carries:
//   - code: the actual TS source the user will paste / run
//   - description: a natural-language summary of what it does and
//                  what the user will see (assuming the seed lexicon)
//   - keywords: hidden search terms — synonyms, mental-model words,
//               and construct labels the user might type
//   - group: a coarse grouping for display in the random-samples view
//
// The visible columns in the search results are `code` and `description`.
// `keywords` and `group` feed Fuse.js but aren't rendered.

export interface Sample {
  code: string;
  description: string;
  keywords: string[];
  group: SampleGroup;
}

export type SampleGroup =
  | "Basic compute"
  | "Region exploration"
  | "Boundary exploration"
  | "Disambiguation"
  | "Lexicon lookup"
  | "Lexicon registration"
  | "Introspection";

export const SAMPLES: Sample[] = [
  // ===== Basic compute =====
  {
    group: "Basic compute",
    code: "COMPUTE total_sales OVER 2026-04",
    description: "Total sales for April 2026 — clean baseline, no lexicon entries touch this slice.",
    keywords: ["baseline", "clean", "total", "monthly", "april", "no hits"],
  },
  {
    group: "Basic compute",
    code: "COMPUTE total_sales OVER 2026-Q1 GROUP BY month",
    description: "Monthly sales trend across Q1 2026. Each January/February/March row is one bucket.",
    keywords: ["monthly", "trend", "group by", "bucket", "time series", "quarter"],
  },
  {
    group: "Basic compute",
    code: "COMPUTE average_order_value OVER 2025 GROUP BY product_tier",
    description: "Compare 2025 AOV across product tiers — enterprise vs. consumer side by side.",
    keywords: ["aov", "tier", "enterprise", "consumer", "segment", "compare", "categorical"],
  },
  {
    group: "Basic compute",
    code: "COMPUTE total_sales OVER 2025 GROUP BY region",
    description: "2025 sales broken out by region — one row per geographic territory.",
    keywords: ["region", "geographic", "territory", "split", "annual"],
  },
  {
    group: "Basic compute",
    code: "COMPUTE total_sales OVER 2026-01-15 to 2026-02-10",
    description: "An explicit day-to-day range crossing month boundaries — useful for ad-hoc windows.",
    keywords: ["range", "explicit", "day", "window", "ad hoc", "to"],
  },
  {
    group: "Basic compute",
    code: "COMPUTE total_sales OVER 2025-Q4 to 2026-Q1 GROUP BY quarter ORDER BY quarter",
    description: "Quarter-over-quarter sales, sorted chronologically. Useful for seeing trends without month-level noise.",
    keywords: ["quarter", "ordering", "sort", "qoq", "trend", "year over year"],
  },
  {
    group: "Basic compute",
    code: "COMPUTE total_sales OVER all time AND region = 'northeast'",
    description: "All-time northeast totals — the `all time` keyword + a categorical pin.",
    keywords: ["all time", "unbounded", "northeast", "pin", "constraint", "and"],
  },

  // ===== Region exploration =====
  {
    group: "Region exploration",
    code: "COMPUTE total_sales OVER 2026-02",
    description: "February 2026 sales. Overlaps the `q1_data_quality_issue` region (Feb 15-20 backfill window) → row flagged amber. Also pre-cut for the enterprise boundary → historical footer.",
    keywords: ["region", "anomaly", "data quality", "backfill", "february", "warn"],
  },
  {
    group: "Region exploration",
    code: "COMPUTE total_sales OVER 2026-03 GROUP BY region",
    description: "March 2026 sales by region. Only the northeast row touches the `northeast_fulfillment_outage` region (Mar 8-12) → that row flags amber.",
    keywords: ["region", "outage", "northeast", "march", "fulfillment", "warn", "scope"],
  },
  {
    group: "Region exploration",
    code: "COMPUTE total_sales OVER 2026",
    description: "Whole-year 2026 — single row picks up BOTH regions (warns) AND straddles the enterprise boundary (red error). Useful for seeing every match type at once.",
    keywords: ["wide", "annual", "all matches", "everything", "comprehensive", "error", "warn"],
  },
  {
    group: "Region exploration",
    code: "COMPUTE total_sales OVER 2026-Q1 GROUP BY month",
    description: "Monthly breakout of Q1 2026 — the February row picks up the Q1 data quality region; January and March are clean (for this region).",
    keywords: ["region", "monthly", "anomaly", "quarter", "breakout", "isolated"],
  },
  {
    group: "Region exploration",
    code: "COMPUTE total_sales OVER 2026-02-15 to 2026-03-15",
    description: "A cross-month window that overlaps both the Q1 anomaly AND the March NE outage — two region warns on the single result row.",
    keywords: ["range", "multi region", "two warns", "overlap", "cross month"],
  },
  {
    group: "Region exploration",
    code: "COMPUTE total_sales OVER 2026-03 AND region NOT IN ('northeast')",
    description: "March excluding the northeast region — the outage no longer applies because the row's data doesn't include the northeast.",
    keywords: ["exclude", "not in", "filter", "scope out", "constraint", "region"],
  },

  // ===== Boundary exploration =====
  {
    group: "Boundary exploration",
    code: "COMPUTE average_order_value OVER 2025-Q4 to 2026-Q1",
    description: "Single row spanning the Jan 1 AOV cut — the value mixes pre-cut and post-cut data → red error. The number is incoherent.",
    keywords: ["boundary", "straddle", "error", "aov", "cut", "regime", "mix", "incoherent"],
  },
  {
    group: "Boundary exploration",
    code: "COMPUTE average_order_value OVER 2025-Q4 to 2026-Q1 GROUP BY quarter",
    description: "Same time span, GROUP BY quarter — two rows, neither straddles. Each carries its regime label inline (before/after).",
    keywords: ["boundary", "disambiguate", "regime labels", "warn", "quarter", "split", "amber"],
  },
  {
    group: "Boundary exploration",
    code: "COMPUTE average_order_value OVER 2025-Q4 to 2026-Q1 GROUP BY month",
    description: "Finer-grain version of the regime-label example — six monthly rows, each cleanly in one regime, each carrying its label.",
    keywords: ["boundary", "monthly", "regime", "warn", "fine grain", "label"],
  },
  {
    group: "Boundary exploration",
    code: "COMPUTE average_order_value OVER 2025",
    description: "AOV for all of 2025 — entirely pre-cut for the AOV definition change. No row flags; the result carries an informational historical footer describing the pre-2026 regime.",
    keywords: ["historical", "boundary", "pre cut", "footer", "soft", "informational", "before"],
  },
  {
    group: "Boundary exploration",
    code: "COMPUTE total_sales OVER 2026-Q1 to 2026-Q2 AND product_tier = 'enterprise'",
    description: "Query pins enterprise and spans April 1 — straddling-row error from the scoped boundary. Also picks up the Q1 region warns.",
    keywords: ["enterprise", "boundary", "scoped", "straddle", "error", "pricing", "april"],
  },
  {
    group: "Boundary exploration",
    code: "COMPUTE total_sales OVER 2026-Q1 to 2026-Q2 AND product_tier = 'consumer'",
    description: "Same span but pinned to consumer — the enterprise boundary doesn't apply (scope mismatch). Only the region warns fire.",
    keywords: ["consumer", "scope", "boundary excluded", "warn only", "not applicable"],
  },
  {
    group: "Boundary exploration",
    code: "COMPUTE total_sales OVER 2026-Q3",
    description: "Q3 2026 is entirely after the enterprise boundary cut — silent. (No data in this window, so the SUM is NULL; included for the trigger-matrix demonstration.)",
    keywords: ["post cut", "silent", "after", "boundary", "no flags", "no historical"],
  },

  // ===== Disambiguation =====
  {
    group: "Disambiguation",
    code: "COMPUTE total_sales OVER 2026-Q1 to 2026-Q2 GROUP BY product_tier",
    description: "GROUP BY product_tier across the April 1 cut — only the enterprise row picks up the scoped boundary (red error). Consumer row carries only the region warns.",
    keywords: ["group by", "tier", "selective", "scoped boundary", "categorical disambiguate"],
  },
  {
    group: "Disambiguation",
    code: "COMPUTE average_order_value OVER 2025-Q4 to 2026-Q1 AND product_tier = 'enterprise'",
    description: "Spanning the AOV cut for enterprise only — the AOV boundary isn't scoped (impacts both tiers), so the straddling row still errors. Demonstrates that a query-pin doesn't help against an unscoped boundary.",
    keywords: ["unscoped boundary", "pin", "still errors", "definition change", "doesn't help"],
  },
  {
    group: "Disambiguation",
    code: "COMPUTE total_sales OVER 2026-03 GROUP BY region ORDER BY total_sales DESC",
    description: "March sales by region, sorted descending — see whether the NE outage actually hurt their share. ORDER BY references the metric column.",
    keywords: ["order by", "desc", "ranking", "biggest", "sort", "metric column"],
  },
  {
    group: "Disambiguation",
    code: "COMPUTE total_sales OVER 2026-Q1 GROUP BY region, month",
    description: "Region × month breakout — multiple categorical group-bys plus an implicit time grain. Region/month combinations land in their own rows.",
    keywords: ["multi group by", "matrix", "cross tabulate", "compound", "two dimensions"],
  },

  // ===== Lexicon lookup =====
  {
    group: "Lexicon lookup",
    code: "CHECK total_sales OVER 2026-Q1",
    description: "What does the lexicon know about total_sales in Q1 2026? Returns matching regions (the Feb anomaly, the NE outage) without running the metric query.",
    keywords: ["check", "lookup", "inspect", "what we know", "no compute", "metadata"],
  },
  {
    group: "Lexicon lookup",
    code: "CHECK average_order_value OVER 2025-Q4 to 2026-Q1",
    description: "Check what affects AOV across the cut — surfaces the AOV definition boundary as a `straddles` match. Useful before running a COMPUTE that you suspect will conflate regimes.",
    keywords: ["check", "boundary", "preview", "straddle", "what affects", "before compute"],
  },
  {
    group: "Lexicon lookup",
    code: "CHECK total_sales, average_order_value OVER 2026",
    description: "Multi-metric CHECK for all of 2026 — every region overlap and every boundary crossing in the lexicon that touches either metric.",
    keywords: ["multi metric", "all matches", "comprehensive check", "audit"],
  },
  {
    group: "Lexicon lookup",
    code: "CHECK total_sales OVER all time AND region = 'northeast'",
    description: "All-time check scoped to the northeast — surfaces only entries whose region scope is compatible with northeast.",
    keywords: ["all time", "scoped check", "northeast", "compatible", "filter"],
  },

  // ===== Lexicon registration =====
  {
    group: "Lexicon registration",
    code: `REGISTER region promo_spike\n  IMPACTING total_sales OVER 2026-03-15 to 2026-03-22\n  WITH "Spring promotion ran during this window"`,
    description: "Add a region to the lexicon. The next time a COMPUTE overlaps this window, the row will carry an amber warn with the description.",
    keywords: ["register", "region", "add", "promo", "create", "annotate"],
  },
  {
    group: "Lexicon registration",
    code: `REGISTER region tariff_window\n  IMPACTING total_sales OVER 2026-Q2 AND product_tier = 'enterprise'\n  WITH "Tariff impact on enterprise imports"`,
    description: "A region scoped to a product tier — affects only queries that overlap both the time window AND touch enterprise.",
    keywords: ["scoped region", "tier", "categorical", "constraint", "register"],
  },
  {
    group: "Lexicon registration",
    code: `REGISTER region rebrand\n  IMPACTING total_sales OVER 2025-Q3 to 2025-Q4\n  IMPACTING order_count OVER 2025-Q3 to 2026-Q1\n  WITH "Multi-metric impact from the rebrand campaign"`,
    description: "A region with multiple IMPACTING clauses — different metrics affected over different windows, but one shared lexicon entry.",
    keywords: ["multi impact", "multiple metrics", "rebrand", "different windows", "shared"],
  },
  {
    group: "Lexicon registration",
    code: `REGISTER boundary tax_rule_change\n  AT 2026-02-01\n  IMPACTING total_sales\n  BEFORE "tax-exclusive" "Sales totals were reported net of sales tax."\n  AFTER  "tax-inclusive" "Sales totals roll up gross of sales tax."`,
    description: "Add a boundary at Feb 1 — pre-cut totals exclude tax, post-cut totals include it. Comparisons spanning the cut will be flagged.",
    keywords: ["register", "boundary", "tax", "methodology change", "before after"],
  },
  {
    group: "Lexicon registration",
    code: `REGISTER boundary fy26_pricing\n  AT 2026-01-01 AND product_tier = 'consumer'\n  IMPACTING total_sales\n  BEFORE "FY25 list prices" "Consumer-tier list prices set during the prior fiscal year."\n  AFTER  "FY26 list prices" "Consumer prices reduced ~8% on Jan 1 to drive volume."\n  WITH "FY26 consumer-tier pricing reset on Jan 1, 2026."`,
    description: "A scoped boundary with an optional WITH override — the WITH replaces the auto-composed change sentence in spanning footers.",
    keywords: ["scoped boundary", "with override", "consumer", "pricing", "change description"],
  },

  // ===== Introspection (v0.4.0) =====
  {
    group: "Introspection",
    code: "SHOW LEXICON",
    description: "List every entry currently in the lexicon as a compact table — kind, name, scope, and a one-line summary per row.",
    keywords: ["show", "list", "lexicon", "inspect", "describe", "data dictionary", "all entries"],
  },
  {
    group: "Introspection",
    code: "SHOW LEXICON aov_definition_change",
    description: "Detail view of a single named entry — full impacts (regions) or full BEFORE/AFTER regimes (boundaries) plus any change override.",
    keywords: ["show", "describe", "lexicon", "one entry", "detail", "filter by name"],
  },
  {
    group: "Introspection",
    code: "SHOW LEXICON nonexistent_entry",
    description: "Filtering by a name that doesn't exist returns an empty result rather than throwing — the cell renders a soft note.",
    keywords: ["show", "not found", "missing", "empty", "non throwing"],
  },
  {
    group: "Introspection",
    code: "SHOW SCHEMA",
    description: "Inspect the semantic-layer surface — every metric, its primary time, and the dimensions on its dataset. Rendered as one block per metric.",
    keywords: ["show", "schema", "metrics", "dimensions", "semantic layer", "describe", "data dictionary"],
  },
  {
    group: "Introspection",
    code: "UNREGISTER q1_data_quality_issue",
    description: "Drop a lexicon entry by name. After running, re-run any query that touched Feb 15–20 — the q1 region no longer flags. Reset the lexicon (panel above) to restore.",
    keywords: ["unregister", "remove", "delete", "drop", "lexicon", "mutate"],
  },
  {
    group: "Introspection",
    code: "UNREGISTER never_existed",
    description: "Unregistering a name that doesn't exist returns found: false rather than throwing. The cell renders a soft note.",
    keywords: ["unregister", "not found", "missing", "non throwing", "graceful"],
  },
];

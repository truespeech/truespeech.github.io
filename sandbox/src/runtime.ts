// Shared runtime types and the in-memory lexicon adapter.
//
// These are the structural mirrors of the truespeech runtime's public
// shapes (kept local so the sandbox/tutorial front-ends don't need a
// build-time dependency on the runtime package), plus a small
// read/write LexiconAdapter implementation with seed/reset/dirty
// helpers. Imported by both the sandbox notebook (sandbox/main.ts) and
// the tutorial's standalone cells (tutorial/main.ts).

export interface ResolvedConstraint {
  dimension: string;
  operator: string;
  value: string | number | (string | number)[];
}
export interface ResolvedRegion {
  timeStart: string;
  timeEnd: string;
  constraints: ResolvedConstraint[];
}
export interface Impact {
  metric: string;
  region: ResolvedRegion;
}

export interface RegimeDescription {
  label: string;
  description: string;
}

export interface RegionLexiconEntry {
  kind: "region";
  name: string;
  impacts: Impact[];
  description: string;
}
export interface BoundaryLexiconEntry {
  kind: "boundary";
  name: string;
  at: string;
  constraints: ResolvedConstraint[];
  metrics: string[];
  before: RegimeDescription;
  after: RegimeDescription;
  changeDescription?: string;
}
export type LexiconEntry = RegionLexiconEntry | BoundaryLexiconEntry;

export interface RegionMatch {
  kind: "region";
  entry: RegionLexiconEntry;
  impact: Impact;
  overlap: ResolvedRegion;
}
export interface BoundaryMatch {
  kind: "boundary";
  entry: BoundaryLexiconEntry;
  metric: string;
  crossedAt: string;
  side: "before" | "after" | "straddles";
}
export type LexiconMatch = RegionMatch | BoundaryMatch;

export interface RuntimeRowDecoration {
  matches: LexiconMatch[];
  severity?: "warn" | "error";
}

export interface HistoricalNote {
  boundary: BoundaryLexiconEntry;
  metric: string;
}

export interface DimensionInfo {
  name: string;
  isTime: boolean;
  dataset: string;
}

export interface MetricSummary {
  name: string;
  description?: string;
  primaryTime: string | null;
  dimensions: DimensionInfo[];
}

export type ExecuteResult =
  | {
      statement: "compute";
      semanticQuery: any;
      sql: string;
      results: { columns: string[]; rows: (string | number | null)[][] };
      reconciliation: LexiconMatch[];
      region: ResolvedRegion;
      decorations: RuntimeRowDecoration[];
      historicalNotes: HistoricalNote[];
    }
  | { statement: "register"; entry: LexiconEntry }
  | { statement: "check"; matches: LexiconMatch[] }
  | { statement: "show"; subject: "lexicon"; entries: LexiconEntry[]; filters?: string[] }
  | { statement: "show"; subject: "schema"; metrics: MetricSummary[] }
  | { statement: "unregister"; name: string; found: boolean };

export type Grain = "day" | "week" | "month" | "quarter" | "year";

export interface CompletionItem {
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

export interface TsRuntimeApi {
  TrueSpeech: new (opts: {
    semanticLayer: any;
    database: { execute: (sql: string) => Promise<any> };
    lexicon?: any;
    timeLiteralYears?: number[];
  }) => {
    parse(source: string): { ast: any; errors: any[] };
    validate(ast: any): { errors: any[] };
    execute(source: string): Promise<ExecuteResult>;
    complete(source: string, position: number): Promise<{
      prefix: string;
      start: number;
      end: number;
      candidates: CompletionItem[];
    }>;
  };
  osiAdapter: (runtime: any) => any;
  renderError: (error: any, source: string) => string;
  renderRegion: (region: ResolvedRegion) => string;
  formatTimeBucket: (isoStart: string, grain: Grain) => string;
  endOfBucket: (isoStart: string, grain: Grain) => string;
  TrueSpeechExecutionError: new (errors: any[]) => Error & { errors: any[] };
}

// The instance type of the TrueSpeech runtime class — what `new
// tsModule.TrueSpeech(...)` produces.
export type TsInstance = InstanceType<TsRuntimeApi["TrueSpeech"]>;

// In-memory LexiconAdapter with seed/reset/dirty extensions. The
// sandbox uses one shared instance; the tutorial gives each
// interactive cell its own so cells can't interfere with one another.
export class MemoryLexicon {
  private entries: LexiconEntry[] = [];
  private seed: LexiconEntry[] = [];

  async add(entry: LexiconEntry): Promise<void> {
    this.entries.push(entry);
  }
  async list(): Promise<LexiconEntry[]> {
    return this.entries.map(cloneEntry);
  }

  getEntries(): LexiconEntry[] {
    return this.entries.map(cloneEntry);
  }
  // The runtime's LexiconAdapter contract (v0.4.0+) names this `remove`
  // and expects a Promise<boolean> indicating whether anything was
  // removed.
  async remove(name: string): Promise<boolean> {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.name !== name);
    return this.entries.length < before;
  }
  snapshotSeed(): void {
    this.seed = this.entries.map(cloneEntry);
  }
  reset(): void {
    this.entries = this.seed.map(cloneEntry);
  }
  // Both sides are normalized through cloneEntry before serializing —
  // without normalization, the runtime's construction-order of the
  // entry object differs from cloneEntry's, and JSON.stringify produces
  // unequal strings even when the content matches.
  isDirty(): boolean {
    if (this.entries.length !== this.seed.length) return true;
    return (
      JSON.stringify(this.entries.map(cloneEntry)) !==
      JSON.stringify(this.seed)
    );
  }
}

export function cloneEntry(e: LexiconEntry): LexiconEntry {
  if (e.kind === "region") {
    return {
      kind: "region",
      name: e.name,
      description: e.description,
      impacts: e.impacts.map((i) => ({
        metric: i.metric,
        region: {
          timeStart: i.region.timeStart,
          timeEnd: i.region.timeEnd,
          constraints: i.region.constraints.map((c) => ({ ...c })),
        },
      })),
    };
  }
  return {
    kind: "boundary",
    name: e.name,
    at: e.at,
    metrics: [...e.metrics],
    constraints: e.constraints.map((c) => ({ ...c })),
    before: { ...e.before },
    after: { ...e.after },
    changeDescription: e.changeDescription,
  };
}

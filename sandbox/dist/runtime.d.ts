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
export type ExecuteResult = {
    statement: "compute";
    semanticQuery: any;
    sql: string;
    results: {
        columns: string[];
        rows: (string | number | null)[][];
    };
    reconciliation: LexiconMatch[];
    region: ResolvedRegion;
    decorations: RuntimeRowDecoration[];
    historicalNotes: HistoricalNote[];
} | {
    statement: "register";
    entry: LexiconEntry;
} | {
    statement: "check";
    matches: LexiconMatch[];
} | {
    statement: "show";
    subject: "lexicon";
    entries: LexiconEntry[];
    filters?: string[];
} | {
    statement: "show";
    subject: "schema";
    metrics: MetricSummary[];
} | {
    statement: "unregister";
    name: string;
    found: boolean;
};
export type Grain = "day" | "week" | "month" | "quarter" | "year";
export interface CompletionItem {
    text: string;
    kind: "keyword" | "soft-keyword" | "metric" | "dimension" | "grain" | "operator" | "lexicon-entry" | "time-literal" | "string-literal" | "number-literal" | "identifier";
    hint?: string;
}
export interface TsRuntimeApi {
    TrueSpeech: new (opts: {
        semanticLayer: any;
        database: {
            execute: (sql: string) => Promise<any>;
        };
        lexicon?: any;
        timeLiteralYears?: number[];
    }) => {
        parse(source: string): {
            ast: any;
            errors: any[];
        };
        validate(ast: any): {
            errors: any[];
        };
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
    TrueSpeechExecutionError: new (errors: any[]) => Error & {
        errors: any[];
    };
}
export type TsInstance = InstanceType<TsRuntimeApi["TrueSpeech"]>;
export declare class MemoryLexicon {
    private entries;
    private seed;
    add(entry: LexiconEntry): Promise<void>;
    list(): Promise<LexiconEntry[]>;
    getEntries(): LexiconEntry[];
    remove(name: string): Promise<boolean>;
    snapshotSeed(): void;
    reset(): void;
    isDirty(): boolean;
}
export declare function cloneEntry(e: LexiconEntry): LexiconEntry;

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
export declare function createLexiconPanel(opts: LexiconPanelOptions): LexiconPanel;
export {};

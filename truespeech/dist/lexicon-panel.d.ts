interface ResolvedRegion {
    timeStart: string;
    timeEnd: string;
    constraints: {
        dimension: string;
        operator: string;
        value: string | number | (string | number)[];
    }[];
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
export declare function createLexiconPanel(opts: LexiconPanelOptions): LexiconPanel;
export {};

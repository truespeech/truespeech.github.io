import type { Sample } from "./samples.js";
export interface SearchPanelOptions {
    samples: Sample[];
    onRun(code: string): void | Promise<void>;
    onCopy(code: string): void | Promise<void>;
    randomCount?: number;
}
export interface SearchPanel {
    element: HTMLElement;
}
export declare function createSearchPanel(opts: SearchPanelOptions): SearchPanel;

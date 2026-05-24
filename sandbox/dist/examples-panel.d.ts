export interface ExampleCard {
    label: string;
    explanation: string;
    command: string;
}
export interface ExampleGroup {
    title: string;
    cards: ExampleCard[];
}
export interface ExamplesPanelOptions {
    groups: ExampleGroup[];
    isDirty(): boolean;
    onReset(): void | Promise<void>;
    onRun(command: string): void | Promise<void>;
    onCopy(command: string): void | Promise<void>;
}
export interface ExamplesPanel {
    element: HTMLElement;
    refresh(): void;
}
export declare function createExamplesPanel(opts: ExamplesPanelOptions): ExamplesPanel;

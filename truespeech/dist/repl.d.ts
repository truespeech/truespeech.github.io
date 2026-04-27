/**
 * REPL UI component: a terminal-like panel with input and scrolling output.
 */
export interface ReplOptions {
    prompt: string;
    onSubmit: (input: string) => void | Promise<void>;
    label?: string;
}
export interface RowDecoration {
    highlight?: "warn";
    note?: string;
}
export interface AppendTableOptions {
    animate?: boolean;
    decorations?: (RowDecoration | undefined)[];
}
export interface Repl {
    appendOutput(text: string, className?: string): void;
    appendError(text: string): void;
    appendTable(columns: string[], rows: (string | number | null)[][], options?: AppendTableOptions): Promise<void>;
    appendSQL(sql: string): void;
    clear(): void;
    focus(): void;
    submit(command: string): void;
    setInput(text: string): void;
    element: HTMLElement;
}
/**
 * Create a REPL panel and append it to the container.
 */
export declare function createRepl(options: ReplOptions): Repl;
/**
 * Create the connector element between two REPL panels.
 * Has three stacked arrows per direction that cascade sequentially.
 */
export declare function createConnector(): {
    element: HTMLElement;
    flashDown: () => Promise<void>;
    flashUp: () => Promise<void>;
};

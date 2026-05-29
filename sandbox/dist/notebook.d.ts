interface CompletionItem {
    text: string;
    kind: "keyword" | "soft-keyword" | "metric" | "dimension" | "grain" | "operator" | "lexicon-entry" | "time-literal" | "string-literal" | "number-literal" | "identifier";
    hint?: string;
}
interface CompletionPayload {
    prefix: string;
    start: number;
    end: number;
    candidates: CompletionItem[];
}
export interface NotebookOptions {
    onSubmit(source: string): void | Promise<void>;
    onComplete?(source: string, position: number): Promise<CompletionPayload>;
    placeholder?: string;
}
export interface Notebook {
    element: HTMLElement;
    submit(source: string): void;
    setInput(text: string): void;
    addCell(element: HTMLElement): void;
    focus(): void;
}
export declare function createNotebook(opts: NotebookOptions): Notebook;
export {};

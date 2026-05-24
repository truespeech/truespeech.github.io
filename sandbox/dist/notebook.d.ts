export interface NotebookOptions {
    onSubmit(source: string): void | Promise<void>;
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

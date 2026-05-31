import type { ExecuteResult, TsRuntimeApi, TsInstance } from "./runtime.js";
export declare function renderCellShell(source: string, kind: string): {
    cell: HTMLElement;
    output: HTMLElement;
};
export declare function executeAndRenderInto(output: HTMLElement, source: string, ts: TsInstance, tsModule: TsRuntimeApi): Promise<void>;
export declare function renderResultInto(output: HTMLElement, result: ExecuteResult, tsModule: TsRuntimeApi): void;
export declare function renderComputeCell(source: string, result: Extract<ExecuteResult, {
    statement: "compute";
}>, tsModule: TsRuntimeApi): HTMLElement;
export declare function renderComputeInto(output: HTMLElement, result: Extract<ExecuteResult, {
    statement: "compute";
}>, tsModule: TsRuntimeApi): void;
export declare function renderRegisterCell(source: string, result: Extract<ExecuteResult, {
    statement: "register";
}>): HTMLElement;
export declare function renderRegisterInto(output: HTMLElement, result: Extract<ExecuteResult, {
    statement: "register";
}>): void;
export declare function renderCheckCell(source: string, result: Extract<ExecuteResult, {
    statement: "check";
}>): HTMLElement;
export declare function renderCheckInto(output: HTMLElement, result: Extract<ExecuteResult, {
    statement: "check";
}>): void;
export declare function renderErrorCell(source: string, errors: {
    message: string;
}[], tsModule: TsRuntimeApi): HTMLElement;
export declare function renderErrorInto(output: HTMLElement, errors: {
    message: string;
}[], source: string, tsModule: TsRuntimeApi): void;
export declare function renderShowLexiconCell(source: string, result: Extract<ExecuteResult, {
    statement: "show";
    subject: "lexicon";
}>): HTMLElement;
export declare function renderShowLexiconInto(output: HTMLElement, result: Extract<ExecuteResult, {
    statement: "show";
    subject: "lexicon";
}>): void;
export declare function renderShowSchemaCell(source: string, result: Extract<ExecuteResult, {
    statement: "show";
    subject: "schema";
}>): HTMLElement;
export declare function renderShowSchemaInto(output: HTMLElement, result: Extract<ExecuteResult, {
    statement: "show";
    subject: "schema";
}>): void;
export declare function renderUnregisterCell(source: string, result: Extract<ExecuteResult, {
    statement: "unregister";
}>): HTMLElement;
export declare function renderUnregisterInto(output: HTMLElement, result: Extract<ExecuteResult, {
    statement: "unregister";
}>): void;

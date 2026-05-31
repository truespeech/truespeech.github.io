import { MemoryLexicon } from "../../sandbox/dist/runtime.js";
import type { TsRuntimeApi, TsInstance } from "../../sandbox/dist/runtime.js";
export interface CannedInput {
    code: string;
    explanation: string;
}
export interface StandaloneCellConfig {
    cannedInputs: CannedInput[];
    seedStatements?: string[];
    initialInput?: string;
}
export interface CellDeps {
    tsModule: TsRuntimeApi;
    semanticLayer: any;
    dbExecute: (sql: string) => Promise<any>;
}
export declare function makeSeededTs(deps: CellDeps, seedStatements?: string[]): Promise<{
    ts: TsInstance;
    lexicon: MemoryLexicon;
}>;
export declare function createFrozenCell(source: string, deps: CellDeps, seedStatements?: string[]): Promise<HTMLElement>;
export declare function createStandaloneCell(config: StandaloneCellConfig, deps: CellDeps): Promise<HTMLElement>;

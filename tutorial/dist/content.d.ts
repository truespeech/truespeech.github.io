import type { StandaloneCellConfig } from "./standalone-cell.js";
export type Block = {
    kind: "html";
    html: string;
} | {
    kind: "frozen";
    source: string;
    seed?: string[];
} | {
    kind: "interactive";
    config: StandaloneCellConfig;
};
export declare const OUTLINE: Block[];

export interface Sample {
    code: string;
    description: string;
    keywords: string[];
    group: SampleGroup;
}
export type SampleGroup = "Basic compute" | "Region exploration" | "Boundary exploration" | "Disambiguation" | "Lexicon lookup" | "Lexicon registration";
export declare const SAMPLES: Sample[];

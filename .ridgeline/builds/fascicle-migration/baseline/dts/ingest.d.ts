type IngestOptions = {
    model: string;
    timeout: number;
    maxBudgetUsd?: number;
    specialistCount?: 1 | 2 | 3;
    /**
     * Source spec path. May point at a single file (PRD, RFC, design doc) or
     * a directory of related markdown/text files that get concatenated. Raw
     * text is also accepted but rare for ingest (the use case is "I already
     * wrote the spec elsewhere").
     */
    input: string;
};
/**
 * One-shot ingest: convert a freeform spec (file, directory bundle, or raw
 * text) into the four ridgeline files (shape.md, spec.md, constraints.md,
 * taste.md, plus design.md when visual shapes match) without any Q&A. The
 * synthesizer is asked to flag inferred facts in a `## Inferred / Gaps`
 * section per file so the user can edit those by hand instead of through
 * back-and-forth chat.
 */
export declare const runIngest: (buildName: string, opts: IngestOptions) => Promise<void>;
export {};

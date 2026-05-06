export type SpecOptions = {
    model: string;
    timeout: number;
    maxBudgetUsd?: number;
    /** Optional path to a file (e.g., idea.md) or raw text to feed as authoritative spec guidance. */
    input?: string;
    specialistCount?: 1 | 2 | 3;
    specialistTimeoutSeconds?: number;
    /**
     * Pre-resolved authoritative spec content. When provided, takes precedence
     * over `input` (skips disk read and the file-vs-text heuristic). Used by
     * the `ingest` command to pass an already-resolved bundle through.
     */
    inputContent?: string;
    /** When true, instruct the synthesizer to add `## Inferred / Gaps` sections. */
    inferGapFlagging?: boolean;
};
export declare const runSpec: (buildName: string, opts: SpecOptions) => Promise<void>;

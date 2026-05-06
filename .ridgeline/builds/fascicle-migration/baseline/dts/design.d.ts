type DesignOptions = {
    model: string;
    timeout: number;
    matchedShapes?: string[];
};
type DesignAutoOptions = DesignOptions & {
    /** When true, append a `## Inferred / Gaps` section to design.md. */
    inferGapFlagging?: boolean;
};
export declare const runDesign: (buildName: string | null, opts: DesignOptions) => Promise<void>;
/**
 * Non-interactive design: produce design.md from shape.md + catalog context
 * in a single LLM call, no Q&A. Used by `ingest` when visual shapes match.
 */
export declare const runDesignAuto: (buildName: string | null, opts: DesignAutoOptions) => Promise<void>;
export {};

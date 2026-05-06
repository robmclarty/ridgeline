type ShapeOutput = {
    projectName: string;
    intent: string;
    scope: {
        size: string;
        inScope: string[];
        outOfScope: string[];
    };
    solutionShape: string;
    risksAndComplexities: string[];
    existingLandscape: {
        codebaseState: string;
        externalDependencies: string[];
        dataStructures: string[];
        relevantModules: string[];
    };
    technicalPreferences: {
        errorHandling: string;
        performance: string;
        security: string;
        tradeoffs: string;
        style: string;
    };
    runtime?: {
        devServerPort?: number;
    };
};
export type ShapeOptions = {
    model: string;
    timeout: number;
    input?: string;
};
/** Format the structured shape output as shape.md markdown. */
export declare const formatShapeMd: (shape: ShapeOutput) => string;
export declare const runShape: (buildName: string, opts: ShapeOptions) => Promise<void>;
type ShapeAutoOptions = ShapeOptions & {
    /** Pre-resolved source content. Required — callers must supply input. */
    inputContent: string;
    /** Optional human-readable label for status output (e.g. file path). */
    inputLabel?: string;
};
/**
 * Non-interactive shape: skip Q&A, infer reasonable defaults from the source
 * content + project, and produce shape.md in a single LLM call. Used by the
 * `ingest` command so users with a written-out PRD don't have to answer
 * back-and-forth questions.
 */
export declare const runShapeAuto: (buildName: string, opts: ShapeAutoOptions) => Promise<void>;
export {};

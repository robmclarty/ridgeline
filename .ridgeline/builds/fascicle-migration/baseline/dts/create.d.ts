export type CreateOptions = {
    model: string;
    timeout: string;
    maxBudgetUsd?: string;
    constraints?: string;
    taste?: string;
    maxRetries?: string;
    check?: string;
    checkTimeout?: string;
    context?: string;
    unsafe?: boolean;
    sandbox?: string;
    input?: string;
    /** Skip Q&A; route shape to runShapeAuto. spec/plan/build are already non-interactive. */
    isAuto?: boolean;
    /** Suppress the status table — used when called from the runAuto orchestrator. */
    isQuiet?: boolean;
    /** Number of specialists for ensemble stages (forwarded to runSpec). */
    specialistCount?: 1 | 2 | 3;
};
/**
 * Persist the original input path to state.json when the user supplied a
 * file or directory as input. Inline text inputs are not recorded — there
 * is no source path to come back to.
 */
export declare const persistInputSourceIfPath: (buildDir: string, buildName: string, input?: string) => void;
export declare const runCreate: (buildName: string, opts: CreateOptions) => Promise<void>;

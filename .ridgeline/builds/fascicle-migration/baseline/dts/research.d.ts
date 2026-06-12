type ResearchOptions = {
    /** Raw `--model` override; the researcher/refiner roles resolve per-call. */
    model?: string;
    timeout: number;
    maxBudgetUsd?: number;
    isQuick: boolean;
    auto: number | null;
    specialistCount?: 1 | 2 | 3;
    specialistTimeoutSeconds?: number;
};
export declare const runResearch: (buildName: string, opts: ResearchOptions) => Promise<void>;
export {};

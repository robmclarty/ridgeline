type ResearchOptions = {
    model: string;
    timeout: number;
    maxBudgetUsd?: number;
    isQuick: boolean;
    auto: number | null;
    specialistCount?: 1 | 2 | 3;
    specialistTimeoutSeconds?: number;
};
export declare const runResearch: (buildName: string, opts: ResearchOptions) => Promise<void>;
export {};

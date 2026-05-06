type RefineOptions = {
    model: string;
    timeout: number;
    iterationNumber?: number;
};
export declare const runRefine: (buildName: string, opts: RefineOptions) => Promise<void>;
export {};

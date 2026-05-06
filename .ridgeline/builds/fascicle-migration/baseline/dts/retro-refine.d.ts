type RetroRefineOpts = {
    model: string;
    timeout: number;
};
export declare const runRetroRefine: (buildName: string, opts: RetroRefineOpts) => Promise<void>;
export {};

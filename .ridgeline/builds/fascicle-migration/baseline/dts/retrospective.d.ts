type RetrospectiveOpts = {
    model: string;
    timeout: number;
};
export declare const runRetrospective: (buildName: string, opts: RetrospectiveOpts) => Promise<void>;
export {};

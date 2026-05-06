import { RidgelineConfig, PhaseInfo } from "../types";
export declare const ensurePhases: (config: RidgelineConfig) => Promise<PhaseInfo[]>;
export declare const runBuild: (config: RidgelineConfig) => Promise<void>;

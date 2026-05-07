import { DashboardServer } from "../ui/dashboard/server.js";
export interface UiOptions {
    port?: number;
}
export declare const DEFAULT_PORT = 4411;
export declare const findMostRecentBuild: (cwd: string) => string | null;
export declare const runUi: (cwd: string, buildName: string | undefined, opts: UiOptions) => Promise<DashboardServer>;

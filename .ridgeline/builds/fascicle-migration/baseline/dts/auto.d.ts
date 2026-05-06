import { CreateOptions } from "./create";
export type StopAfter = "shape" | "design" | "spec" | "plan" | "build";
type AutoOptions = CreateOptions & {
    stopAfter?: StopAfter;
    isNoRefine?: boolean;
    /** Number of research+refine iterations. undefined = research is off. */
    research?: number;
    /** Number of parallel directions to generate. undefined = directions is off. */
    directions?: number;
    /** Inspiration source for the directions picker (file/dir/text). */
    inspiration?: string;
};
/**
 * End-to-end auto orchestrator. Loops runCreate until the pipeline is
 * complete or the stopAfter boundary is hit, with two opt-in insertions:
 * directions (between shape and design) and research+refine (between spec
 * and plan). At the tail of a successful run, appends a retrospective and
 * (unless --no-refine) writes refined-input.md.
 */
export declare const runAuto: (buildName: string, opts: AutoOptions) => Promise<void>;
export {};

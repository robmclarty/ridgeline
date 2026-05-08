import * as readline from "node:readline";
import type { Engine } from "fascicle";
type QAQuestion = {
    question: string;
    suggestedAnswer?: string;
};
type QAResponse = {
    ready: boolean;
    questions?: (string | QAQuestion)[];
    summary?: string;
};
export declare const normalizeQuestion: (q: string | QAQuestion) => QAQuestion;
export declare const parseQAResponse: (resultText: string) => QAResponse;
export declare const askQuestion: (rl: readline.Interface, prompt: string) => Promise<string>;
type QAOpts = {
    engine?: Engine;
    model: string;
    questionLabel?: string;
};
/**
 * Run the QA intake turn — invoke Claude with the QA JSON schema to gather
 * initial questions, then run the clarification loop until ready.
 */
export declare const runQAIntake: (rl: readline.Interface, systemPrompt: string, userPrompt: string, opts: QAOpts, timeoutMs: number, statusMessage: string) => Promise<{
    sessionId: string;
    qa: QAResponse;
}>;
type OneShotOpts = {
    engine?: Engine;
    systemPrompt: string;
    userPrompt: string;
    model: string;
    timeoutMs: number;
    allowedTools?: string[];
    jsonSchema?: string;
    buildDir?: string;
    statusMessage: string;
};
/**
 * Single-call Claude invocation with the standard display callbacks. Used by
 * non-interactive paths (`runShapeAuto`, `runDesignAuto`) where there
 * is no resumable session — just one prompt, one output.
 */
export declare const runOneShotCall: (opts: OneShotOpts) => Promise<{
    result: string;
    sessionId: string;
}>;
/**
 * Run the output turn — invoke Claude for the final output (no QA schema).
 */
export declare const runOutputTurn: (systemPrompt: string, userPrompt: string, model: string, timeoutMs: number, sessionId: string, statusMessage: string, jsonSchema?: string, engine?: Engine) => Promise<{
    result: string;
    sessionId: string;
}>;
export {};

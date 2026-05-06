/**
 * Resolve a user-supplied input argument to either text or file content.
 *
 * Heuristic: if the string looks like a path (has an extension, starts with
 * a separator, or contains one) and the file exists on disk, read it.
 * Otherwise treat the input as raw text.
 */
export type ResolvedInput = {
    type: "file";
    path: string;
    content: string;
} | {
    type: "text";
    content: string;
};
export declare const resolveInput: (input: string) => ResolvedInput;
/** A bundle is a single source (file or text) or a concatenation of many files. */
export type ResolvedBundle = {
    type: "file";
    path: string;
    content: string;
} | {
    type: "directory";
    path: string;
    files: string[];
    content: string;
} | {
    type: "text";
    content: string;
};
/**
 * Resolve an input that may point at a single file, a directory of source
 * documents, or be raw text. Directories are concatenated (sorted by relative
 * path) with a `## File: <relpath>` header before each file body so downstream
 * agents can see provenance.
 */
export declare const resolveInputBundle: (input: string) => ResolvedBundle;

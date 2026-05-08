// Re-exports for backward compatibility — implementations split into
// feedback.parse.ts (verdict parsing) and feedback.format.ts (formatting).
export { parseVerdict } from "./feedback.parse.js"
export { formatIssue, generateFeedback } from "./feedback.format.js"

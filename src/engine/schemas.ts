import { z } from "zod"

const reviewIssueSchema = z.object({
  criterion: z.number().optional(),
  description: z.string(),
  file: z.string().optional(),
  severity: z.enum(["blocking", "suggestion"]),
  requiredState: z.string().optional(),
})

export const reviewVerdictSchema = z.object({
  passed: z.boolean(),
  summary: z.string(),
  criteriaResults: z.array(z.object({
    criterion: z.number(),
    passed: z.boolean(),
    notes: z.string(),
  })),
  issues: z.array(reviewIssueSchema),
  suggestions: z.array(reviewIssueSchema),
})

export type ReviewVerdictSchema = z.infer<typeof reviewVerdictSchema>

const phaseProposalSchema = z.object({
  title: z.string(),
  slug: z.string(),
  goal: z.string(),
  acceptanceCriteria: z.array(z.string()),
  specReference: z.string(),
  rationale: z.string(),
  dependsOn: z.array(z.string()).optional(),
})

const skeletonSchema = z.object({
  phaseList: z.array(z.object({
    id: z.string(),
    slug: z.string(),
  })),
  depGraph: z.array(z.tuple([z.string(), z.string()])),
})

export const planArtifactSchema = z.object({
  perspective: z.string(),
  summary: z.string(),
  phases: z.array(phaseProposalSchema),
  tradeoffs: z.string(),
  _skeleton: skeletonSchema,
})

export type PlanArtifactSchema = z.infer<typeof planArtifactSchema>

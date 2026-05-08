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

const planSkeletonShape = z.object({
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
  _skeleton: planSkeletonShape,
})

export type PlanArtifactSchema = z.infer<typeof planArtifactSchema>

export const planReviewSchema = z.object({
  approved: z.boolean(),
  issues: z.array(z.string()),
})

export type PlanReviewSchema = z.infer<typeof planReviewSchema>

const specSkeletonSchema = z.object({
  stage: z.literal("spec"),
  skeleton: z.object({
    sectionOutline: z.array(z.string()),
    riskList: z.array(z.string()),
  }),
})

const planSkeletonSchema = z.object({
  stage: z.literal("plan"),
  skeleton: planSkeletonShape,
})

const researchSkeletonSchema = z.object({
  stage: z.literal("research"),
  skeleton: z.object({
    findings: z.array(z.string()),
    openQuestions: z.array(z.string()),
  }),
})

export const specialistVerdictSchema = z.discriminatedUnion("stage", [
  specSkeletonSchema,
  planSkeletonSchema,
  researchSkeletonSchema,
])

export type SpecialistVerdictSchema = z.infer<typeof specialistVerdictSchema>

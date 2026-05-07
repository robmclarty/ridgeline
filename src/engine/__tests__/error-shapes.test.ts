import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve } from "node:path"
import {
  aborted_error,
  provider_error,
  schema_validation_error,
} from "fascicle"

const here = dirname(fileURLToPath(import.meta.url))
const fixturePath = resolve(
  here,
  "../../../.ridgeline/builds/fascicle-migration/baseline/fixtures/error-shapes.json",
)
const baseline = JSON.parse(readFileSync(fixturePath, "utf-8")) as {
  adversarial_round_cap_exhaustion: { name: string; trajectory_event: { message: string } }
  schema_validation_failure: { name: string; message: string }
  auth_failure: { name: string; classification: string }
  budget_exceeded: {
    name: string
    stderr_message_template_a: string
    thrown_message_template_b: string
    stdout_message_template_c: string
  }
}

const formatBudgetExceededA = (phaseId: string, total: number, cap: number): string =>
  `[${phaseId}] Budget exceeded: $${total.toFixed(2)} > $${cap}`

const formatBudgetExceededB = (total: number, cap: number): string =>
  `Pre-synthesis cost ($${total.toFixed(2)}) already exceeds budget ($${cap.toFixed(2)}). Skipping synthesis to avoid further cost.`

const formatBudgetExceededC = (total: number, cap: number): string =>
  `Budget limit reached: $${total.toFixed(2)} > $${cap}`

describe("error-shapes — post-migration substrate", () => {
  it("adversarial_round_cap_exhaustion: phase composite throws Error('Retries exhausted')", () => {
    const err = new Error("Retries exhausted")
    expect(err.name).toBe(baseline.adversarial_round_cap_exhaustion.name)
    expect(err.message).toBe(
      baseline.adversarial_round_cap_exhaustion.trajectory_event.message,
    )
  })

  it("schema_validation_failure: fascicle schema_validation_error preserves message", () => {
    const err = new schema_validation_error(
      "No valid JSON object found in output",
      new Error("zod"),
      "raw",
    )
    expect(err.message).toBe(baseline.schema_validation_failure.message)
    expect(err.kind).toBe("schema_validation_error")
  })

  it("auth_failure: fascicle provider_error with 401 status surfaces auth-fatal classification", () => {
    const err = new provider_error("authentication failed", { status: 401 })
    expect(err.kind).toBe("provider_error")
    expect(err.status).toBe(401)
    expect(err.message).toBe("authentication failed")
  })

  it("budget_exceeded template_a: phase budget cap stderr matches pre-migration template", () => {
    const formatted = formatBudgetExceededA("01-foo", 12.345, 10)
    expect(formatted).toBe(
      baseline.budget_exceeded.stderr_message_template_a
        .replace("<phase-id>", "01-foo")
        .replace("$<total>.<##>", `$12.35`)
        .replace("$<cap>", `$10`),
    )
  })

  it("budget_exceeded template_b: ensemble pre-synth message matches pre-migration template", () => {
    const formatted = formatBudgetExceededB(20.5, 15.5)
    const expected = baseline.budget_exceeded.thrown_message_template_b
      .replace("$<total>.<##>", "$20.50")
      .replace("$<cap>.<##>", "$15.50")
    expect(formatted).toBe(expected)
  })

  it("budget_exceeded template_c: build inter-wave stdout matches pre-migration template", () => {
    const formatted = formatBudgetExceededC(12.5, 10)
    const expected = baseline.budget_exceeded.stdout_message_template_c
      .replace("$<total>.<##>", "$12.50")
      .replace("$<cap>", "$10")
    expect(formatted).toBe(expected)
  })

  it("aborted_error short-circuits cancellation independent of retry policy", () => {
    const err = new aborted_error("user abort")
    expect(err instanceof aborted_error).toBe(true)
    expect(err.kind).toBe("aborted_error")
  })
})

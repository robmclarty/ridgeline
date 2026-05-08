import { describe, expect, it } from "vitest"
import {
  aborted_error,
  engine_config_error,
  model_not_found_error,
  on_chunk_error,
  provider_capability_error,
  provider_error,
  provider_not_configured_error,
  rate_limit_error,
  schema_validation_error,
  tool_approval_denied_error,
  tool_error,
} from "fascicle"
import { shouldRetry } from "../retry.policy.js"

describe("shouldRetry — fascicle typed-error classifier", () => {
  it("retries rate_limit_error", () => {
    expect(shouldRetry(new rate_limit_error("rate limited"))).toBe(true)
  })

  it("retries on_chunk_error", () => {
    expect(shouldRetry(new on_chunk_error("chunk problem", new Error("boom")))).toBe(true)
  })

  it("retries provider_error with 5xx status", () => {
    expect(shouldRetry(new provider_error("server crashed", { status: 500 }))).toBe(true)
    expect(shouldRetry(new provider_error("bad gateway", { status: 502 }))).toBe(true)
    expect(shouldRetry(new provider_error("gateway timeout", { status: 504 }))).toBe(true)
  })

  it("retries provider_error with no status (network)", () => {
    expect(shouldRetry(new provider_error("network blip"))).toBe(true)
  })

  it("does not retry provider_error with 4xx status", () => {
    expect(shouldRetry(new provider_error("bad request", { status: 400 }))).toBe(false)
    expect(shouldRetry(new provider_error("unauthorized", { status: 401 }))).toBe(false)
    expect(shouldRetry(new provider_error("forbidden", { status: 403 }))).toBe(false)
    expect(shouldRetry(new provider_error("not found", { status: 404 }))).toBe(false)
  })

  it("does not retry aborted_error", () => {
    expect(shouldRetry(new aborted_error("aborted by user"))).toBe(false)
  })

  it("does not retry engine_config_error", () => {
    expect(shouldRetry(new engine_config_error("bad cfg"))).toBe(false)
  })

  it("does not retry model_not_found_error", () => {
    expect(shouldRetry(new model_not_found_error("claude-x", ["sonnet"]))).toBe(false)
  })

  it("does not retry schema_validation_error", () => {
    expect(shouldRetry(new schema_validation_error("schema mismatch", new Error("zod"), "raw"))).toBe(false)
  })

  it("does not retry tool_approval_denied_error", () => {
    expect(
      shouldRetry(
        new tool_approval_denied_error("user denied", {
          tool_name: "Bash",
          step_index: 0,
          tool_call_id: "tc1",
        }),
      ),
    ).toBe(false)
  })

  it("does not retry provider_capability_error", () => {
    expect(shouldRetry(new provider_capability_error("anthropic", "schema"))).toBe(false)
  })

  it("does not retry provider_not_configured_error", () => {
    expect(shouldRetry(new provider_not_configured_error("anthropic"))).toBe(false)
  })

  it("does not retry tool_error", () => {
    expect(
      shouldRetry(
        new tool_error("tool blew up", {
          tool_name: "Bash",
          tool_call_id: "tc1",
          cause: new Error("x"),
        }),
      ),
    ).toBe(false)
  })

  it("does not retry plain Error", () => {
    expect(shouldRetry(new Error("anything else"))).toBe(false)
  })

  it("aborted_error always short-circuits — even when wrapped in a retry config that retries everything", () => {
    const wrappedRetryAll = (e: unknown): boolean => {
      if (e instanceof aborted_error) return shouldRetry(e)
      return true
    }
    expect(wrappedRetryAll(new aborted_error("user abort"))).toBe(false)
    expect(wrappedRetryAll(new aborted_error("signal"))).toBe(false)
    expect(wrappedRetryAll(new Error("transient"))).toBe(true)
  })
})

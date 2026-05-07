import { describe, it, expect } from "vitest"
import { compose, step, run } from "fascicle"

const noopFlow = compose(
  "signal.default.test",
  step<{ readonly delay: number }, { readonly ok: true }>(
    "signal.default.test_inner",
    async () => ({ ok: true }),
  ),
)

const countSigintListeners = (): number => process.listeners("SIGINT").length

describe("fascicle install_signal_handlers default", () => {
  it("defaults to true (installs SIGINT/SIGTERM handlers when option omitted)", async () => {
    const before = countSigintListeners()
    let duringMax = before
    const probe = compose(
      "signal.default.probe",
      step<{ readonly delay: number }, { readonly ok: true }>(
        "signal.default.probe_inner",
        async () => {
          duringMax = Math.max(duringMax, countSigintListeners())
          return { ok: true }
        },
      ),
    )
    await run(probe, { delay: 0 })
    expect(duringMax).toBeGreaterThan(before)
  })

  it("does NOT install handlers when install_signal_handlers: false is passed", async () => {
    const before = countSigintListeners()
    let duringMax = before
    const probe = compose(
      "signal.default.probe.opt_out",
      step<{ readonly delay: number }, { readonly ok: true }>(
        "signal.default.probe.opt_out_inner",
        async () => {
          duringMax = Math.max(duringMax, countSigintListeners())
          return { ok: true }
        },
      ),
    )
    await run(probe, { delay: 0 }, { install_signal_handlers: false })
    expect(duringMax).toBe(before)
  })

  it("smoke-tests the noop flow shape", async () => {
    const out = await run(noopFlow, { delay: 0 }, { install_signal_handlers: false })
    expect(out.ok).toBe(true)
  })
})

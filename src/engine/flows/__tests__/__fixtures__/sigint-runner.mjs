import { run, compose, step } from "fascicle"

const flow = compose(
  "sigint_test",
  step("sigint_test_inner", async (_input, ctx) => {
    return new Promise((_resolve, reject) => {
      // Keep the event loop alive until aborted.
      const heartbeat = setInterval(() => undefined, 50)
      ctx.abort.addEventListener("abort", () => {
        clearInterval(heartbeat)
        reject(ctx.abort.reason)
      })
    })
  }),
)

const isAbortedError = (err) =>
  err !== null && typeof err === "object" && (err.kind === "aborted_error" || err.name === "aborted_error")

const start = async () => {
  try {
    await run(flow, {})
    process.exit(0)
  } catch (err) {
    if (isAbortedError(err)) {
      process.exit(130)
    }
    console.error("unexpected error:", err)
    process.exit(1)
  }
}

console.log("READY")
start()

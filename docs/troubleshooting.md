# Troubleshooting

This guide covers the most common issues encountered when using the Ridgeline CLI. Each section describes a specific failure mode, its symptoms, likely cause, and how to fix it.

## Authentication failures

Claude CLI returns an authentication error when Ridgeline tries to spawn a subprocess.

**Symptoms:** `Authentication failed` error when starting any pipeline stage.

**Cause:** Expired or missing Claude credentials. This can happen after a session timeout or when credentials were never configured.

**Fix:** Run `claude auth login` to re-authenticate. If you are using a subscription (OAuth), ensure your subscription is active. If you are using an API key, verify the key is set correctly in your environment. Subscription-based auth uses OAuth and refreshes automatically; API keys do not.

## Startup timeout

Claude subprocess is spawned but produces no output within the initial window.

**Symptoms:** `No output received within 120s of spawn (startup timeout)`.

**Cause:** Claude CLI is not installed, the installation is broken, or there is a network connectivity issue preventing the CLI from reaching the API.

**Fix:** Verify that `claude --version` runs successfully outside of Ridgeline. Check your network connection and ensure outbound HTTPS traffic is not blocked. Reinstall the Claude CLI if the binary is missing or corrupt.

## Stall timeout

Claude was producing output but then went silent for an extended period.

**Symptoms:** `No output received for 300s (stall timeout)`.

**Cause:** The task may be too complex for the model to process within the timeout window, the API may be rate-limiting requests, or there may be an API outage.

**Fix:** Retry the command. Check the Claude API status page for outages. If the issue persists, try a simpler model or break the task into smaller pieces.

## Missing input files

A pipeline stage fails because it cannot locate an artifact from a prior stage.

**Symptoms:** Errors such as `spec.md not found`, `constraints.md not found`, `research.md not found`, or `shape.md not found`.

**Cause:** Stages were run out of order, or a prior stage failed without producing its expected output.

**Fix:** Run stages in sequence. The `ridgeline create` command handles ordering automatically. If running stages individually, ensure each prior stage completed successfully before proceeding to the next.

## Budget exceeded

The build halts because cumulative costs have reached the configured limit.

**Symptoms:** Build stops with a budget-related message.

**Cause:** Cumulative API cost has exceeded the value set by `--max-budget-usd`.

**Fix:** Increase the budget limit by passing a higher value to `--max-budget-usd`. Review `budget.json` to understand the cost trajectory and identify which phases are consuming the most budget.

## Git repository required

The build fails immediately with a git-related error.

**Symptoms:** Git error at build start, before any pipeline stage runs.

**Cause:** Ridgeline uses git tags for checkpointing between phases. A git repository must be initialized in the project directory.

**Fix:** Run `git init` in the project directory before starting a build.

## Phase retry exhaustion

A phase fails after exhausting all retry attempts.

**Symptoms:** A phase is marked as failed after N attempts, and the pipeline stops.

**Cause:** The reviewer keeps rejecting the builder output, typically due to persistent quality or correctness issues that retries alone cannot resolve.

**Fix:** Check `.feedback.md` for details on what the reviewer is rejecting. Address the issues manually, then resume with `ridgeline build`.

## Network allowlist

Research agents produce incomplete or missing results due to blocked network requests.

**Symptoms:** Research output is incomplete, or network errors appear when running in sandbox mode.

**Cause:** The sandbox blocks requests to domains not on the allowlist.

**Fix:** Add the required domains to `.ridgeline/settings.json` under the `researchAllowlist` array. Alternatively, use `--unsafe` to disable sandboxing entirely (not recommended for untrusted projects).

## Sandbox detection

The build fails at startup because the required sandbox tool is not available.

**Symptoms:** Sandbox-related error immediately at build start.

**Cause:** The recommended sandbox tool (Greywall or bubblewrap) is not installed on the system.

**Fix:** Install the appropriate sandbox tool for your platform. On macOS, install Greywall. On Linux, install bubblewrap. If sandboxing is not needed, pass `--unsafe` to skip sandbox detection.

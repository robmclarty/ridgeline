# Helloworld Example

A minimal ridgeline example that builds a single `hello.js` script.

## Prerequisites

Ridgeline must be built first. From the repository root:

```bash
npm install
npm run build
```

## What's Here

- `hello.js` — the generated implementation (a `greet(name)` function)
- `package.json` — minimal project metadata
- `.ridgeline/builds/helloworld/` — the build spec, phases, and state from a completed run

## Running the Example

Run the generated script:

```bash
node hello.js
# Hello, World!
```

## Re-running from Scratch

To re-run the full ridgeline pipeline on this example, first clear the existing
state and then run the build. All commands should be run from this directory.

```bash
# Clean previous state
rm -f .ridgeline/builds/helloworld/state.json
rm -f .ridgeline/builds/helloworld/budget.json
rm -f .ridgeline/builds/helloworld/trajectory.jsonl
rm -f .ridgeline/builds/helloworld/handoff.md
rm -rf .ridgeline/builds/helloworld/phases
rm -f hello.js

# Re-plan and run (from this directory)
node ../../dist/cli.js plan helloworld
node ../../dist/cli.js run helloworld
```

You can also run plan and build in one step (run auto-plans if no phases exist):

```bash
node ../../dist/cli.js run helloworld
```

#!/usr/bin/env node
// Regenerate CLI baseline snapshots (help text, option-set JSON, .d.ts).
// One-shot utility used when intentional CLI changes shift the byte-equality
// snapshots under .ridgeline/builds/fascicle-migration/baseline/.
//
// Usage: node scripts/regen-cli-baselines.mjs

import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, copyFileSync, readdirSync } from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, "..")
const baselineDir = path.join(repoRoot, ".ridgeline/builds/fascicle-migration/baseline")

const helpDir = path.join(baselineDir, "help")
const optionsDir = path.join(baselineDir, "options")
const dtsDir = path.join(baselineDir, "dts")

const helpNames = readdirSync(helpDir).filter(f => f.endsWith(".txt")).map(f => f.replace(/\.txt$/, ""))
const optionNames = readdirSync(optionsDir).filter(f => f.endsWith(".json")).map(f => f.replace(/\.json$/, ""))

const runCliHelp = (name) => {
  // The top-level "ridgeline" baseline captures `ridgeline --help`.
  const args = name === "ridgeline" ? ["src/cli.ts", "--help"] : ["src/cli.ts", name, "--help"]
  return execFileSync("npx", ["tsx", ...args], { cwd: repoRoot, encoding: "utf8" })
}

console.log("Regenerating help/*.txt baselines …")
for (const name of helpNames) {
  try {
    const txt = runCliHelp(name)
    writeFileSync(path.join(helpDir, `${name}.txt`), txt)
    console.log(`  ✓ help/${name}.txt`)
  } catch (err) {
    console.error(`  ✘ help/${name}.txt — ${err.message}`)
  }
}

console.log("\nRegenerating options/*.json baselines …")
// Import the program lazily so cli.ts is parsed once
const { program } = await import(path.join(repoRoot, "src/cli.ts"))
const serializeOptions = (cmd) =>
  cmd.options
    .map((o) => ({
      flags: o.flags,
      description: o.description,
      defaultValue: o.defaultValue ?? null,
      mandatory: o.mandatory ?? false,
      hidden: o.hidden ?? false,
    }))
    .sort((a, b) => a.flags.localeCompare(b.flags))

for (const name of optionNames) {
  const cmd = name === "ridgeline" ? program : program.commands.find((c) => c.name() === name)
  if (!cmd) {
    console.error(`  ✘ options/${name}.json — unknown command`)
    continue
  }
  const json = JSON.stringify(serializeOptions(cmd), null, 2) + "\n"
  writeFileSync(path.join(optionsDir, `${name}.json`), json)
  console.log(`  ✓ options/${name}.json`)
}

console.log("\nRegenerating dts/*.d.ts baselines …")
const tmp = mkdtempSync(path.join(os.tmpdir(), "ridgeline-dts-regen-"))
try {
  execFileSync("npx", ["tsc", "--emitDeclarationOnly", "--outDir", tmp], {
    cwd: repoRoot,
    stdio: "pipe",
  })
  const dtsFiles = readdirSync(dtsDir).filter((f) => f.endsWith(".d.ts"))
  for (const file of dtsFiles) {
    const src = path.join(tmp, "commands", file)
    const dst = path.join(dtsDir, file)
    try {
      copyFileSync(src, dst)
      console.log(`  ✓ dts/${file}`)
    } catch {
      // index.d.ts lives at the top of the tsc output, not under commands/
      const altSrc = path.join(tmp, file)
      try {
        copyFileSync(altSrc, dst)
        console.log(`  ✓ dts/${file} (from root)`)
      } catch (err) {
        console.error(`  ✘ dts/${file} — ${err.message}`)
      }
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true })
}

console.log("\nDone. Re-run `npm run check` to verify.")

/**
 * Detect the --flavour / --flavor flag in argv and return its value, or null
 * if absent. Returns "" when --flavour appears with no following value.
 */
export const detectFlavourFlag = (argv: string[]): string | null => {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === "--flavour" || a === "--flavor") return argv[i + 1] ?? ""
    if (a.startsWith("--flavour=") || a.startsWith("--flavor=")) {
      const eq = a.indexOf("=")
      return a.slice(eq + 1)
    }
  }
  return null
}

export const flavourRemovedMessage = (flavourName: string): string => {
  const named = flavourName
    ? `Flavour "${flavourName}" removed in 0.8.2.`
    : "--flavour removed in 0.8.2."
  return [
    named,
    "Non-software flavours are no longer supported; drop the --flavour flag to use the default software flavour.",
  ].join("\n")
}

/**
 * Exit non-zero with a deprecation message when --flavour appears anywhere in
 * argv. Wired at the top of cli.ts so every subcommand surfaces the same
 * actionable error.
 */
export const enforceFlavourRemoved = (argv: string[]): void => {
  const flavour = detectFlavourFlag(argv)
  if (flavour === null) return
  console.error(flavourRemovedMessage(flavour))
  process.exit(1)
}

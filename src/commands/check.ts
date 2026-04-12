import { printInfo } from "../ui/output"
import { resolveFlavour } from "../engine/discovery/flavour.resolve"
import { loadFlavourConfig } from "../engine/discovery/flavour.config"
import { checkRecommendedSkills, formatSkillAvailability } from "../engine/discovery/skill.check"
import { loadSettings } from "../stores/settings"
import * as path from "node:path"

type CheckOptions = {
  flavour?: string
}

export const runCheck = (opts: CheckOptions): void => {
  const ridgelineDir = path.join(process.cwd(), ".ridgeline")
  const flavourName = opts.flavour ?? loadSettings(ridgelineDir).flavour ?? null
  const flavourDir = resolveFlavour(flavourName)

  if (!flavourDir) {
    printInfo("No flavour specified. Use --flavour <name> or set flavour in .ridgeline/settings.json")
    return
  }

  const flavourLabel = flavourName ?? path.basename(flavourDir)
  console.log("")
  printInfo(`Flavour: ${flavourLabel}`)
  console.log("")

  const flavourConfig = loadFlavourConfig(flavourDir)

  if (flavourConfig.recommendedSkills.length === 0) {
    console.log("  No recommended tools for this flavour.")
    console.log("")
    return
  }

  const availability = checkRecommendedSkills(flavourConfig.recommendedSkills)
  const display = formatSkillAvailability(availability)
  if (display) {
    console.log(display)
    console.log("")
  }
}

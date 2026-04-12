/** Media type detected from file extension. */
export type MediaType = "image" | "audio" | "video" | "text"

/** Region within a layout mockup image. */
export type LayoutRegion = {
  area: string
  content: string
  assets_referenced?: string[]
}

/** Single asset entry in the catalog. */
export type AssetEntry = {
  file: string
  hash: string
  mediaType: MediaType

  // Convention-derived (always present)
  category: string
  name: string
  subject: string
  state: string | null

  // Basic metadata (always present)
  fileSizeBytes: number
  extension: string

  // Image metadata (present when mediaType === "image")
  width?: number
  height?: number
  format?: string
  hasAlpha?: boolean
  channels?: number
  dominantColour?: string
  palette?: string[]
  isSpritesheet?: boolean
  frameCount?: number
  frameSize?: { w: number; h: number } | null
  frameDirection?: "horizontal" | "vertical" | null
  suggestedAnchor?: string
  suggestedZLayer?: string
  isTileable?: boolean

  // Classification metadata (present when AI-classified)
  isClassified?: boolean
  classificationConfidence?: "high" | "medium" | "low"

  // Vision (Tier 2) — present only with --describe or for layouts/ui
  description?: string
  facing?: string
  pose?: string
  styleTags?: string[]
  animationType?: "loop" | "once" | "ping-pong" | null
  layoutRegions?: LayoutRegion[]
  isReferenceOnly?: boolean
  mood?: string
}

/** Aggregate visual identity derived from all cataloged assets. */
export type VisualIdentity = {
  detectedStyle: string | null
  detectedPalette: string[]
  detectedResolution: string | null
  detectedScaling: string | null
}

/** Top-level asset catalog structure written to asset-catalog.json. */
export type AssetCatalog = {
  generatedAt: string
  assetDir: string
  isDescribed: boolean
  visualIdentity: VisualIdentity
  warnings: string[]
  assets: AssetEntry[]
}

/** Options for the catalog command. */
export type CatalogOptions = {
  assetDir?: string
  isDescribe: boolean
  isForce: boolean
  isPack: boolean
  isBatch: boolean
  isClassify: boolean
  model: string
  timeout: number
}

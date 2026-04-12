// Override colorthief's bundled types which reference DOM globals
// (HTMLImageElement, HTMLCanvasElement, etc.) unavailable in our
// Node.js-only lib config (ES2022, no "dom").
// We only use the Node.js API which accepts file path strings.
declare module "colorthief" {
  type RGBColor = [number, number, number]

  interface ColorThief {
    getColor(source: string, quality?: number): Promise<RGBColor>
    getPalette(source: string, colorCount?: number, quality?: number): Promise<RGBColor[]>
  }

  const colorThief: ColorThief
  export default colorThief
}

declare module "wcag-contrast" {
  export function luminance(a: number, b: number): number
  export function rgb(a: [number, number, number], b: [number, number, number]): number
  export function hex(a: string, b: string): number
  export function score(contrast: number): "AAA" | "AA" | "AA Large" | "Fail"
}

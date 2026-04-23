declare module "wcag-contrast" {
  export function hex(foreground: string, background: string): number
  export function rgb(
    a: [number, number, number],
    b: [number, number, number],
  ): number
  export function luminance(a: number, b: number): number
  export function score(contrast: number): "AAA" | "AA" | "AA Large" | "Fail"
}

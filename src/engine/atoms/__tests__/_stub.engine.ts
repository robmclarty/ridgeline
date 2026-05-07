import { vi, type Mock } from "vitest"
import type { Engine, GenerateOptions, GenerateResult } from "fascicle"

export type StubEngine<T = unknown> = Engine & {
  readonly generate: Mock<(opts: GenerateOptions<T>) => Promise<GenerateResult<T>>>
}

export const cannedGenerateResult = <T = unknown>(content: T): GenerateResult<T> => ({
  content,
  tool_calls: [],
  steps: [],
  usage: { input_tokens: 10, output_tokens: 20 },
  finish_reason: "stop",
  model_resolved: { provider: "stub", model_id: "stub-1" },
})

export const stubEngine = <T = unknown>(canned?: GenerateResult<T>): StubEngine<T> => {
  const generate = vi.fn(async (_opts: GenerateOptions<T>) =>
    canned ?? cannedGenerateResult<T>("ok" as unknown as T),
  )
  return {
    generate,
    register_alias: vi.fn(),
    unregister_alias: vi.fn(),
    resolve_alias: vi.fn(),
    list_aliases: vi.fn(),
    register_price: vi.fn(),
    resolve_price: vi.fn(),
    list_prices: vi.fn(),
    dispose: vi.fn(async () => {}),
  } as unknown as StubEngine<T>
}

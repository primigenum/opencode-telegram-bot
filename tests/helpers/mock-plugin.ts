import { mock as bunMock } from "bun:test";

const registered = new Set<string>();

export function registerMock(absPath: string, factory: () => Record<string, unknown>): void {
  if (registered.has(absPath)) return;
  registered.add(absPath);
  bunMock.module(absPath, factory as () => Record<string, unknown>);
}

export function clearMocks(): void {
  registered.clear();
}

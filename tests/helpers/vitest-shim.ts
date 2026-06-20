import * as bunTest from "bun:test";

const stubbedEnvs = new Map<string, string | undefined>();
const stubbedGlobals = new Map<string, unknown>();
const originalGlobalDescriptors = new Map<string, PropertyDescriptor | undefined>();
const trackedMocks: { mockRestore(): void; mockClear?(): void }[] = [];

function captureOriginalGlobal(key: string): void {
  if (originalGlobalDescriptors.has(key)) return;
  originalGlobalDescriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
}

function setGlobal(key: string, value: unknown): void {
  captureOriginalGlobal(key);
  (globalThis as Record<string, unknown>)[key] = value;
}

function restoreGlobal(key: string): void {
  const descriptor = originalGlobalDescriptors.get(key);
  if (descriptor) {
    Object.defineProperty(globalThis, key, descriptor);
  } else {
    delete (globalThis as Record<string, unknown>)[key];
  }
  originalGlobalDescriptors.delete(key);
}

export function stubEnv(key: string, value: string | undefined): void {
  if (!stubbedEnvs.has(key)) {
    stubbedEnvs.set(key, process.env[key]);
  }
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

export function stubGlobal<T>(key: string, value: T): void {
  if (!stubbedGlobals.has(key)) {
    stubbedGlobals.set(key, (globalThis as Record<string, unknown>)[key]);
  }
  setGlobal(key, value as unknown);
}

export function unstubAllEnvs(): void {
  for (const [key, previous] of stubbedEnvs) {
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
  stubbedEnvs.clear();
}

export function unstubAllGlobals(): void {
  for (const key of stubbedGlobals.keys()) {
    restoreGlobal(key);
  }
  stubbedGlobals.clear();
}

type AnyMock = ((...args: unknown[]) => unknown) & {
  mock: { calls: unknown[][]; results: unknown[] };
  mockImplementation: (impl: (...args: unknown[]) => unknown) => AnyMock;
  mockReturnValue: (value: unknown) => AnyMock;
  mockResolvedValue: (value: unknown) => AnyMock;
  mockRejectedValue: (value: unknown) => AnyMock;
  mockClear: () => AnyMock;
  mockReset: () => AnyMock;
  mockRestore: () => AnyMock;
};

type RestorableMock = { mockRestore: () => void; mockClear?: () => void };

function attachRestore(target: unknown, restore: () => void): RestorableMock {
  const wrapper: RestorableMock = {
    mockRestore: restore,
    mockClear: () => {
      const t = target as { mockClear?: () => void };
      t.mockClear?.();
    },
  };
  trackedMocks.push(wrapper);
  return wrapper;
}

export function fn<TArgs extends unknown[] = unknown[], TReturn = unknown>(
  implementation?: (...args: TArgs) => TReturn,
): AnyMock {
  const initialImpl = implementation ?? (() => undefined);
  const bunMock = bunTest.mock(initialImpl as (...args: unknown[]) => unknown);
  const wrapped = bunMock as unknown as AnyMock;
  attachRestore(wrapped, () => {
    bunMock.mockRestore();
  });
  return wrapped;
}

export function spyOn<T extends object, M extends PropertyKey>(
  obj: T,
  method: M,
): AnyMock {
  const bunSpy = bunTest.spyOn(obj as Record<string | symbol, unknown>, method as string);
  const wrapped = bunSpy as unknown as AnyMock;
  attachRestore(wrapped, () => {
    bunSpy.mockRestore();
  });
  return wrapped;
}

export function restoreAllMocks(): void {
  while (trackedMocks.length > 0) {
    const m = trackedMocks.pop();
    if (m) {
      try {
        m.mockRestore();
      } catch {
        // ignore — restore best-effort
      }
    }
  }
}

export function clearAllMocks(): void {
  for (const m of trackedMocks) {
    try {
      m.mockClear?.();
    } catch {
      // ignore
    }
  }
}

function resolveModuleSpecifier(path: string): string {
  if (path.startsWith(".") || path.startsWith("/") || path.startsWith("node:")) {
    return path;
  }
  return path;
}

export function mock(path: string, factory: unknown): void {
  if (typeof factory === "function") {
    const fn = factory as (...args: unknown[]) => unknown;
    // Detect the vitest importOriginal pattern: factory is async and takes
    // an importOriginal callback as its only argument.
    if (fn.length >= 1) {
      const importOriginal = <T = unknown>(): Promise<T> =>
        import(resolveModuleSpecifier(path)) as Promise<T>;
      const adapted: () => unknown = () => (factory as (io: typeof importOriginal) => unknown)(importOriginal);
      bunTest.mock.module(resolveModuleSpecifier(path), adapted as () => Record<string, unknown>);
      return;
    }
    bunTest.mock.module(resolveModuleSpecifier(path), factory as () => Record<string, unknown>);
    return;
  }
  bunTest.mock.module(resolveModuleSpecifier(path), factory as () => Record<string, unknown>);
}

export function doMock(path: string, factory: () => unknown): void {
  bunTest.mock.module(resolveModuleSpecifier(path), factory as () => Record<string, unknown>);
}

export function doUnmock(path: string): void {
  bunTest.mock.module(resolveModuleSpecifier(path), () => import(path));
}

export function hoisted<T>(factory: () => T): T {
  return factory();
}

export function useFakeTimers(_options?: unknown): void {
  bunTest.jest.useFakeTimers();
}

export function useRealTimers(): void {
  bunTest.jest.useRealTimers();
}

export function advanceTimersByTime(ms: number): void {
  const currentMocked = resolveCurrentMockedTime();
  bunTest.setSystemTime(new Date(currentMocked + ms));
}

export async function advanceTimersByTimeAsync(ms: number): Promise<void> {
  const currentMocked = resolveCurrentMockedTime();
  bunTest.setSystemTime(new Date(currentMocked + ms));
  await flushMicrotasks();
}

function resolveCurrentMockedTime(): number {
  try {
    return bunTest.jest.now();
  } catch {
    return Date.now();
  }
}

export async function runAllTimersAsync(): Promise<void> {
  while (bunTest.jest.getTimerCount() > 0) {
    bunTest.jest.runAllTimers();
    await flushMicrotasks();
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 3; i += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

export function setSystemTime(date?: Date | string | number): void {
  bunTest.setSystemTime(date);
}

export async function waitFor<T>(
  callback: () => T | Promise<T>,
  options?: { timeout?: number; interval?: number },
): Promise<T> {
  const timeout = options?.timeout ?? 5000;
  const interval = options?.interval ?? 50;
  const start = Date.now();
  let lastError: unknown;
  while (Date.now() - start < timeout) {
    try {
      return await callback();
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
  throw lastError ?? new Error("vi.waitFor timed out");
}

export async function importActual<T = unknown>(path: string): Promise<T> {
  return (await import(path)) as T;
}

export function mocked<T>(value: T): T {
  return value;
}

export function resetModules(): void {
  // bun has no public resetModules API. Tests that relied on this typically
  // exercised vitest's module cache; under bun, manual `await import()` after
  // `mock.module()` already returns a fresh binding, so most uses degrade
  // gracefully. We keep the call as a documented no-op for source compat.
}

export const vi = {
  fn,
  spyOn,
  mock,
  doMock,
  doUnmock,
  hoisted,
  stubEnv,
  stubGlobal,
  unstubAllEnvs,
  unstubAllGlobals,
  useFakeTimers,
  useRealTimers,
  advanceTimersByTime,
  advanceTimersByTimeAsync,
  runAllTimersAsync,
  setSystemTime,
  waitFor,
  resetModules,
  restoreAllMocks,
  clearAllMocks,
  importActual,
  mocked,
};

export const describe = bunTest.describe;
export const it = bunTest.it;
export const test = bunTest.test;
export const expect = bunTest.expect;
export const beforeAll = bunTest.beforeAll;
export const beforeEach = bunTest.beforeEach;
export const afterAll = bunTest.afterAll;
export const afterEach = bunTest.afterEach;
export { mock as bunMock, spyOn as bunSpyOn };

export const shim = {
  describe,
  it,
  test,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  afterEach,
  vi,
  mock,
  spyOn,
  setSystemTime,
  jest: bunTest.jest,
};

export default shim;

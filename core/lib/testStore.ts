import type { Store } from "./store";

/** Minimal in-memory Store for tests — shared by storage.test.ts,
 * uiState.test.ts, and config.test.ts so each doesn't hand-roll its own.
 * Not a *.test.ts file itself so vitest won't try to run it as a suite. */
export function createMemoryStore(): Store {
  const map = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return map.get(key) as T | undefined;
    },
    async set(key: string, value: unknown) {
      map.set(key, value);
    },
  };
}

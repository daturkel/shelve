import { showErrorToast } from "./modal";

export interface PersistResult<T> {
  /** Whether `save` succeeded. Callers that push a mutation to the sync
   * server after persisting locally (folders.ts, rail.ts, trash.ts) must
   * gate that push on this — otherwise a locally-reverted change (see
   * `reverted` below) would still get pushed, diverging local and remote
   * state. */
  ok: boolean;
  /** Set when `save` failed and `reload` succeeded: the last
   * successfully persisted value, for the caller to restore onto ctx. */
  reverted?: T;
}

/** Shared by every entry point's rerender()/persistUiState(): the
 * folder/rail/trash UI is optimistic (mutate ctx.state/ctx.uiState in
 * memory, then persist), so a rejected write has to be reported and
 * rolled back to whatever's actually in storage — otherwise the UI keeps
 * showing a change that silently reverts on the next reload. `save`
 * performs the write and is expected to throw on failure; `reload`
 * re-reads the last successfully persisted value. */
export async function persistOrRevert<T>(
  save: () => Promise<void>,
  reload: () => Promise<T>,
): Promise<PersistResult<T>> {
  try {
    await save();
    return { ok: true };
  } catch (e) {
    console.error("shelve: failed to persist", e);
    let reverted: T | undefined;
    try {
      reverted = await reload();
    } catch (reloadError) {
      // Storage is broken badly enough that even a read fails (not just
      // the write) — nothing to restore onto ctx, but still surface the
      // original write failure below rather than letting either error go
      // unhandled.
      console.error("shelve: failed to reload after a failed persist", reloadError);
    }
    showErrorToast(`Couldn't save your change: ${e instanceof Error ? e.message : String(e)}`);
    return { ok: false, reverted };
  }
}

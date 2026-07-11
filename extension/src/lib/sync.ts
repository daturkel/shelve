import type { Entry, Folder, ResourceKind, Workspace } from "@shelve/shared";
import { getConfig } from "./config";
import type { State } from "./storage";

/**
 * Merge one resource array: union by id, newer `updated_at` wins on
 * conflict. Records present only locally are kept as-is — we never delete
 * on pull, only on an explicit pushDelete() call. See design doc for why
 * (a pull-driven delete-by-omission reintroduces the wipe risk we moved
 * away from full-snapshot writes to avoid).
 */
export function mergeArray<T extends { id: string; updated_at: number }>(
  local: T[],
  remote: T[],
): T[] {
  const merged = new Map<string, T>();
  for (const item of local) merged.set(item.id, item);
  for (const item of remote) {
    const existing = merged.get(item.id);
    if (!existing || item.updated_at > existing.updated_at) {
      merged.set(item.id, item);
    }
  }
  return [...merged.values()];
}

export interface RemoteState {
  workspaces: Workspace[];
  folders: Folder[];
  entries: Entry[];
}

export function mergeState(local: State, remote: RemoteState): State {
  return {
    workspaces: mergeArray(local.workspaces, remote.workspaces),
    folders: mergeArray(local.folders, remote.folders),
    entries: mergeArray(local.entries, remote.entries),
  };
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response | null> {
  const config = await getConfig();
  if (!config) return null;
  try {
    return await fetch(`${config.workerUrl}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${config.apiToken}`,
        "Content-Type": "application/json",
      },
    });
  } catch (e) {
    console.error("shelve sync: request failed", path, e);
    return null;
  }
}

/** Fire-and-forget push of a single created/updated resource. Best-effort:
 * failures are logged, not surfaced to the UI or retried — there is no
 * offline queue in this v1. */
export async function pushResource(
  kind: ResourceKind,
  resource: { id: string; updated_at: number },
): Promise<void> {
  await apiFetch(`/${kind}/${resource.id}`, {
    method: "POST",
    body: JSON.stringify(resource),
  });
}

export async function pushDelete(kind: ResourceKind, id: string): Promise<void> {
  await apiFetch(`/${kind}/${id}`, { method: "DELETE" });
}

/** Fetch the raw remote snapshot with no merge into local state — used for
 * a standalone connectivity check (e.g. the options page confirming a
 * Worker URL/token actually works before the user ever opens the newtab
 * page). Returns null if sync isn't configured or the request fails. */
export async function fetchRemoteState(): Promise<RemoteState | null> {
  const res = await apiFetch("/state");
  if (!res || !res.ok) return null;
  return (await res.json()) as RemoteState;
}

/** Pull the full remote snapshot and merge it into local state. Returns
 * null (leaving local state untouched) if sync isn't configured or the
 * request fails. */
export async function pullAndMerge(local: State): Promise<State | null> {
  const remote = await fetchRemoteState();
  if (!remote) return null;
  return mergeState(local, remote);
}

/** Push every local record once, tier by tier (workspaces, then folders,
 * then entries — parents must exist server-side before children, or the
 * FK constraint on the Worker's D1 schema rejects the child). Idempotent:
 * pushResource is upsert-by-recency, so re-pushing an already-synced record
 * is a harmless no-op. Exists to catch anything that was created locally
 * but never successfully synced — most notably the default "Home"
 * workspace from first run, which nothing else ever explicitly pushes. */
export async function pushAll(state: State): Promise<void> {
  await Promise.all(state.workspaces.map((w) => pushResource("workspaces", w)));
  await Promise.all(state.folders.map((f) => pushResource("folders", f)));
  await Promise.all(state.entries.map((e) => pushResource("entries", e)));
}

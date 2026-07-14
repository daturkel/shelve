import { SCHEMA_VERSION, type Entry, type Folder, type ResourceKind, type Workspace } from "@shelve/shared";
import { getConfig } from "./config";
import type { State } from "./storage";

/**
 * Merge one resource array: union by id, newer `updated_at` wins on
 * conflict. Records present only locally are kept as-is — we never delete
 * on pull, only on an explicit pushDelete() call. See design doc for why
 * (a pull-driven delete-by-omission reintroduces the wipe risk we moved
 * away from full-snapshot writes to avoid).
 */
export function mergeArray<T extends { id: string; updated_at: number }>(local: T[], remote: T[]): T[] {
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

export type SyncStatus = "unconfigured" | "connected" | "error";

// Per-page-load, in-memory only (same scoping as `compatibility` below) —
// not worth persisting across reloads for what's ultimately just a
// status dot's tooltip.
let syncStatus: SyncStatus = "unconfigured";
let lastSyncedAt: number | null = null;
const statusListeners = new Set<(status: SyncStatus, lastSyncedAt: number | null) => void>();

function setSyncStatus(status: SyncStatus): void {
  syncStatus = status;
  if (status === "connected") lastSyncedAt = Date.now();
  for (const listener of statusListeners) listener(syncStatus, lastSyncedAt);
}

export function getSyncStatus(): { status: SyncStatus; lastSyncedAt: number | null } {
  return { status: syncStatus, lastSyncedAt };
}

/** Registers a callback for sync status changes (the toolbar's status
 * dot). Call once at module scope, same one-registration-only rule as
 * tabsPanel.ts's watchTabs — calling this from inside a render function
 * would stack a duplicate listener on every re-render. */
export function onSyncStatusChange(listener: (status: SyncStatus, lastSyncedAt: number | null) => void): void {
  statusListeners.add(listener);
}

async function apiFetch(path: string, init: RequestInit = {}): Promise<Response | null> {
  const config = await getConfig();
  if (!config) {
    setSyncStatus("unconfigured");
    return null;
  }

  // The client and a self-hosted Worker are deployed on completely
  // independent schedules, so never assume they're in lock-step. Gate
  // every request except /health itself (which checkCompatibility()
  // depends on) behind a confirmed-compatible schema — a client ahead of
  // a Worker that hasn't had a required migration applied could otherwise
  // write columns the Worker silently drops, or merge in remote records
  // missing a field the local client expects, quietly losing data.
  if (path !== "/health") {
    const status = await checkCompatibility();
    if (status === "incompatible") {
      console.warn(`shelve sync: skipping ${path} — connected Worker's schema is out of date`);
      setSyncStatus("error");
      return null;
    }
  }

  try {
    const res = await fetch(`${config.workerUrl}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${config.apiToken}`,
        "Content-Type": "application/json",
      },
    });
    setSyncStatus(res.ok ? "connected" : "error");
    return res;
  } catch (e) {
    console.error("shelve sync: request failed", path, e);
    setSyncStatus("error");
    return null;
  }
}

export interface WorkerHealth {
  ok: boolean;
  version: string;
  schemaVersion: number;
}

/** Hits the Worker's /health endpoint directly. Used internally by the
 * compatibility gate above, and by the options page to show the connected
 * Worker's version. Returns null if sync isn't configured or the request
 * fails. */
export async function fetchWorkerHealth(): Promise<WorkerHealth | null> {
  const res = await apiFetch("/health");
  if (!res || !res.ok) return null;
  return (await res.json()) as WorkerHealth;
}

export function isWorkerSchemaCompatible(health: WorkerHealth): boolean {
  return health.schemaVersion >= SCHEMA_VERSION;
}

// Memoized per page load (newtab/popup/options each get their own module
// instance, so this is naturally scoped per page) so every push/pull
// after the first doesn't pay for an extra round-trip to /health.
// "unknown" (health check itself failed — e.g. transient network issue)
// deliberately fails open: only a *confirmed* outdated schema blocks
// requests, consistent with sync's existing best-effort, never-blocking
// failure handling.
let compatibility: Promise<"compatible" | "incompatible" | "unknown"> | null = null;

async function checkCompatibility(): Promise<"compatible" | "incompatible" | "unknown"> {
  if (!compatibility) {
    compatibility = fetchWorkerHealth().then((health) =>
      health ? (isWorkerSchemaCompatible(health) ? "compatible" : "incompatible") : "unknown",
    );
  }
  return compatibility;
}

/** Fire-and-forget push of a single created/updated resource. Best-effort:
 * failures are logged, not surfaced to the UI or retried — there is no
 * offline queue in this v1. */
export async function pushResource(kind: ResourceKind, resource: { id: string; updated_at: number }): Promise<void> {
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

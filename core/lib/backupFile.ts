import type { RemoteState } from "./sync";

/** Triggers a browser download of `data` as pretty-printed JSON — used by
 * the options page's backup export and Toby export buttons. */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function readFileAsJson(file: File): Promise<unknown> {
  return JSON.parse(await file.text());
}

/** Type guard for a file picked via the options page's "Restore backup"
 * flow — confirms it has the shape of a full state export before handing
 * it to mergeState, rather than trusting any arbitrary JSON file. */
export function isRemoteState(value: unknown): value is RemoteState {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { workspaces?: unknown }).workspaces) &&
    Array.isArray((value as { folders?: unknown }).folders) &&
    Array.isArray((value as { entries?: unknown }).entries)
  );
}

import { getStore } from "./store";

export interface SyncConfig {
  workerUrl: string;
  apiToken: string;
}

const CONFIG_KEY = "shelve_config";

export async function getConfig(): Promise<SyncConfig | null> {
  const config = await getStore().get<SyncConfig>(CONFIG_KEY);
  if (!config?.workerUrl || !config?.apiToken) return null;
  return config;
}

export async function setConfig(config: SyncConfig): Promise<void> {
  await getStore().set(CONFIG_KEY, config);
}

/** A Worker URL needs an explicit http(s) scheme. Without one, `fetch()`
 * doesn't reject it outright — it silently resolves the string as a
 * same-origin relative path instead (e.g. a URL typed as
 * "shelve-worker.example.workers.dev" becomes a request to
 * "<this page's origin>/shelve-worker.example.workers.dev/..."), so a
 * missing "https://" fails in a confusing, hard-to-diagnose way rather
 * than an obvious one. Validate before ever calling setConfig with it. */
export function isValidWorkerUrl(url: string): boolean {
  try {
    const protocol = new URL(url).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

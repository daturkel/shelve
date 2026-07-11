export interface SyncConfig {
  workerUrl: string;
  apiToken: string;
}

const CONFIG_KEY = "shelve_config";

export async function getConfig(): Promise<SyncConfig | null> {
  const result = await chrome.storage.local.get(CONFIG_KEY);
  const config = result[CONFIG_KEY] as SyncConfig | undefined;
  if (!config?.workerUrl || !config?.apiToken) return null;
  return config;
}

export async function setConfig(config: SyncConfig): Promise<void> {
  await chrome.storage.local.set({ [CONFIG_KEY]: config });
}

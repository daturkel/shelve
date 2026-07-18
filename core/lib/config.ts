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

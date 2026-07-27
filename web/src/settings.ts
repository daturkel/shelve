import { getConfig, setConfig, isValidWorkerUrl } from "@shelve/core/lib/config";
import {
  fetchRemoteState,
  fetchWorkerHealth,
  isWorkerSchemaCompatible,
  mergeState,
  pushAll,
} from "@shelve/core/lib/sync";
import { setUiState, type UiState } from "@shelve/core/lib/uiState";
import { loadState, saveState } from "@shelve/core/lib/storage";
import { importToby, exportToby, isTobyExport } from "@shelve/core/lib/tobyImport";
import { downloadJson, readFileAsJson, isRemoteState } from "@shelve/core/lib/backupFile";
import { applyTheme } from "@shelve/core/lib/theme";
import { showConfirm } from "@shelve/core/lib/modal";

/** The web app's settings/connect screen — Worker URL/token, theme,
 * backup/Toby import-export, modeled on extension/src/options/main.ts
 * but web-specific in a few ways: no showOnNewTab/closeTabOnSave (both
 * are extension-only concepts, meaningless on web since
 * TabActions.close is a no-op), a Disconnect action (no separate
 * options page exists on web to recover from a bad token otherwise),
 * and a full reload on save rather than an in-place status refresh —
 * core/lib/sync.ts's checkCompatibility() result is memoized for the
 * page's lifetime with no cache-bust export, so an in-place config
 * change would silently keep checking the old Worker's health.
 *
 * Takes `uiState` from the caller (main.ts's `ctx.uiState`) rather than
 * fetching its own copy — main.ts holds `ctx.uiState` for the app's
 * whole lifetime, and a second, disconnected UiState object here would
 * let the theme toggle silently diverge from it until a hard reload. */
export async function buildSettings(uiState: UiState, onClose: () => void): Promise<HTMLElement> {
  const config = await getConfig();

  const wrap = document.createElement("div");
  wrap.className = "settings";

  const titleRow = document.createElement("div");
  titleRow.className = "title-row";
  const backBtn = document.createElement("button");
  backBtn.className = "back-btn";
  backBtn.textContent = "← Back";
  backBtn.onclick = onClose;
  titleRow.appendChild(backBtn);
  const h1 = document.createElement("h1");
  h1.textContent = "Settings";
  titleRow.appendChild(h1);
  wrap.appendChild(titleRow);

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.textContent = "Connect to your self-hosted Cloudflare Worker to sync across devices.";
  wrap.appendChild(hint);

  const urlField = document.createElement("div");
  urlField.className = "field";
  const urlLabel = document.createElement("label");
  urlLabel.textContent = "Worker URL";
  const urlInput = document.createElement("input");
  urlInput.type = "text";
  urlInput.placeholder = "https://shelve-worker.your-name.workers.dev";
  urlInput.value = config?.workerUrl ?? "";
  urlField.append(urlLabel, urlInput);
  wrap.appendChild(urlField);

  const tokenField = document.createElement("div");
  tokenField.className = "field";
  const tokenLabel = document.createElement("label");
  tokenLabel.textContent = "API Token";
  const tokenInput = document.createElement("input");
  tokenInput.type = "password";
  tokenInput.placeholder = "your API_TOKEN secret";
  tokenInput.value = config?.apiToken ?? "";
  tokenField.append(tokenLabel, tokenInput);
  wrap.appendChild(tokenField);

  const workerStatus = document.createElement("div");
  workerStatus.className = "status";
  wrap.appendChild(workerStatus);

  function setWorkerStatus(text: string, kind: "" | "success" | "error" = "") {
    workerStatus.textContent = text;
    workerStatus.className = kind ? `status ${kind}` : "status";
  }

  async function refreshWorkerStatus() {
    const health = await fetchWorkerHealth();
    if (!health) {
      setWorkerStatus("");
      return;
    }
    if (!isWorkerSchemaCompatible(health)) {
      setWorkerStatus(
        `Worker: v${health.version} — its schema is out of date. Sync is paused until you upgrade it (see README.md's "Upgrading" section).`,
        "error",
      );
      return;
    }
    setWorkerStatus(`Worker: v${health.version}`, "success");
  }
  if (config) void refreshWorkerStatus();

  const themeField = document.createElement("div");
  themeField.className = "field";
  const themeLabel = document.createElement("label");
  themeLabel.textContent = "Theme";
  themeField.appendChild(themeLabel);

  const themeToggle = document.createElement("div");
  themeToggle.className = "theme-toggle";
  const themeOptions: [UiState["theme"], string][] = [
    ["light", "Light"],
    ["dark", "Dark"],
    ["auto", "Auto"],
  ];
  for (const [value, label] of themeOptions) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "theme-toggle-btn" + (uiState.theme === value ? " active" : "");
    btn.textContent = label;
    btn.onclick = async () => {
      uiState.theme = value;
      await setUiState(uiState);
      applyTheme(uiState.theme);
      for (const sibling of Array.from(themeToggle.children)) sibling.classList.remove("active");
      btn.classList.add("active");
    };
    themeToggle.appendChild(btn);
  }
  themeField.appendChild(themeToggle);
  wrap.appendChild(themeField);

  const actionsRow = document.createElement("div");
  actionsRow.className = "data-row";

  const saveBtn = document.createElement("button");
  saveBtn.className = "save-btn";
  saveBtn.textContent = "Save";
  actionsRow.appendChild(saveBtn);

  const disconnectBtn = document.createElement("button");
  disconnectBtn.className = "menu-btn";
  disconnectBtn.textContent = "Disconnect";
  disconnectBtn.hidden = !config;
  actionsRow.appendChild(disconnectBtn);
  wrap.appendChild(actionsRow);

  const status = document.createElement("div");
  status.className = "status";
  wrap.appendChild(status);

  saveBtn.onclick = async () => {
    const workerUrl = urlInput.value.trim().replace(/\/$/, "");
    const apiToken = tokenInput.value.trim();
    if (!workerUrl || !apiToken) {
      status.textContent = "Both fields are required.";
      status.className = "status";
      return;
    }
    if (!isValidWorkerUrl(workerUrl)) {
      status.textContent = "Worker URL must start with http:// or https://.";
      status.className = "status error";
      return;
    }
    try {
      await setConfig({ workerUrl, apiToken });
    } catch (e) {
      status.textContent = `Couldn't save: ${e instanceof Error ? e.message : String(e)}`;
      status.className = "status error";
      return;
    }

    status.textContent = "Saved. Checking connection…";
    status.className = "status";
    const remote = await fetchRemoteState();
    if (!remote) {
      status.textContent = "Saved, but couldn't connect — check the URL and token.";
      status.className = "status error";
      return;
    }

    const workspaceCount = remote.workspaces.filter((w) => w.deleted_at === null).length;
    const folderCount = remote.folders.filter((f) => f.deleted_at === null).length;
    const entryCount = remote.entries.filter((e) => e.deleted_at === null).length;
    status.textContent =
      folderCount === 0 && entryCount === 0
        ? "Connected. No existing data yet — you're starting fresh. Reloading…"
        : `Connected. Found ${workspaceCount} workspace${workspaceCount === 1 ? "" : "s"}, ${folderCount} folder${folderCount === 1 ? "" : "s"}, and ${entryCount} saved link${entryCount === 1 ? "" : "s"} — reloading…`;
    status.className = "status success";
    setTimeout(() => location.reload(), 1200);
  };

  disconnectBtn.onclick = async () => {
    const ok = await showConfirm("Disconnect from this Worker?", "Disconnect");
    if (!ok) return;
    try {
      await setConfig({ workerUrl: "", apiToken: "" });
    } catch (e) {
      status.textContent = `Couldn't disconnect: ${e instanceof Error ? e.message : String(e)}`;
      status.className = "status error";
      return;
    }
    location.reload();
  };

  // ---------- Data: backup and Toby migration ----------

  const dataTitle = document.createElement("h2");
  dataTitle.textContent = "Data";
  wrap.appendChild(dataTitle);

  const dataHint = document.createElement("p");
  dataHint.className = "hint";
  dataHint.textContent = "Back up your folders, or migrate to/from Toby.";
  wrap.appendChild(dataHint);

  const dataStatus = document.createElement("div");
  dataStatus.className = "status";

  function setDataStatus(text: string, kind: "" | "success" | "error" = "") {
    dataStatus.textContent = text;
    dataStatus.className = kind ? `status ${kind}` : "status";
  }

  const backupRow = document.createElement("div");
  backupRow.className = "data-row";

  const exportBackupBtn = document.createElement("button");
  exportBackupBtn.className = "menu-btn";
  exportBackupBtn.textContent = "Export backup";
  exportBackupBtn.onclick = async () => {
    const state = await loadState();
    const date = new Date().toISOString().slice(0, 10);
    downloadJson(`shelve-backup-${date}.json`, state);
    setDataStatus("Backup downloaded.", "success");
  };
  backupRow.appendChild(exportBackupBtn);

  const importBackupBtn = document.createElement("button");
  importBackupBtn.className = "menu-btn";
  importBackupBtn.textContent = "Import backup";
  const backupFileInput = document.createElement("input");
  backupFileInput.type = "file";
  backupFileInput.accept = ".json";
  backupFileInput.hidden = true;
  importBackupBtn.onclick = () => backupFileInput.click();
  backupFileInput.onchange = async () => {
    const file = backupFileInput.files?.[0];
    backupFileInput.value = "";
    if (!file) return;
    try {
      const parsed = await readFileAsJson(file);
      if (!isRemoteState(parsed)) {
        setDataStatus("That doesn't look like a Shelve backup file.", "error");
        return;
      }
      const local = await loadState();
      const merged = mergeState(local, parsed);
      await saveState(merged);
      void pushAll(merged);
      setDataStatus("Backup imported and merged in.", "success");
    } catch (e) {
      setDataStatus(`Couldn't read that file: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  };
  backupRow.append(importBackupBtn, backupFileInput);
  wrap.appendChild(backupRow);

  const tobyRow = document.createElement("div");
  tobyRow.className = "data-row";

  const exportTobyBtn = document.createElement("button");
  exportTobyBtn.className = "menu-btn";
  exportTobyBtn.textContent = "Export to Toby format";
  exportTobyBtn.onclick = async () => {
    const state = await loadState();
    const date = new Date().toISOString().slice(0, 10);
    downloadJson(`shelve-toby-export-${date}.json`, exportToby(state));
    setDataStatus(
      "Toby-format export downloaded. Note-only entries (no URL) aren't included — Toby has no equivalent.",
      "success",
    );
  };
  tobyRow.appendChild(exportTobyBtn);

  const importTobyBtn = document.createElement("button");
  importTobyBtn.className = "menu-btn";
  importTobyBtn.textContent = "Import from Toby";
  const tobyFileInput = document.createElement("input");
  tobyFileInput.type = "file";
  tobyFileInput.accept = ".json";
  tobyFileInput.hidden = true;
  importTobyBtn.onclick = () => tobyFileInput.click();
  tobyFileInput.onchange = async () => {
    const file = tobyFileInput.files?.[0];
    tobyFileInput.value = "";
    if (!file) return;
    try {
      const parsed = await readFileAsJson(file);
      if (!isTobyExport(parsed)) {
        setDataStatus("That doesn't look like a Toby export file.", "error");
        return;
      }
      const state = await loadState();
      const result = importToby(state, parsed);
      await saveState(state);
      void pushAll(state);
      setDataStatus(
        `Imported ${result.folders.length} folder${result.folders.length === 1 ? "" : "s"} and ${result.entries.length} tab${result.entries.length === 1 ? "" : "s"} from Toby. Tags weren't imported (not supported yet).`,
        "success",
      );
    } catch (e) {
      setDataStatus(`Couldn't read that file: ${e instanceof Error ? e.message : String(e)}`, "error");
    }
  };
  tobyRow.append(importTobyBtn, tobyFileInput);
  wrap.appendChild(tobyRow);

  wrap.appendChild(dataStatus);

  return wrap;
}

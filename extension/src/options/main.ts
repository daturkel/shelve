import { getConfig, setConfig } from "@shelve/core/lib/config";
import {
  fetchRemoteState,
  fetchWorkerHealth,
  isWorkerSchemaCompatible,
  mergeState,
  pushAll,
} from "@shelve/core/lib/sync";
import { getUiState, setUiState, type UiState } from "@shelve/core/lib/uiState";
import { loadState, saveState } from "@shelve/core/lib/storage";
import { importToby, exportToby, isTobyExport } from "@shelve/core/lib/tobyImport";
import { downloadJson, readFileAsJson, isRemoteState } from "@shelve/core/lib/backupFile";
import { applyTheme } from "@shelve/core/lib/theme";
import { setStore } from "@shelve/core/lib/store";
import { chromeStore } from "../lib/chromeStore";

setStore(chromeStore);

const app = document.getElementById("app")!;

async function render() {
  const config = await getConfig();
  const uiState = await getUiState();
  applyTheme(uiState.theme);

  app.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "options";

  const titleRow = document.createElement("div");
  titleRow.className = "title-row";
  const h1 = document.createElement("h1");
  h1.textContent = "Shelve";
  titleRow.appendChild(h1);
  const version = document.createElement("span");
  version.className = "version";
  // Read live from the manifest rather than hardcoding, so it can never
  // drift from the actual installed version.
  version.textContent = `v${chrome.runtime.getManifest().version}`;
  titleRow.appendChild(version);
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

  // Fetched fresh (not cached) each time this runs — on initial load if
  // already configured, and again right after a successful Save — so this
  // always reflects the Worker actually behind the currently-saved
  // URL/token, not a stale check from a previous session.
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
    // Applies immediately (rather than waiting for the Save button, which
    // only persists Worker URL/token) and persists to uiState right away,
    // same as the checkboxes below — re-renders so the active-button
    // highlight moves without needing a page reload.
    btn.onclick = async () => {
      uiState.theme = value;
      await setUiState(uiState);
      applyTheme(uiState.theme);
      void render();
    };
    themeToggle.appendChild(btn);
  }
  themeField.appendChild(themeToggle);
  wrap.appendChild(themeField);

  const newtabField = document.createElement("div");
  newtabField.className = "field field-checkbox";
  const newtabLabel = document.createElement("label");
  const newtabCheckbox = document.createElement("input");
  newtabCheckbox.type = "checkbox";
  newtabCheckbox.checked = uiState.showOnNewTab;
  newtabLabel.append(newtabCheckbox, " Show Shelve when opening a new tab");
  newtabField.appendChild(newtabLabel);
  wrap.appendChild(newtabField);

  const newtabHint = document.createElement("p");
  newtabHint.className = "hint";
  newtabHint.textContent =
    "When off, new tabs show Chrome's normal default page. Open Shelve anytime from the toolbar button.";
  wrap.appendChild(newtabHint);

  // Mutates the shared uiState object (rather than spreading a stale
  // page-load snapshot into setUiState) so toggling this checkbox and
  // then the one below don't clobber each other's change.
  newtabCheckbox.onchange = async () => {
    uiState.showOnNewTab = newtabCheckbox.checked;
    await setUiState(uiState);
  };

  const closeTabField = document.createElement("div");
  closeTabField.className = "field field-checkbox";
  const closeTabLabel = document.createElement("label");
  const closeTabCheckbox = document.createElement("input");
  closeTabCheckbox.type = "checkbox";
  closeTabCheckbox.checked = uiState.closeTabOnSave;
  closeTabLabel.append(closeTabCheckbox, " Close tabs after saving them");
  closeTabField.appendChild(closeTabLabel);
  wrap.appendChild(closeTabField);

  const closeTabHint = document.createElement("p");
  closeTabHint.className = "hint";
  closeTabHint.textContent =
    "When on, dragging or saving a tab into a folder closes it afterward. Off by default — saving stays non-destructive unless you turn this on.";
  wrap.appendChild(closeTabHint);

  closeTabCheckbox.onchange = async () => {
    uiState.closeTabOnSave = closeTabCheckbox.checked;
    await setUiState(uiState);
  };

  const saveBtn = document.createElement("button");
  saveBtn.className = "save-btn";
  saveBtn.textContent = "Save";
  wrap.appendChild(saveBtn);

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
    await setConfig({ workerUrl, apiToken });

    // Confirm the URL/token actually work right here, rather than leaving
    // the user to wonder why nothing happened until they open a new tab —
    // especially important when setting up a device that should already
    // have existing folders waiting on the Worker.
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
        ? "Connected. No existing data yet — you're starting fresh."
        : `Connected. Found ${workspaceCount} workspace${workspaceCount === 1 ? "" : "s"}, ${folderCount} folder${folderCount === 1 ? "" : "s"}, and ${entryCount} saved tab${entryCount === 1 ? "" : "s"} — open a new tab to sync them in.`;
    status.className = "status success";
    void refreshWorkerStatus();
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

  // Native Shelve backup: reuses mergeState() on import, since our own
  // ids are meaningful — safe to re-import the same backup file twice,
  // or one that partially overlaps what's already local.
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

  // Toby import/export: fresh ids on import (Toby's data has no id
  // compatible with ours), note-only entries dropped on export (Toby's
  // card format is always URL-backed), tags ignored both ways.
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

  app.appendChild(wrap);
}

render();

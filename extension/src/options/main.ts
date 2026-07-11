import { getConfig, setConfig } from "../lib/config";
import { fetchRemoteState } from "../lib/sync";
import { getUiState, setUiState } from "../lib/uiState";

const app = document.getElementById("app")!;

async function render() {
  const config = await getConfig();
  const uiState = await getUiState();

  app.innerHTML = "";

  const wrap = document.createElement("div");
  wrap.className = "options";

  const h1 = document.createElement("h1");
  h1.textContent = "Shelve";
  wrap.appendChild(h1);

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

  newtabCheckbox.onchange = async () => {
    await setUiState({ ...uiState, showOnNewTab: newtabCheckbox.checked });
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

    const folderCount = remote.folders.filter((f) => f.deleted_at === null).length;
    const entryCount = remote.entries.filter((e) => e.deleted_at === null).length;
    status.textContent =
      folderCount === 0 && entryCount === 0
        ? "Connected. No existing data yet — you're starting fresh."
        : `Connected. Found ${folderCount} folder${folderCount === 1 ? "" : "s"} and ${entryCount} saved tab${entryCount === 1 ? "" : "s"} — open a new tab to sync them in.`;
    status.className = "status success";
  };

  app.appendChild(wrap);
}

render();

import { getConfig, setConfig } from "../lib/config";

const app = document.getElementById("app")!;

async function render() {
  const config = await getConfig();

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
    status.textContent = "Saved.";
    status.className = "status success";
  };

  app.appendChild(wrap);
}

render();

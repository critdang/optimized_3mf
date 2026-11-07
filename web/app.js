const fileInput = document.querySelector("#project-file");
const providerInput = document.querySelector("#provider");
const keyInput = document.querySelector("#api-key");
const keyHint = document.querySelector("#key-hint");
const modelInput = document.querySelector("#model");
const goalInput = document.querySelector("#goal");
const notesInput = document.querySelector("#notes");
const optimizeButton = document.querySelector("#optimize-button");
const compactContextInput = document.querySelector("#compact-context");
const copyPromptButton = document.querySelector("#copy-prompt-button");
const statusElement = document.querySelector("#status");
const summariesElement = document.querySelector("#project-summary");
const previewSection = document.querySelector("#preview-section");
const previewCount = document.querySelector("#preview-count");
const previewsElement = document.querySelector("#plate-previews");
const resultsElement = document.querySelector("#results");
const resultBody = document.querySelector("#result-body");
const resultCaption = document.querySelector("#result-caption");
const promptDialog = document.querySelector("#prompt-dialog");
const fullPromptInput = document.querySelector("#full-prompt");
const copyStatus = document.querySelector("#copy-status");

let selectedFile = null;
let project = null;
let configuredKeys = { openai: false, groq: false };
let maxUploadBytes = 256 * 1024 * 1024;

function setStatus(message, state = "", suggestions = []) {
  statusElement.replaceChildren(document.createTextNode(message));
  statusElement.dataset.state = state;
  for (const suggestion of suggestions) {
    const button = element("button", "status-action", suggestion.label);
    button.addEventListener("click", () => {
      if (suggestion.action === "compact") {
        compactContextInput.checked = true;
        void optimize();
      } else if (suggestion.action === "copy-prompt") {
        void inspectFullPrompt();
      }
    });
    statusElement.append(button);
  }
}

function element(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function updateProviderFields() {
  const provider = providerInput.value;
  modelInput.value = provider === "groq" ? "qwen/qwen3.8-27b" : "gpt-4.1-mini";
  keyInput.value = "";
  keyInput.placeholder = configuredKeys[provider]
    ? "Configured on server (or enter a different key)"
    : `Enter ${provider === "groq" ? "Groq" : "OpenAI"} API key`;
  keyHint.textContent = configuredKeys[provider]
    ? "key configured on server"
    : "";
  keyInput.autocomplete = "new-password";
}

async function loadSettings() {
  const response = await fetch("/api/settings");
  if (!response.ok) throw new Error("Could not load local server settings.");
  const settings = await response.json();
  configuredKeys = settings.configuredKeys;
  maxUploadBytes = settings.maxUploadBytes ?? maxUploadBytes;
  providerInput.value = settings.provider;
  updateProviderFields();
  modelInput.value = settings.model;
}

function renderProject(data) {
  const {
    printer,
    filaments,
    base_profile: profile,
    plates,
  } = data.projectSummary;
  summariesElement.replaceChildren();
  summariesElement.append(
    element("div", "project-name", data.fileName),
    element(
      "p",
      "project-details",
      `${printer.name} · ${printer.nozzle_diameter_mm} mm nozzle${printer.bed_type ? ` · ${printer.bed_type}` : ""}`,
    ),
    element(
      "p",
      "project-details",
      `${filaments.map((filament) => `${filament.name} (${filament.material_family})`).join(", ") || "No filament details"}${profile ? ` · ${profile}` : ""}`,
    ),
    element(
      "p",
      "project-details",
      `${plates.length} plate${plates.length === 1 ? "" : "s"} · ${plates.reduce((count, plate) => count + plate.objects.length, 0)} object(s)`,
    ),
  );
  summariesElement.classList.remove("hidden");

  previewsElement.replaceChildren();
  previewCount.textContent = `${data.plateImages.length} image${data.plateImages.length === 1 ? "" : "s"}`;
  for (const image of data.plateImages) {
    const figure = element("figure", "plate-card");
    const img = element("img", "plate-image");
    img.src = image.dataUrl;
    img.alt = `Full-resolution ${image.name} plate preview`;
    img.loading = "lazy";
    figure.append(img, element("figcaption", "", image.name));
    previewsElement.append(figure);
  }
  if (data.plateImages.length === 0) {
    previewsElement.append(
      element(
        "p",
        "empty-message",
        "This project does not contain plate preview images.",
      ),
    );
  }
  previewSection.classList.remove("hidden");
}

async function postProject(endpoint, options = {}) {
  const headers = {
    "Content-Type": "application/octet-stream",
    "X-File-Name": encodeURIComponent(selectedFile.name),
    ...options.headers,
  };
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: selectedFile,
  });
  const data = await response.json();
  if (!response.ok) {
    throw Object.assign(
      new Error(data.error ?? `Request failed (${response.status}).`),
      { suggestions: data.suggestions ?? [], code: data.code },
    );
  }
  return data;
}

async function inspectFile(file) {
  selectedFile = file;
  project = null;
  optimizeButton.disabled = true;
  resultsElement.classList.add("hidden");
  document.querySelector("#upload-title").textContent = file.name;
  document.querySelector("#upload-subtitle").textContent =
    `${(file.size / (1024 * 1024)).toFixed(1)} MiB · Inspecting archive…`;
  summariesElement.classList.add("hidden");
  previewSection.classList.add("hidden");
  if (!file.name.toLowerCase().endsWith(".3mf")) {
    setStatus("Choose a .3mf project file.", "error");
    return;
  }
  if (file.size > maxUploadBytes) {
    setStatus(
      `This server accepts .3mf files up to ${(maxUploadBytes / (1024 * 1024)).toFixed(0)} MiB. Use the local web UI for larger projects.`,
      "error",
    );
    return;
  }
  setStatus("Reading project and extracting original plate previews…", "busy");
  try {
    project = await postProject("/api/inspect");
    renderProject(project);
    optimizeButton.disabled = false;
    copyPromptButton.disabled = false;
    document.querySelector("#upload-subtitle").textContent =
      `${(file.size / (1024 * 1024)).toFixed(1)} MiB · Original file remains unchanged`;
    setStatus(
      "Project ready. Choose your provider and generate recommendations.",
      "success",
    );
  } catch (error) {
    setStatus(error.message, "error", error.suggestions);
  }
}

function renderResults(data) {
  resultBody.replaceChildren();
  resultCaption.textContent = data.outputWritten
    ? "An optimized project was written."
    : "Suggestions only — your uploaded project was not changed.";
  renderRationale(data.globalRationale);
  renderContextSummary(data.context);
  renderDiffs(data.diffs);
  renderWarnings(data.warnings);
  resultsElement.classList.remove("hidden");
}

function renderRationale(rationale) {
  if (rationale) resultBody.append(element("p", "rationale", rationale));
}

function renderContextSummary(context) {
  if (context?.mode !== "compact") return;
  const omitted = context.omitted;
  resultBody.append(
    element(
      "p",
      "context-summary",
      `Compact context estimated at ${context.estimatedInputTokens.toLocaleString()} of ${context.targetInputTokens.toLocaleString()} tokens. Omitted ${omitted.customSettings} custom settings, ${omitted.objects} overflow objects, and ${omitted.plateImages} preview images from the AI request.`,
    ),
  );
}

function renderDiffs(diffs) {
  if (diffs.length === 0) {
    resultBody.append(
      element(
        "p",
        "empty-message",
        "No applicable setting changes were suggested.",
      ),
    );
    return;
  }
  const list = element("div", "change-list");
  diffs.forEach((diff) => list.append(createDiffCard(diff)));
  resultBody.append(list);
}

function createDiffCard(diff) {
  const item = element("article", "change-card");
  const header = element("div", "change-header");
  header.append(
    element("code", "parameter", diff.parameter),
    element(
      "span",
      "change-value",
      `${String(diff.from)}  →  ${String(diff.to)}`,
    ),
  );
  item.append(
    header,
    element("p", "change-reason", diff.reason || "No explanation provided."),
  );
  if (diff.target?.objectName) {
    item.append(element("span", "change-target", diff.target.objectName));
  }
  return item;
}

function renderWarnings(warnings) {
  warnings.forEach((warning) =>
    resultBody.append(element("p", "warning", warning)),
  );
}

async function optimize() {
  if (!selectedFile || !project) return;
  optimizeButton.disabled = true;
  optimizeButton.querySelector("span").textContent = compactContextInput.checked
    ? "Analyzing compact context…"
    : "Analyzing full project…";
  resultsElement.classList.add("hidden");
  setStatus(
    compactContextInput.checked
      ? "Preparing a compact prompt with core print settings; plate previews remain visible here but are omitted from this API request…"
      : "Sending the complete settings, system prompt, and plate previews to the selected provider…",
    "busy",
  );
  const provider = providerInput.value;
  const headers = {
    "X-Slicer-Provider": provider,
    "X-Slicer-Model": modelInput.value.trim(),
    "X-Slicer-Intent": JSON.stringify({
      primary_goal: goalInput.value,
      free_text_description: notesInput.value.trim(),
    }),
    "X-Slicer-Context": compactContextInput.checked ? "compact" : "full",
  };
  if (keyInput.value) headers["X-Api-Key"] = keyInput.value;
  try {
    const result = await postProject("/api/optimize", { headers });
    renderResults(result);
    setStatus(
      "Recommendations ready. The original .3mf was not changed.",
      "success",
    );
  } catch (error) {
    setStatus(error.message, "error", error.suggestions);
  } finally {
    optimizeButton.disabled = false;
    optimizeButton.querySelector("span").textContent =
      "Generate recommendations";
  }
}

async function inspectFullPrompt() {
  if (!selectedFile) return;
  copyPromptButton.disabled = true;
  copyStatus.textContent = "";
  setStatus("Building the complete prompt for inspection…", "busy");
  try {
    const response = await postProject("/api/prompt", {
      headers: {
        "X-Slicer-Intent": JSON.stringify({
          primary_goal: goalInput.value,
          free_text_description: notesInput.value.trim(),
        }),
      },
    });
    fullPromptInput.value = JSON.stringify(
      {
        messages: response.messages,
        response_format: response.responseFormat,
      },
      null,
      2,
    );
    promptDialog.showModal();
    setStatus("Full prompt is ready to inspect or copy.", "success");
  } catch (error) {
    setStatus(error.message, "error", error.suggestions);
  } finally {
    copyPromptButton.disabled = false;
  }
}

async function copyFullPrompt() {
  try {
    await navigator.clipboard.writeText(fullPromptInput.value);
    copyStatus.textContent = "Copied. Paste into ChatGPT or Gemini.";
  } catch {
    fullPromptInput.focus();
    fullPromptInput.select();
    copyStatus.textContent =
      "Clipboard unavailable; prompt selected for manual copy.";
  }
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) void inspectFile(file);
});
providerInput.addEventListener("change", updateProviderFields);
optimizeButton.addEventListener("click", () => void optimize());
copyPromptButton.addEventListener("click", () => void inspectFullPrompt());
document.querySelector("#close-prompt-button").addEventListener("click", () => {
  promptDialog.close();
});
document.querySelector("#copy-prompt-confirm").addEventListener("click", () => {
  void copyFullPrompt();
});
document.querySelectorAll(".suggestion").forEach((button) => {
  button.addEventListener("click", () => {
    providerInput.value = button.dataset.model;
    updateProviderFields();
    modelInput.value = button.dataset.value;
  });
});
document.querySelector(".upload-zone").addEventListener("dragover", (event) => {
  event.preventDefault();
});
document.querySelector(".upload-zone").addEventListener("drop", (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (file) void inspectFile(file);
});
void loadSettings().catch((error) => setStatus(error.message, "error"));

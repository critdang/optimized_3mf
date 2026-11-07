const fileInput = document.querySelector("#project-file");
const providerInput = document.querySelector("#provider");
const keyInput = document.querySelector("#api-key");
const keyHint = document.querySelector("#key-hint");
const modelInput = document.querySelector("#model");
const goalInput = document.querySelector("#goal");
const notesInput = document.querySelector("#notes");
const optimizeButton = document.querySelector("#optimize-button");
const statusElement = document.querySelector("#status");
const summariesElement = document.querySelector("#project-summary");
const previewSection = document.querySelector("#preview-section");
const previewCount = document.querySelector("#preview-count");
const previewsElement = document.querySelector("#plate-previews");
const resultsElement = document.querySelector("#results");
const resultBody = document.querySelector("#result-body");
const resultCaption = document.querySelector("#result-caption");

let selectedFile = null;
let project = null;
let configuredKeys = { openai: false, groq: false };

function setStatus(message, state = "") {
  statusElement.textContent = message;
  statusElement.dataset.state = state;
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
    ? "Configured in local .env (or enter a different key)"
    : `Enter ${provider === "groq" ? "Groq" : "OpenAI"} API key`;
  keyHint.textContent = configuredKeys[provider] ? "key available in .env" : "";
  keyInput.autocomplete = "new-password";
}

async function loadSettings() {
  const response = await fetch("/api/settings");
  if (!response.ok) throw new Error("Could not load local server settings.");
  const settings = await response.json();
  configuredKeys = settings.configuredKeys;
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
  if (!response.ok)
    throw new Error(data.error ?? `Request failed (${response.status}).`);
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
  setStatus("Reading project and extracting original plate previews…", "busy");
  try {
    project = await postProject("/api/inspect");
    renderProject(project);
    optimizeButton.disabled = false;
    document.querySelector("#upload-subtitle").textContent =
      `${(file.size / (1024 * 1024)).toFixed(1)} MiB · Original file remains unchanged`;
    setStatus(
      "Project ready. Choose your provider and generate recommendations.",
      "success",
    );
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function renderResults(data) {
  resultBody.replaceChildren();
  resultCaption.textContent = data.outputWritten
    ? "An optimized project was written."
    : "Suggestions only — your uploaded project was not changed.";
  if (data.globalRationale) {
    resultBody.append(element("p", "rationale", data.globalRationale));
  }
  if (data.diffs.length === 0) {
    resultBody.append(
      element(
        "p",
        "empty-message",
        "No applicable setting changes were suggested.",
      ),
    );
  } else {
    const list = element("div", "change-list");
    for (const diff of data.diffs) {
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
        element(
          "p",
          "change-reason",
          diff.reason || "No explanation provided.",
        ),
      );
      if (diff.target?.objectName) {
        item.append(element("span", "change-target", diff.target.objectName));
      }
      list.append(item);
    }
    resultBody.append(list);
  }
  for (const warning of data.warnings) {
    resultBody.append(element("p", "warning", warning));
  }
  resultsElement.classList.remove("hidden");
}

async function optimize() {
  if (!selectedFile || !project) return;
  optimizeButton.disabled = true;
  optimizeButton.querySelector("span").textContent = "Analyzing full project…";
  resultsElement.classList.add("hidden");
  setStatus(
    "Sending the complete settings, system prompt, and plate previews to the selected provider…",
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
    setStatus(error.message, "error");
  } finally {
    optimizeButton.disabled = false;
    optimizeButton.querySelector("span").textContent =
      "Generate recommendations";
  }
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (file) void inspectFile(file);
});
providerInput.addEventListener("change", updateProviderFields);
optimizeButton.addEventListener("click", () => void optimize());
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

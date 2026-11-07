import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse3mfBuffer } from "../3mf/parser.js";
import { applyLlmChanges } from "../apply/changes.js";
import { DEFAULT_MODEL } from "../constants.js";
import { buildLlmRequestPayload } from "../llm/requestBuilder.js";
import { requestOptimization } from "../llm/optimizerClient.js";
import { createI18n } from "../i18n.js";

const MAX_UPLOAD_BYTES = 256 * 1024 * 1024;
const DEFAULT_GROQ_MODEL = "qwen/qwen3.8-27b";
const WEB_ROOT = fileURLToPath(new URL("../../web/", import.meta.url));
const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
]);

export function createWebServer() {
  return createServer(async (request, response) => {
    setSecurityHeaders(response);
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "GET" && requestUrl.pathname === "/api/settings") {
        return sendJson(response, 200, getPublicSettings());
      }
      if (
        request.method === "POST" &&
        (requestUrl.pathname === "/api/inspect" ||
          requestUrl.pathname === "/api/optimize")
      ) {
        const buffer = await readUpload(request);
        const fileName = getSafeFileName(request.headers["x-file-name"]);
        const parsed = await parse3mfBuffer(buffer, fileName);
        if (requestUrl.pathname === "/api/inspect") {
          return sendJson(response, 200, {
            fileName,
            projectSummary: parsed.normalized.projectSummary,
            currentSettings: parsed.normalized.currentSettings,
            userModifiedSettings: parsed.normalized.userModifiedSettings,
            plateImages: parsed.plateImages,
          });
        }
        return await optimizeProject(request, response, parsed);
      }
      if (request.method === "GET" && STATIC_FILES.has(requestUrl.pathname)) {
        return await sendStatic(response, requestUrl.pathname);
      }
      return sendJson(response, 404, { error: "Not found." });
    } catch (error) {
      return sendJson(response, error.statusCode ?? 400, {
        error: error.message || "Request failed.",
      });
    }
  });
}

export function startWebServer({
  port = Number(process.env.PORT) || 4173,
} = {}) {
  const server = createWebServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(`Slicer Copilot UI: http://127.0.0.1:${server.address().port}`);
    console.log("The web server is bound to this computer only.");
  });
  return server;
}

async function optimizeProject(request, response, parsed) {
  const provider = request.headers["x-slicer-provider"];
  if (provider !== "openai" && provider !== "groq") {
    throw httpError("Provider must be openai or groq.");
  }
  const model = request.headers["x-slicer-model"];
  if (
    typeof model !== "string" ||
    model.trim().length === 0 ||
    model.length > 128
  ) {
    throw httpError("Enter a model name (up to 128 characters).");
  }
  const intent = parseIntent(request.headers["x-slicer-intent"]);
  const apiKey =
    request.headers["x-api-key"] ||
    (provider === "groq"
      ? process.env.GROQ_API_KEY
      : process.env.OPENAI_API_KEY);
  const mockResponsePath = process.env.LLM_MOCK_RESPONSE;
  if (!apiKey && !mockResponsePath) {
    throw httpError(
      `Enter a ${provider === "groq" ? "Groq" : "OpenAI"} API key.`,
    );
  }
  const baseURL =
    provider === "groq"
      ? "https://api.groq.com/openai/v1"
      : "https://api.openai.com/v1";
  const payload = buildLlmRequestPayload({
    normalized: parsed.normalized,
    userIntent: intent,
    plateImages: parsed.plateImages,
    targetLanguage: "en",
  });
  let llmResponse;
  try {
    llmResponse = await requestOptimization({
      payload,
      config: {
        apiKey: apiKey ?? "",
        baseURL,
        model: model.trim(),
        temperature: 0.3,
        reasoningEffort: undefined,
        mockResponsePath,
      },
    });
  } catch (error) {
    throw httpError(error.message, 502);
  }
  const { diffs, warnings } = applyLlmChanges({
    normalized: parsed.normalized,
    response: llmResponse,
    respectUserSettings: true,
    i18n: createI18n("en"),
  });
  return sendJson(response, 200, {
    diffs,
    warnings,
    globalRationale: llmResponse.globalRationale ?? "",
    fileName: parsed.fileName,
    outputWritten: false,
  });
}

function parseIntent(headerValue) {
  if (typeof headerValue !== "string") {
    throw httpError("Optimization intent is missing.");
  }
  try {
    const intent = JSON.parse(headerValue);
    if (!intent || typeof intent !== "object" || Array.isArray(intent)) {
      throw new Error("Intent must be a JSON object.");
    }
    return intent;
  } catch (error) {
    throw httpError(`Invalid optimization intent: ${error.message}`);
  }
}

function getPublicSettings() {
  const openAiConfigured = Boolean(process.env.OPENAI_API_KEY);
  const groqConfigured = Boolean(process.env.GROQ_API_KEY);
  const provider = groqConfigured && !openAiConfigured ? "groq" : "openai";
  return {
    provider,
    model: provider === "groq" ? DEFAULT_GROQ_MODEL : DEFAULT_MODEL,
    configuredKeys: {
      openai: openAiConfigured,
      groq: groqConfigured,
    },
  };
}

async function readUpload(request) {
  const contentLength = Number(request.headers["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > MAX_UPLOAD_BYTES) {
    request.resume();
    throw httpError("The .3mf file exceeds the 256 MiB upload limit.", 413);
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_UPLOAD_BYTES) {
      request.resume();
      throw httpError("The .3mf file exceeds the 256 MiB upload limit.", 413);
    }
    chunks.push(chunk);
  }
  if (total === 0) throw httpError("Upload a non-empty .3mf file.");
  return Buffer.concat(chunks, total);
}

function getSafeFileName(headerValue) {
  let fileName = "project.3mf";
  if (typeof headerValue === "string" && headerValue.length < 512) {
    try {
      fileName = decodeURIComponent(headerValue);
    } catch {
      throw httpError("Invalid uploaded file name.");
    }
  }
  fileName = path.basename(fileName.replaceAll("\\", "/"));
  if (!fileName.toLowerCase().endsWith(".3mf")) {
    throw httpError("Upload a .3mf project file.");
  }
  return fileName;
}

async function sendStatic(response, pathname) {
  const [fileName, contentType] = STATIC_FILES.get(pathname);
  const content = await readFile(path.join(WEB_ROOT, fileName));
  response.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
  });
  response.end(content);
}

function setSecurityHeaders(response) {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  response.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
  response.setHeader("Cache-Control", "no-store");
}

function sendJson(response, statusCode, value) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(value));
}

function httpError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

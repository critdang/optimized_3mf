import path from "node:path";
import { parse3mfBuffer } from "../3mf/parser.js";
import { applyLlmChanges } from "../apply/changes.js";
import { DEFAULT_MODEL } from "../constants.js";
import { buildLlmRequestPayload } from "../llm/requestBuilder.js";
import {
  buildRequestMessages,
  requestOptimization,
} from "../llm/optimizerClient.js";
import { LLM_RESPONSE_FORMAT } from "../llm/responseSchema.js";
import { createI18n } from "../i18n.js";

const DEFAULT_GROQ_MODEL = "qwen/qwen3.8-27b";
const VERCEL_UPLOAD_LIMIT_BYTES = 3 * 1024 * 1024;
const MAX_API_RESPONSE_BYTES = 4 * 1024 * 1024;

export function getPublicSettings(maxUploadBytes = VERCEL_UPLOAD_LIMIT_BYTES) {
  const openAiConfigured = Boolean(process.env.OPENAI_API_KEY);
  const groqConfigured = Boolean(process.env.GROQ_API_KEY);
  const provider = groqConfigured && !openAiConfigured ? "groq" : "openai";
  return {
    provider,
    model: provider === "groq" ? DEFAULT_GROQ_MODEL : DEFAULT_MODEL,
    maxUploadBytes,
    configuredKeys: {
      openai: openAiConfigured,
      groq: groqConfigured,
    },
  };
}

export async function handleProjectEndpoint(endpoint, request, buffer) {
  const fileName = getSafeFileName(request.headers["x-file-name"]);
  const parsed = await parse3mfBuffer(buffer, fileName);
  if (endpoint === "/api/inspect") return createInspection(parsed);
  if (endpoint === "/api/prompt")
    return createPromptInspection(request, parsed);
  if (endpoint === "/api/optimize") {
    return optimizeProject(request, parsed);
  }
  throw httpError("Not found.", 404);
}

export function getApiResponseLimitError(data) {
  if (Buffer.byteLength(JSON.stringify(data)) <= MAX_API_RESPONSE_BYTES) {
    return null;
  }
  return httpError(
    "The project response exceeds Vercel's 4 MiB response limit. Use the local web UI for this project.",
    413,
  );
}

export function formatApiError(error) {
  if (error.code === "GROQ_INPUT_TOKEN_LIMIT") {
    return {
      error:
        "Groq rejected the full context because it exceeds your input-token limit.",
      code: error.code,
      suggestions: getQuotaSuggestions(),
    };
  }
  if (error.code === "GROQ_RATE_LIMIT") {
    return {
      error:
        "Groq rate limit reached. Wait for the quota window to reset or retry with compact context.",
      code: error.code,
      suggestions: getQuotaSuggestions(),
    };
  }
  if (error.code === "COMPACT_CONTEXT_OVER_BUDGET") {
    return {
      error: error.message,
      code: error.code,
      estimatedInputTokens: error.estimatedInputTokens,
      suggestions: [
        {
          action: "copy-prompt",
          label: "Copy Full Prompt for ChatGPT / Gemini",
        },
      ],
    };
  }
  return { error: error.message || "Request failed." };
}

export function getErrorStatus(error) {
  return error.statusCode ?? 400;
}

export function getVercelUploadLimit() {
  return VERCEL_UPLOAD_LIMIT_BYTES;
}

function createInspection(parsed) {
  return {
    fileName: parsed.fileName,
    projectSummary: parsed.normalized.projectSummary,
    currentSettings: parsed.normalized.currentSettings,
    userModifiedSettings: parsed.normalized.userModifiedSettings,
    plateImages: parsed.plateImages,
  };
}

function createPromptInspection(request, parsed) {
  const payload = buildProjectPayload(request, parsed);
  return {
    messages: buildRequestMessages({ payload }),
    responseFormat: LLM_RESPONSE_FORMAT,
  };
}

async function optimizeProject(request, parsed) {
  const options = getOptimizationOptions(request);
  const payload = buildProjectPayload(request, parsed, options.intent);
  const compact = request.headers["x-slicer-context"] === "compact";
  const llmResponse = await runProviderOptimization({
    payload,
    compact,
    options,
  });
  const { diffs, warnings } = applyLlmChanges({
    normalized: parsed.normalized,
    response: llmResponse,
    respectUserSettings: true,
    i18n: createI18n("en"),
  });
  return {
    diffs,
    warnings,
    globalRationale: llmResponse.globalRationale ?? "",
    fileName: parsed.fileName,
    outputWritten: false,
    context: llmResponse.context ?? { mode: "full" },
  };
}

function getOptimizationOptions(request) {
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
  return {
    provider,
    intent: parseIntent(request.headers["x-slicer-intent"]),
    config: {
      apiKey: apiKey ?? "",
      baseURL:
        provider === "groq"
          ? "https://api.groq.com/openai/v1"
          : "https://api.openai.com/v1",
      model: model.trim(),
      temperature: 0.3,
      reasoningEffort: undefined,
      mockResponsePath,
    },
  };
}

async function runProviderOptimization({ payload, compact, options }) {
  try {
    return await requestOptimization({
      payload,
      compact,
      config: options.config,
    });
  } catch (error) {
    throw normalizeOptimizationError(error, options.provider);
  }
}

function normalizeOptimizationError(error, provider) {
  if (provider === "groq" && [413, 429].includes(error.statusCode)) {
    error.code =
      error.statusCode === 413 ? "GROQ_INPUT_TOKEN_LIMIT" : "GROQ_RATE_LIMIT";
    return error;
  }
  if (error.code === "COMPACT_CONTEXT_OVER_BUDGET") {
    error.statusCode = 413;
    return error;
  }
  return httpError(error.message, error.statusCode ?? 502);
}

function buildProjectPayload(request, parsed, intent) {
  const userIntent = intent ?? parseIntent(request.headers["x-slicer-intent"]);
  return buildLlmRequestPayload({
    normalized: parsed.normalized,
    userIntent,
    plateImages: parsed.plateImages,
    targetLanguage: "en",
  });
}

function getQuotaSuggestions() {
  return [
    {
      action: "compact",
      label: "Retry with Compact Context (Fit 7k Token Limit)",
    },
    {
      action: "copy-prompt",
      label: "Copy Full Prompt for ChatGPT / Gemini",
    },
  ];
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

function httpError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

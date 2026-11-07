import {
  formatApiError,
  getApiResponseLimitError,
  getErrorStatus,
  getPublicSettings,
  getVercelUploadLimit,
  handleProjectEndpoint,
} from "./api.js";

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  "Cache-Control": "no-store",
};

export function createVercelApiHandler(endpoint) {
  return async function handleVercelRequest(request, response) {
    setSecurityHeaders(response);
    try {
      if (endpoint === "settings") {
        return handleSettings(request, response);
      }
      if (request.method !== "POST") {
        return sendJson(response, 405, { error: "Method not allowed." });
      }
      const buffer = await readRequestBody(request);
      const result = await handleProjectEndpoint(
        `/api/${endpoint}`,
        request,
        buffer,
      );
      const sizeError = getApiResponseLimitError(result);
      if (sizeError) throw sizeError;
      return sendJson(response, 200, result);
    } catch (error) {
      return sendJson(response, getErrorStatus(error), formatApiError(error));
    }
  };
}

function handleSettings(request, response) {
  if (request.method !== "GET") {
    return sendJson(response, 405, { error: "Method not allowed." });
  }
  return sendJson(response, 200, getPublicSettings());
}

async function readRequestBody(request) {
  const maxBytes = getVercelUploadLimit();
  const contentLength = Number(request.headers["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    request.resume();
    throw httpError(
      "The .3mf file exceeds the 3 MiB Vercel upload limit.",
      413,
    );
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) {
      request.resume();
      throw httpError(
        "The .3mf file exceeds the 3 MiB Vercel upload limit.",
        413,
      );
    }
    chunks.push(chunk);
  }
  if (total === 0) throw httpError("Upload a non-empty .3mf file.");
  if (
    !request.headers["content-type"]?.startsWith("application/octet-stream")
  ) {
    throw httpError("Upload the .3mf file as application/octet-stream.", 415);
  }
  return Buffer.concat(chunks, total);
}

function setSecurityHeaders(response) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.setHeader(name, value);
  }
}

function sendJson(response, statusCode, value) {
  response.status(statusCode).json(value);
}

function httpError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

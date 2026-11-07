import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatApiError,
  getPublicSettings,
  handleProjectEndpoint,
} from "./api.js";
export { formatApiError };

const MAX_UPLOAD_BYTES = 256 * 1024 * 1024;
const WEB_ROOT = fileURLToPath(new URL("../../web/", import.meta.url));
const STATIC_FILES = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
]);

export function createWebServer() {
  return createServer(handleWebRequest);
}

async function handleWebRequest(request, response) {
  setSecurityHeaders(response);
  try {
    return await dispatchRequest(request, response);
  } catch (error) {
    return sendJson(response, error.statusCode ?? 400, formatApiError(error));
  }
}

async function dispatchRequest(request, response) {
  const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "GET" && requestUrl.pathname === "/api/settings") {
    return sendJson(response, 200, getPublicSettings(MAX_UPLOAD_BYTES));
  }
  if (request.method === "GET" && STATIC_FILES.has(requestUrl.pathname)) {
    return sendStatic(response, requestUrl.pathname);
  }
  if (request.method !== "POST" || !isProjectEndpoint(requestUrl.pathname)) {
    return sendJson(response, 404, { error: "Not found." });
  }
  const buffer = await readUpload(request);
  const result = await handleProjectEndpoint(
    requestUrl.pathname,
    request,
    buffer,
  );
  return sendJson(response, 200, result);
}

function isProjectEndpoint(endpoint) {
  return ["/api/inspect", "/api/optimize", "/api/prompt"].includes(endpoint);
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

function httpError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
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

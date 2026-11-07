import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import optimizeHandler from "../api/optimize.js";
import parseHandler, { config as parseConfig } from "../api/parse.js";
import promptHandler from "../api/prompt.js";
import settingsHandler from "../api/settings.js";
import { createSample3mf } from "./fixtures/sample3mf.js";
import { LLM_RESPONSE_FORMAT } from "../src/llm/responseSchema.js";

function createResponse() {
  return {
    headers: {},
    statusCode: null,
    body: null,
    setHeader(name, value) {
      this.headers[name] = value;
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function createProjectRequest(buffer, headers = {}) {
  const request = Readable.from([buffer]);
  request.method = "POST";
  request.headers = {
    "content-length": String(buffer.length),
    "content-type": "application/octet-stream",
    "x-file-name": "fixture.3mf",
    ...headers,
  };
  return request;
}

describe("Vercel API handlers", () => {
  it("disables platform body parsing for raw project uploads", () => {
    expect(parseConfig.api.bodyParser).toBe(false);
  });

  it("returns public provider settings without exposing key material", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk-test-only");
    const response = createResponse();
    await settingsHandler({ method: "GET", headers: {} }, response);
    expect(response.statusCode).toBe(200);
    expect(response.body).toMatchObject({
      provider: "groq",
      maxUploadBytes: 3 * 1024 * 1024,
      configuredKeys: { groq: true },
    });
    expect(JSON.stringify(response.body)).not.toContain("gsk-test-only");
    vi.unstubAllEnvs();
  });

  it("parses a raw .3mf request and returns its project summary", async () => {
    const { buffer } = await createSample3mf();
    const response = createResponse();
    await parseHandler(createProjectRequest(buffer), response);
    expect(response.statusCode).toBe(200);
    expect(response.body.fileName).toBe("fixture.3mf");
    expect(response.body.projectSummary.printer.name).toBe("Bambu Lab H2S");
    expect(response.headers["Content-Security-Policy"]).toContain(
      "connect-src 'self'",
    );
  });

  it("builds the full manual prompt without requiring a provider key", async () => {
    const { buffer } = await createSample3mf();
    const response = createResponse();
    await promptHandler(
      createProjectRequest(buffer, {
        "x-slicer-intent": JSON.stringify({ primary_goal: "balanced" }),
      }),
      response,
    );
    expect(response.statusCode).toBe(200);
    expect(response.body.responseFormat).toEqual(LLM_RESPONSE_FORMAT);
    expect(response.body.messages[0].content).toContain("Bambu Studio");
  });

  it("runs optimization through the serverless function using a mock response", async () => {
    const mockResponsePath = fileURLToPath(
      new URL("./fixtures/mockResponse.json", import.meta.url),
    );
    vi.stubEnv("LLM_MOCK_RESPONSE", mockResponsePath);
    const { buffer } = await createSample3mf();
    const response = createResponse();
    await optimizeHandler(
      createProjectRequest(buffer, {
        "x-slicer-provider": "groq",
        "x-slicer-model": "qwen/qwen3.8-27b",
        "x-slicer-intent": JSON.stringify({ primary_goal: "balanced" }),
      }),
      response,
    );
    expect(response.statusCode).toBe(200);
    expect(response.body.diffs.length).toBeGreaterThan(0);
    expect(response.body.outputWritten).toBe(false);
    vi.unstubAllEnvs();
  });

  it("rejects files that exceed the Vercel request limit", async () => {
    const request = Readable.from([]);
    request.method = "POST";
    request.headers = {
      "content-length": String(3 * 1024 * 1024 + 1),
      "content-type": "application/octet-stream",
    };
    const response = createResponse();
    await parseHandler(request, response);
    expect(response.statusCode).toBe(413);
    expect(response.body.error).toContain("3 MiB");
  });
});

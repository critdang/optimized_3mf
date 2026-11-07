import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import JSZip from "jszip";
import { fileURLToPath } from "node:url";
import { createWebServer, formatApiError } from "../src/web/server.js";
import { createSample3mf } from "./fixtures/sample3mf.js";
import { SYSTEM_PROMPT } from "../src/llm/prompt.js";
import { LLM_RESPONSE_FORMAT } from "../src/llm/responseSchema.js";

describe("local web UI server", () => {
  let server;
  let baseUrl;
  let projectBuffer;

  beforeAll(async () => {
    const sample = await createSample3mf();
    const zip = await JSZip.loadAsync(sample.buffer);
    zip.file("Metadata/plate_1.png", Buffer.from("full-resolution-preview"));
    projectBuffer = await zip.generateAsync({ type: "nodebuffer" });
    server = createWebServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterEach(() => vi.unstubAllEnvs());
  afterAll(() => new Promise((resolve) => server.close(resolve)));

  it("serves the UI with local-only security headers", async () => {
    const response = await fetch(baseUrl);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("content-security-policy")).toContain(
      "connect-src 'self'",
    );
    expect(await response.text()).toContain("Slicer Copilot");
  });

  it("reports configured providers without returning API keys", async () => {
    const response = await fetch(`${baseUrl}/api/settings`);
    const settings = await response.json();
    expect(response.status).toBe(200);
    expect(settings.configuredKeys).toEqual({
      openai: expect.any(Boolean),
      groq: expect.any(Boolean),
    });
    expect(JSON.stringify(settings)).not.toContain("gsk_");
    expect(settings).not.toHaveProperty("apiKey");
  });

  it("inspects .3mf projects and returns the original full-resolution preview", async () => {
    const response = await fetch(`${baseUrl}/api/inspect`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": "fixture.3mf",
      },
      body: projectBuffer,
    });
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.fileName).toBe("fixture.3mf");
    expect(data.projectSummary.printer.name).toBe("Bambu Lab H2S");
    expect(data.plateImages).toEqual([
      {
        plateIndex: 0,
        name: "plate_1.png",
        dataUrl: `data:image/png;base64,${Buffer.from("full-resolution-preview").toString("base64")}`,
      },
    ]);
  });

  it("runs an optimization with per-request provider and model settings", async () => {
    const mockResponsePath = fileURLToPath(
      new URL("./fixtures/mockResponse.json", import.meta.url),
    );
    vi.stubEnv("LLM_MOCK_RESPONSE", mockResponsePath);
    const response = await fetch(`${baseUrl}/api/optimize`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": "fixture.3mf",
        "x-slicer-provider": "groq",
        "x-slicer-model": "qwen/qwen3.8-27b",
        "x-slicer-intent": JSON.stringify({
          primary_goal: "balanced",
          free_text_description: "Keep it sturdy.",
        }),
      },
      body: projectBuffer,
    });
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.diffs.length).toBeGreaterThan(0);
    expect(data.globalRationale).toContain("Increasing wall count");
    expect(data).toMatchObject({
      fileName: "fixture.3mf",
      outputWritten: false,
    });
  });

  it("runs in compact context and reports its estimate and omitted fields", async () => {
    const mockResponsePath = fileURLToPath(
      new URL("./fixtures/mockResponse.json", import.meta.url),
    );
    vi.stubEnv("LLM_MOCK_RESPONSE", mockResponsePath);
    const response = await fetch(`${baseUrl}/api/optimize`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": "fixture.3mf",
        "x-slicer-provider": "groq",
        "x-slicer-model": "qwen/qwen3.8-27b",
        "x-slicer-context": "compact",
        "x-slicer-intent": JSON.stringify({ primary_goal: "balanced" }),
      },
      body: projectBuffer,
    });
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.context.mode).toBe("compact");
    expect(data.context.estimatedInputTokens).toBeLessThan(7_000);
    expect(data.context.omitted.plateImages).toBe(1);
    vi.unstubAllEnvs();
  });

  it("builds a complete prompt inspection response without requiring an API key", async () => {
    const response = await fetch(`${baseUrl}/api/prompt`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": "fixture.3mf",
        "x-slicer-intent": JSON.stringify({
          primary_goal: "custom",
          free_text_description: "Keep it stiff.",
        }),
      },
      body: projectBuffer,
    });
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(data.messages[0].content).toBe(SYSTEM_PROMPT);
    expect(data.responseFormat).toEqual(LLM_RESPONSE_FORMAT);
    expect(data.messages[1].content).toContainEqual({
      type: "image_url",
      image_url: {
        url: `data:image/png;base64,${Buffer.from("full-resolution-preview").toString("base64")}`,
        detail: "low",
      },
    });
    expect(
      data.messages[1].content.map((item) => item.text ?? "").join("\n"),
    ).toContain("free_text_description: Keep it stiff.");
  });

  it.each([
    [
      "GROQ_INPUT_TOKEN_LIMIT",
      "Retry with Compact Context (Fit 7k Token Limit)",
    ],
    ["GROQ_RATE_LIMIT", "Copy Full Prompt for ChatGPT / Gemini"],
  ])("returns actionable guidance for %s", (code, expectedSuggestion) => {
    const result = formatApiError(Object.assign(new Error("quota"), { code }));
    expect(result.code).toBe(code);
    expect(result.suggestions.map((suggestion) => suggestion.label)).toContain(
      expectedSuggestion,
    );
  });

  it("rejects non-3mf uploads and unknown routes", async () => {
    const upload = await fetch(`${baseUrl}/api/inspect`, {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-file-name": "part.stl",
      },
      body: projectBuffer,
    });
    expect(upload.status).toBe(400);
    expect((await upload.json()).error).toContain(".3mf");

    const notFound = await fetch(`${baseUrl}/missing`);
    expect(notFound.status).toBe(404);
  });
});

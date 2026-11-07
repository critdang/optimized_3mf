# Slicer Copilot project context

## Purpose and workflow

Slicer Copilot is an ESM Node.js CLI (Node.js 20+) that reads Bambu Studio `.3mf` archives, summarizes printer/filament/process settings, gathers an optimization goal, requests setting recommendations from an OpenAI-compatible chat-completions API, applies validated setting changes, and writes a new `.3mf`. It does not change model geometry and preserves unknown archive entries.

Typical flow: parse archive -> collect intent -> build structured prompt (including available plate previews) -> call/validate LLM response -> apply allowed changes -> print diffs/rationale/warnings -> write output unless `--dry-run`.

## Layout

- `bin/slicer-copilot` — executable CLI entry point.
- `src/cli.js`, `src/config.js`, `src/intent/` — argument parsing, environment configuration, and interactive/JSON intent.
- `src/3mf/parser.js`, `writer.js`, `configMapping.js` — archive parsing, normalized settings, and output writing.
- `src/llm/` — prompt, request construction, model options, API client, response schema, and validation.
- `src/apply/changes.js` — validates/applies proposed global and per-object setting updates.
- `src/utils/`, `src/i18n.js`, `src/logger.js` — summaries, output formatting, localization, and logging.
- `test/` — Vitest coverage; `test/fixtures/sample3mf.js` generates a synthetic archive and `mockResponse.json` is a deterministic response.
- `.github/workflows/` — CI and npm publishing workflows.

## Configuration and CLI

Copy `.env.example` to `.env`. Set `OPENAI_API_KEY` for OpenAI-compatible providers, or `GROQ_API_KEY` to automatically select Groq's endpoint (`https://api.groq.com/openai/v1`) and default model (`qwen/qwen3.8-27b`). `OPENAI_API_KEY` takes precedence when both keys are present. `OPENAI_BASE_URL`, `OPENAI_MODEL`, and `OPENAI_REASONING_EFFORT` are optional overrides. CLI flags override corresponding environment settings.

Run locally with `node bin/slicer-copilot optimize <input.3mf> [options]`:

- `--dry-run` — displays proposed changes without writing an output archive. **It still calls the configured API unless a mock response is supplied.**
- `--non-interactive` — uses the balanced default intent; combine with `--intent-file <file>` for explicit JSON intent.
- `--mock-response <file>` — loads a saved JSON response instead of calling an API; useful for offline smoke tests.
- `-o, --output <file>` — choose output path (default `<input>.optimized.3mf`).
- `--api-key <key>`, `--base-url <url>`, `--model <model>`, `--temperature <number>`, `--reasoning-effort <effort>` — configure the model request.
- Groq requests use the full system prompt, complete formatted project JSON, and full plate previews. Generated output is capped at 900 tokens to fit the 1,000 OTPM quota reported for some service tiers; very complex output may be truncated.
- `--force` — allow changing settings marked as user-modified.
- `--verbose`, `--language <code>` — detailed prompt/payload logging and localized output.

Example offline dry run after creating a fixture archive:

```sh
mkdir -p tmp
node --input-type=module -e 'import { createSample3mf } from "./test/fixtures/sample3mf.js"; import { writeFile } from "node:fs/promises"; const { buffer } = await createSample3mf(); await writeFile("tmp/sample.3mf", buffer);'
node bin/slicer-copilot optimize tmp/sample.3mf --dry-run --non-interactive --mock-response test/fixtures/mockResponse.json
```

For development, run `npm install`, `npm test`, and `npm run lint`. Use `npm run` to inspect available scripts; there is no `start` script.

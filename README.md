# Slicer Copilot

![Demo](https://github.com/user-attachments/assets/5878ea30-bd7d-45ea-9a83-1ee18a6e9b23)

**AI-powered optimization for your Bambu Studio 3D printing projects.**

Slicer Copilot analyzes your `.3mf` project files, understands your goals (like "Maximum Strength" or "Visual Quality"), and uses an LLM to tune your print settings automatically.

## Features

- **Smart Analysis**: Reads printer, filament, and process settings from your `.3mf` file.
- **Goal-Oriented**: Optimize for Strength, Speed, Visual Quality, or a Custom goal.
- **Safe**: Never modifies your 3D geometry. Only tunes process settings.
- **Transparent**: Explains _why_ every change is made.
- **Multi-Language**: Supports English, Russian, Spanish, French, German, and Chinese.
- **CI/CD Ready**: Runs interactively or in fully automated pipelines.

## Getting Started

### Prerequisites

- **Node.js 20** or higher.
- An **OpenAI-compatible API key** (OpenAI, Anthropic via adapter, LocalLLM, etc.).

### Installation

You can run the tool directly using `npx` or install it globally.

```bash
# Run directly
npx slicer-copilot optimize my-project.3mf --api-key=sk-

# Or install globally
npm install -g slicer-copilot
```

### Configuration

Create a `.env` file in your project directory to store your API keys.

```bash
cp .env.example .env
```

**Required variables:**

```ini
OPENAI_API_KEY=sk-...
```

**Optional variables:**

```ini
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o  # Default: gpt-4.1-mini
```

To use Groq, put your key in `GROQ_API_KEY` instead of `OPENAI_API_KEY`. When
only `GROQ_API_KEY` is set, the CLI selects Groq's OpenAI-compatible endpoint
and `qwen/qwen3.8-27b` (which supports strict JSON output and image inputs).
You can override the model or endpoint with `OPENAI_MODEL` and
`OPENAI_BASE_URL`. If both API-key variables are set, `OPENAI_API_KEY` takes
precedence. Groq requests cap generated output at 900 tokens to fit within the
1,000 output-tokens-per-minute quota reported for some service tiers. If a
particularly complex project produces truncated JSON, retry after the quota
window resets or use a Groq tier with a higher limit. Groq requests also use a
complete system prompt and formatted project JSON; plate preview images are
included in full-context mode.

### Reasoning Models

The default remains `gpt-4.1-mini`. To use a supported GPT-6 model:

```bash
npx slicer-copilot --model gpt-6.1-sol --reasoning-effort medium optimize input.3mf
```

You can also set `OPENAI_REASONING_EFFORT` in your environment; the CLI flag takes precedence.

- `gpt-6.1-sol`: `low`, `medium`, `high`, `xhigh`, `max`
- `gpt-6-sol` and `gpt-6-luna`: the same efforts, plus `none`

For these exact model identifiers, leaving the effort unset uses the API default (`medium`). Slicer Copilot omits `temperature` while reasoning is enabled, including when effort is unset. Explicit `none` is sent as `reasoning_effort: "none"` and keeps the configured temperature (default `0.3`). `gpt-6.1-sol` does not support `none`.

Unsupported model/effort combinations fail before sending a request. Other OpenAI-compatible models keep the existing temperature behavior when no reasoning effort is set; their capabilities are not inferred from their names. Check your provider's model support and pricing before switching.

See OpenAI's [GPT-6 parameter guide](https://developers.openai.com/api/docs/guides/latest-model#update-api-and-model-parameters) and model documentation for [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [GPT-6 Sol](https://developers.openai.com/api/docs/models/gpt-6-sol), and [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna).

## Usage

### Interactive Mode (Default)

Simply run the command on your file. The tool will ask you for your optimization goal.

```bash
npx slicer-copilot optimize input.3mf
```

### Dry Run (Safe Mode)

Want to see what _would_ change without writing a new file? Use `--dry-run`.

```bash
npx slicer-copilot optimize input.3mf --dry-run
```

### Automated / Non-Interactive

For scripts or batch processing, use `--non-interactive` and provide an intent file.

```bash
npx slicer-copilot optimize input.3mf \
  --non-interactive \
  --intent-file intent.json
```

### Localization

Switch the interface and AI reasoning language using `--language`.

```bash
npx slicer-copilot optimize input.3mf --language ru
```

**Supported languages:**

- `en` (English)
- `ru` (Russian)
- `es` (Spanish)
- `fr` (French)
- `de` (German)
- `zh` (Chinese)

### Web UI

Start the local interface from the repository:

```bash
npm run web
```

Open the printed `http://127.0.0.1:4173` address. Upload a `.3mf` to inspect its
printer/settings and display the original plate preview images, then choose
OpenAI or Groq, enter a model and (optionally) a per-request API key, and
generate recommendations. The web server binds to loopback only; keys entered
in the UI are sent to the server for the current request and are not stored.
If the key field is blank, the corresponding server environment key is used.
The uploaded project, complete system prompt, complete settings payload, and
plate previews are sent to the selected provider during optimization.
Recommendations do not modify the uploaded project or write an output file.
By default, the UI sends the complete system prompt, project settings, and
plate previews. If Groq rejects the request for token limits, enable
**Compact Context (Fit 7k Token Limit)** to keep core print settings while
omitting custom slice defaults and preview images from the API request. The
original preview remains visible in the UI. Compact mode targets an estimated
5,500 input tokens; provider tokenization and account usage may differ.

Use **Copy Full Prompt for ChatGPT / Gemini** to inspect and copy the full,
uncompressed system prompt, project JSON, intent, and full-resolution preview
data URLs for a manual workflow. The copied prompt contains project data and
images, but not API keys. Groq `413` and `429` errors include buttons to retry
compactly or open the full prompt.

### Deploy to Vercel

The repository includes Vercel serverless functions and a static frontend build.
Deploy from the repository root with the Vercel CLI:

```bash
npm install
npm run build
npx vercel
```

In Vercel, use the repository root as the project root and set the production
environment variables `OPENAI_API_KEY` and/or `GROQ_API_KEY` in Project
Settings → Environment Variables. Redeploy after changing environment
variables. The UI also accepts a per-request key without saving it. The
`/api/inspect`, `/api/optimize`, `/api/prompt`, and `/api/settings` routes are
serverless functions; `/api/inspect` rewrites to the parsing function. Static
assets are built from `web/` into `dist/`.

Vercel deployments accept `.3mf` uploads up to 3 MiB and limit JSON API
responses to 4 MiB to stay within serverless request/response constraints.
Larger projects can use the local UI, whose upload limit is 256 MiB. Full
previews are returned and rendered for accepted files.

**Protect public deployments.** If an API key is configured in Vercel, anyone
who can reach the deployment may be able to invoke it and consume that key's
quota. Enable Vercel Deployment Protection or otherwise restrict access; for
an unrestricted public deployment, leave provider keys unset and have each
user supply their own key in the UI.

## Optimization Goals

When running interactively, you can choose from the following goals:

| Goal                    | Description                                                      |
| :---------------------- | :--------------------------------------------------------------- |
| **Balanced**            | A good mix of speed, quality, and strength.                      |
| **Functional Strength** | Prioritizes part durability and layer adhesion.                  |
| **Visual Quality**      | Focuses on surface finish and fine details.                      |
| **Draft / Speed**       | Maximizes print speed for prototypes.                            |
| **Custom**              | Follows your specific instructions (e.g., "Make it watertight"). |

## Example Output

Here is what the tool looks like in action:

```text
npx slicer-copilot optimize new-years-ball.3mf --output test-ny.3mf
✔ Project loaded successfully

╭ ★ Slicer Copilot ────╮
│  Project Summary     │
│  new-years-ball.3mf  │
╰──────────────────────╯
╭──────────────────────────────────┬───────────────────────────────────────────────────────────────────────────╮
│ ℹ Field                          │ → Details                                                                 │
├──────────────────────────────────┼───────────────────────────────────────────────────────────────────────────┤
│ ◼ File                           │ new-years-ball.3mf                                                        │
├──────────────────────────────────┼───────────────────────────────────────────────────────────────────────────┤
│ ▶ Printer                        │ Bambu Lab H2S ● 0.4mm nozzle ● Bed: Textured PEI Plate                    │
├──────────────────────────────────┼───────────────────────────────────────────────────────────────────────────┤
│ ◉ Filament                       │ Bambu PLA Basic @BBL H2S [PLA]                                            │
├──────────────────────────────────┼───────────────────────────────────────────────────────────────────────────┤
│ ❯ Profile                        │ 0.20mm Standard @BBL H2S                                                  │
├──────────────────────────────────┼───────────────────────────────────────────────────────────────────────────┤
│ ☰ Process                        │ Layer 0.12 mm │ Walls 2 │ Infill 5% │ gyroid                              │
╰──────────────────────────────────┴───────────────────────────────────────────────────────────────────────────╯
★ Select optimization goal (↑/↓ + Enter)

  Balanced
› Functional Strength — Maximum durability and load capacity
  Visual Quality
  Draft / Speed
  Custom


📝 Add notes about the model (geometry, material quirks, desired result)
   Press Enter to skip
›
✓ Selected: Functional Strength
✔ AI analysis complete

╭─────────────────────────────╮
│ ★ 24 Suggested Changes      │
╰─────────────────────────────╯
╭─────────────────────────────────┬─────────────────────────────┬────────────────────────────────────────────╮
│ ☰ Parameter                     │ → Change                    │ ℹ Reason                                   │
├─────────────────────────────────┼─────────────────────────────┼────────────────────────────────────────────┤
│ wall_line_count                 │ 2 → 3                       │ Increase perimeters to 3 to reinforce the  │
│                                 │                             │ shell and mounting loops without changing  │
│                                 │                             │ geometry.                                  │
├─────────────────────────────────┼─────────────────────────────┼────────────────────────────────────────────┤
│ infill_density_percent          │ 5 → 15                      │ Increase infill from 5% to 15% for better  │
│                                 │                             │ overall part strength and impact           │
│                                 │                             │ resistance.                                │
├─────────────────────────────────┼─────────────────────────────┼────────────────────────────────────────────┤
│ nozzle_temp_c                   │ 220 → 225                   │ Slightly increase PLA nozzle temp to 225°C │
│                                 │                             │ to improve layer adhesion while staying    │
│                                 │                             │ within recommended range.                  │
├─────────────────────────────────┼─────────────────────────────┼────────────────────────────────────────────┤
│ fan_speed_percent               │ 100 → 80                    │ Reduce cooling to 80% to improve layer     │
│                                 │                             │ bonding, while maintaining enough cooling  │
│                                 │                             │ for the surface details.                   │
├─────────────────────────────────┼─────────────────────────────┼────────────────────────────────────────────┤
│ speeds.wall_inner               │ 150 → 100                   │ Slow down inner walls to 100 mm/s to       │
│                                 │                             │ reduce vibration and improve bonding.      │
╰─────────────────────────────────┴─────────────────────────────┴────────────────────────────────────────────╯

╭ ★ Strategy ──────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ ❯ Settings biased towards strength: more perimeters and infill, higher temperature, reduced cooling, and reduced │
│ speeds on critical sections for better layer adhesion.                                                           │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯

╭──────────────────────────────────────────────────╮
│ ✔ Optimized project written to test-ny.3mf       │
╰──────────────────────────────────────────────────╯
```

## Advanced Options

| Flag                     | Description                                                            |
| :----------------------- | :--------------------------------------------------------------------- |
| `--output <file>`        | Specify the output filename (default: `*.optimized.3mf`).              |
| `--force`                | Allow the AI to overwrite settings you manually changed in the slicer. |
| `--verbose`              | Show the full prompt and JSON payload sent to the AI.                  |
| `--mock-response <file>` | Use a saved JSON response instead of calling the API (for testing).    |

## How It Works

1. **Parses**: Extracts printer info, filament data, and current settings from the `.3mf` archive.
2. **Analyzes**: Sends a summary and plate previews to the LLM.
3. **Optimizes**: The AI suggests specific setting changes based on your goal.
4. **Applies**: Updates the configuration files inside the archive.
5. **Saves**: Writes a new `.3mf` file. **Geometry is never touched.**

## Development

Pull requests run tests, lint, and formatting checks on Node.js 24 in GitHub Actions.

```bash
# Install dependencies
npm install

# Run tests
npm test

# Lint code
npm run lint
```

---

_Note: This tool is experimental. Always preview the sliced file in Bambu Studio before printing._

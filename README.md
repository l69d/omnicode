# omnicode

**One coding agent, any model.** An interactive, agentic coding CLI in the spirit of
Claude Code — read/edit code, run commands, search, fetch the web, spawn sub-agents —
but the underlying LLM is **pluggable**. Point it at Claude, GPT, Gemini, DeepSeek,
Groq, xAI, Mistral, a local Ollama model, or *any* OpenAI-compatible endpoint.

```
omnicode -m anthropic:claude-opus-4-8     # Claude
omnicode -m openai:gpt-4o                  # GPT
omnicode -m google:gemini-2.0-flash        # Gemini
omnicode -m deepseek:deepseek-chat         # DeepSeek
omnicode -m ollama:qwen2.5-coder           # fully local, no API key
```

Built on the [Vercel AI SDK](https://sdk.vercel.ai), whose unified provider interface
normalizes streaming and tool-calling across every provider — so the agent loop is the
same no matter which model is driving it.

---

## Why

Claude Code is excellent, but it only runs Claude. omnicode is a from-scratch,
model-agnostic clone of the *experience*: the same agentic loop and tool suite, with a
provider layer you can swap. Use the frontier model for hard tasks, a cheap/fast model
for routine edits, or a local model for privacy and zero cost — without changing
anything else.

## Install

```bash
git clone https://github.com/l69d/omnicode
cd omnicode
npm install        # builds automatically
npm link           # puts `omnicode` (and `omni`) on your PATH
```

Requires Node 18+. (Published builds expose the `omnicode` and `omni` commands.)

## Quick start

```bash
export ANTHROPIC_API_KEY=sk-...      # or OPENAI_API_KEY, GROQ_API_KEY, etc.
omnicode                              # interactive session
omnicode -m groq:llama-3.3-70b-versatile
omnicode -p "explain what this repo does"     # one-shot, non-interactive
echo "add a --json flag to the CLI" | omnicode -p
```

With no key set, omnicode auto-detects what's available and falls back to a local
`ollama:qwen2.5-coder` model.

## Supported models

| Provider | Spec example | API key env |
|---|---|---|
| Anthropic | `anthropic:claude-opus-4-8` | `ANTHROPIC_API_KEY` |
| OpenAI | `openai:gpt-4o` | `OPENAI_API_KEY` |
| Google | `google:gemini-2.0-flash` | `GOOGLE_GENERATIVE_AI_API_KEY` |
| DeepSeek | `deepseek:deepseek-chat` | `DEEPSEEK_API_KEY` |
| Groq | `groq:llama-3.3-70b-versatile` | `GROQ_API_KEY` |
| OpenRouter | `openrouter:anthropic/claude-3.5-sonnet` | `OPENROUTER_API_KEY` |
| xAI | `xai:grok-2-latest` | `XAI_API_KEY` |
| Mistral | `mistral:mistral-large-latest` | `MISTRAL_API_KEY` |
| Together / Fireworks / Cerebras | `together:...` etc. | provider key |
| Ollama (local) | `ollama:qwen2.5-coder` | — none — |
| LM Studio (local) | `lmstudio:<model>` | — none — |

**Any** OpenAI-compatible endpoint works — register it once:

```bash
omnicode provider add myhost --base-url https://my-host/v1 --key-env MYHOST_KEY
omnicode -m myhost:some-model
```

## Features

- **Pluggable models** — native SDKs for Claude/GPT/Gemini (so provider features like
  extended thinking light up), OpenAI-compatible adapter for everything else.
- **Full tool suite** — `read_file`, `list_directory`, `glob`, `grep`, `write_file`,
  `edit_file`, `multi_edit`, `run_command`, `web_fetch`, `update_todos`, `spawn_agent`.
- **Agentic loop** — streaming responses, multi-step tool use, live tool/▸todo rendering.
- **Permission modes** — `default` (prompt on writes/commands), `acceptEdits`,
  `plan` (read-only research + plan), `bypass`. Switch live with `/mode`.
- **Sub-agents** — delegate focused searches/investigations to keep context lean.
- **Project memory** — reads `OMNI.md` *and* `CLAUDE.md` up the directory tree, so it's
  a drop-in for an existing Claude Code repo. `/init` generates one for you.
- **Sessions** — auto-saved; `--continue` / `--resume <id>` to pick up where you left off.
- **`/compact`** — summarize the conversation to reclaim context window.
- **Extended thinking** — `--thinking` / `/thinking on` for Anthropic reasoning.
- **MCP** — connect Model Context Protocol servers and use their tools (same ecosystem
  as Claude Code). Declare them in `~/.omnicode/config.json`.
- **@file mentions** — reference a file in chat with `@path/to/file` and its contents
  are attached as context automatically.
- **Custom commands** — drop a markdown file in `~/.omnicode/commands/` (or
  `.omnicode/commands/` in a project); `foo.md` becomes `/foo`, with `$ARGUMENTS` and
  `$1`,`$2`… substitution. List them with `/commands`.
- **Model aliases** — short names for common models: `opus`, `sonnet`, `gpt`, `gemini`,
  `deepseek`, `llama`, `local` (e.g. `omnicode -m opus`).
- **JSON output** — `omnicode -p "…" --json` prints `{ result, model, usage, steps }`
  for scripting.

## Slash commands

```
/help                 /model [spec]        /models
/mode [name]          /thinking [on|off]   /tools
/usage                /clear               /compact
/save                 /resume [id]         /init        /exit
```

## Configuration

`~/.omnicode/config.json` (created on first run). API keys are **never** stored here —
they're read from the environment.

```json
{
  "model": "anthropic:claude-sonnet-4-6",
  "permissionMode": "default",
  "maxSteps": 50,
  "thinking": false,
  "providers": {
    "myhost": { "baseURL": "https://my-host/v1", "apiKeyEnv": "MYHOST_KEY" }
  },
  "mcpServers": {
    "filesystem": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] }
  }
}
```

## How it works

```
your prompt ──▶ Agent ──▶ AI SDK streamText(model, tools)
                  ▲              │
                  │              ├─ text delta  → streamed to terminal
                  │              ├─ tool call   → permission gate → execute → result
                  └──────────────┘   (loops until the model stops calling tools)
```

The model is resolved from `provider:model` into an AI SDK `LanguageModel`
(`src/providers.ts`). Everything else — the loop, tools, permissions — is
provider-independent.

## Development

```bash
npm run dev -- -m ollama:qwen2.5:7b      # run from TypeScript
npm run build                             # compile to dist/
```

Layout: `src/cli.ts` (entry/REPL), `src/agent.ts` (loop), `src/providers.ts`
(model layer), `src/tools/*` (tools), `src/permissions.ts`, `src/mcp.ts`.

## Roadmap

- Prompt caching for Anthropic (cache the system prompt + tool defs)
- Image/PDF inputs for multimodal models
- Hooks (pre/post tool-use shell hooks)
- Richer inline diff rendering for edits

## License

MIT © Karthik Gowda

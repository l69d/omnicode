#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Agent } from "./agent.js";
import { loadConfig, saveConfig, type OmniConfig, type PermissionMode } from "./config.js";
import { autoDetectModel, resolveModel, ProviderError, BUILTIN_PROVIDERS } from "./providers.js";
import { PermissionManager } from "./permissions.js";
import { UI, pc } from "./ui.js";
import { handleSlash } from "./slash.js";
import { loadMcpTools } from "./mcp.js";
import { newSessionId, saveSession, loadSession, latestSession, type SessionData } from "./session.js";

const VERSION = "0.1.0";

interface Args {
  model?: string;
  mode?: PermissionMode;
  prompt?: string;
  print: boolean;
  cont: boolean;
  resume?: string;
  thinking?: boolean;
  maxSteps?: number;
  help: boolean;
  version: boolean;
  sub?: string[];
}

function parseArgs(argv: string[]): Args {
  const a: Args = { print: false, cont: false, help: false, version: false };
  if (argv[0] === "provider" || argv[0] === "config") {
    a.sub = argv;
    return a;
  }
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    switch (t) {
      case "-m": case "--model": a.model = argv[++i]; break;
      case "--mode": a.mode = argv[++i] as PermissionMode; break;
      case "-p": case "--print": a.print = true; break;
      case "-c": case "--continue": a.cont = true; break;
      case "--resume": a.resume = argv[++i]; break;
      case "--thinking": a.thinking = true; break;
      case "--max-steps": a.maxSteps = parseInt(argv[++i], 10); break;
      case "-h": case "--help": a.help = true; break;
      case "-v": case "--version": a.version = true; break;
      default:
        if (t.startsWith("-")) { /* ignore unknown flag */ }
        else positionals.push(t);
    }
  }
  if (positionals.length) a.prompt = positionals.join(" ");
  return a;
}

const HELP_TEXT = `
${pc.bold("omnicode")} — a model-agnostic agentic coding CLI (like Claude Code, any model)

${pc.bold("Usage:")}
  omnicode                          Start an interactive session
  omnicode -p "prompt"              Run one prompt non-interactively and print the result
  echo "prompt" | omnicode -p       Read the prompt from stdin
  omnicode -m openai:gpt-4o         Pick the model for this session
  omnicode --resume <id>            Resume a saved session
  omnicode -c                       Continue the most recent session in this directory
  omnicode provider add <name> --base-url <url> [--key-env <ENV>]
  omnicode config [path|show]

${pc.bold("Flags:")}
  -m, --model <spec>     Model as provider:model (e.g. anthropic:claude-opus-4-8, ollama:qwen2.5-coder)
      --mode <name>      Permission mode: default | acceptEdits | plan | bypass
      --thinking         Enable extended thinking (Anthropic)
      --max-steps <n>    Max tool-use steps per turn
  -p, --print            Non-interactive: run one prompt and exit
  -c, --continue         Resume the most recent session here
      --resume <id>      Resume a specific session
  -h, --help             Show this help
  -v, --version          Show version

${pc.bold("Models:")} set the matching API key in your environment
  ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, DEEPSEEK_API_KEY,
  GROQ_API_KEY, OPENROUTER_API_KEY, XAI_API_KEY, MISTRAL_API_KEY, ... (ollama needs none)
`;

function handleProviderSubcommand(argv: string[], config: OmniConfig, ui: UI): void {
  const [, action, name, ...rest] = argv;
  if (action === "add" && name) {
    let baseURL = "", keyEnv: string | undefined;
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === "--base-url") baseURL = rest[++i];
      else if (rest[i] === "--key-env") keyEnv = rest[++i];
    }
    if (!baseURL) {
      ui.error("  --base-url is required.");
      return;
    }
    config.providers = { ...config.providers, [name]: { baseURL, apiKeyEnv: keyEnv } };
    saveConfig(config);
    ui.success(`  Added provider "${name}" → ${baseURL}. Use it as ${name}:<model>.`);
    return;
  }
  if (action === "list" || !action) {
    ui.line(pc.bold("Built-in providers:"));
    for (const [n, p] of Object.entries(BUILTIN_PROVIDERS)) ui.line(`  ${n.padEnd(12)} ${p.label}`);
    if (config.providers && Object.keys(config.providers).length) {
      ui.line(pc.bold("\nCustom providers:"));
      for (const [n, p] of Object.entries(config.providers)) ui.line(`  ${n.padEnd(12)} ${p.baseURL}`);
    }
    return;
  }
  ui.error("  Usage: omnicode provider add <name> --base-url <url> [--key-env <ENV>]");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const ui = new UI();

  if (args.version) {
    ui.line(`omnicode ${VERSION}`);
    ui.close();
    return;
  }
  if (args.help) {
    ui.line(HELP_TEXT);
    ui.close();
    return;
  }
  if (args.sub) {
    if (args.sub[0] === "provider") handleProviderSubcommand(args.sub, config, ui);
    else if (args.sub[0] === "config") {
      if (args.sub[1] === "show") ui.line(JSON.stringify(config, null, 2));
      else ui.line(join(process.env.HOME ?? "~", ".omnicode", "config.json"));
    }
    ui.close();
    return;
  }

  // Apply CLI overrides to config.
  if (args.mode) config.permissionMode = args.mode;
  if (args.thinking) config.thinking = true;
  if (args.maxSteps) config.maxSteps = args.maxSteps;

  // Resolve model.
  const spec = args.model || config.model || autoDetectModel();
  if (!spec) {
    ui.error("No model configured. Set one with -m provider:model or in ~/.omnicode/config.json.");
    ui.close();
    return;
  }
  let resolved;
  try {
    resolved = resolveModel(spec, config);
  } catch (e) {
    if (e instanceof ProviderError) ui.error("\n" + e.message + "\n");
    else throw e;
    ui.close();
    return;
  }

  const cwd = process.cwd();
  const permissions = new PermissionManager(config.permissionMode ?? "default", ui);
  if (args.print) permissions.nonInteractive = true;

  // Load MCP tools (best-effort).
  const mcp = await loadMcpTools(config, ui);

  const agent = new Agent(resolved, config, ui, permissions, cwd, mcp.tools);

  // Session restore.
  let session: SessionData;
  if (args.resume) {
    const s = loadSession(args.resume);
    if (s) {
      agent.messages = s.messages;
      session = s;
      ui.info(`Resumed session ${args.resume}.`);
    } else {
      ui.warn(`No session "${args.resume}"; starting fresh.`);
      session = freshSession(cwd, spec);
    }
  } else if (args.cont) {
    const s = latestSession(cwd);
    if (s) {
      agent.messages = s.messages;
      session = s;
      ui.info(`Continuing most recent session (${s.id}).`);
    } else {
      session = freshSession(cwd, spec);
    }
  } else {
    session = freshSession(cwd, spec);
  }

  const applyModel = (modelSpec: string) => {
    const r = resolveModel(modelSpec, config);
    agent.setModel(r);
    config.model = modelSpec;
    session.model = modelSpec;
    saveConfig(config);
  };

  const persist = () => {
    session.messages = agent.messages;
    session.usage = agent.totalUsage;
    session.model = `${agent.model.provider}:${agent.model.modelId}`;
    saveSession(session);
  };

  // Ctrl-C: cancel the active turn, or exit at the prompt.
  let currentAbort: AbortController | null = null;
  process.on("SIGINT", () => {
    if (currentAbort) {
      currentAbort.abort();
      currentAbort = null;
      ui.warn("\n  (cancelled)");
    } else {
      ui.line();
      persist();
      ui.close();
      process.exit(0);
    }
  });

  const runTurn = async (prompt: string): Promise<string> => {
    currentAbort = new AbortController();
    try {
      const res = await agent.send(prompt, currentAbort.signal);
      ui.usage(res.usage.input, res.usage.output, res.steps);
      return res.text;
    } catch (e: any) {
      if (e?.name === "AbortError" || /abort/i.test(e?.message ?? "")) return "";
      ui.error(`\n  Error: ${e.message ?? e}`);
      return "";
    } finally {
      currentAbort = null;
      persist();
    }
  };

  // Non-interactive single-shot.
  if (args.print) {
    let prompt = args.prompt;
    if (!prompt && !process.stdin.isTTY) prompt = readFileSync(0, "utf8").trim();
    if (!prompt) {
      ui.error("No prompt provided. Use: omnicode -p \"your prompt\"");
      await mcp.close();
      ui.close();
      return;
    }
    await runTurn(prompt);
    await mcp.close();
    ui.close();
    return;
  }

  // Interactive REPL.
  ui.banner(`${resolved.provider}:${resolved.modelId}`, permissions.mode, cwd);
  if (args.prompt) {
    // A prompt was passed positionally without -p: run it first, then continue interactively.
    await runTurn(args.prompt);
  }

  while (true) {
    const input = await ui.readPrompt();
    if (!input) continue;

    if (input.startsWith("/")) {
      const result = await handleSlash(input, { agent, ui, config, permissions, cwd, persist, applyModel });
      if (result.exit) break;
      if (result.runPrompt) {
        const text = await runTurn(result.runPrompt);
        if (result.compact && text) {
          agent.messages = [
            { role: "user", content: `Context from earlier in this session (compacted):\n\n${text}` },
          ];
          ui.success("  Conversation compacted.");
        }
      }
      continue;
    }

    await runTurn(input);
  }

  persist();
  await mcp.close();
  ui.close();
}

function freshSession(cwd: string, model: string): SessionData {
  const now = Date.now();
  return { id: newSessionId(), createdAt: now, updatedAt: now, cwd, model, usage: { input: 0, output: 0 }, messages: [] };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

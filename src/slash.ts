import type { Agent } from "./agent.js";
import type { OmniConfig, PermissionMode } from "./config.js";
import { saveConfig } from "./config.js";
import type { PermissionManager } from "./permissions.js";
import { UI, pc } from "./ui.js";
import { BUILTIN_PROVIDERS } from "./providers.js";
import { listSessions, loadSession } from "./session.js";

export interface SlashDeps {
  agent: Agent;
  ui: UI;
  config: OmniConfig;
  permissions: PermissionManager;
  cwd: string;
  persist: () => void;
  /** Resolve a "provider:model" spec, set it on the agent, and persist as default. */
  applyModel: (spec: string) => void;
}

export interface SlashResult {
  handled: boolean;
  exit?: boolean;
  /** If set, the CLI should run this as a normal agent turn. */
  runPrompt?: string;
  /** If set with runPrompt, the CLI replaces history with the turn's output. */
  compact?: boolean;
}

const HELP = `
Commands:
  /help                 Show this help
  /model [spec]         Show or switch model (e.g. /model openai:gpt-4o)
  /models               List supported providers and example specs
  /mode [name]          Show or set permission mode: default|acceptEdits|plan|bypass
  /thinking [on|off]    Toggle extended thinking (Anthropic)
  /tools                List available tools
  /usage                Show token usage this session
  /clear                Clear the conversation
  /compact              Summarize the conversation to free up context
  /save                 Save this session
  /resume [id]          List saved sessions, or resume one
  /init                 Analyze the repo and write an OMNI.md memory file
  /exit                 Quit
`;

const MODES: PermissionMode[] = ["default", "acceptEdits", "plan", "bypass"];

export async function handleSlash(input: string, deps: SlashDeps): Promise<SlashResult> {
  const { ui, agent, config, permissions } = deps;
  const [cmd, ...rest] = input.slice(1).trim().split(/\s+/);
  const arg = rest.join(" ");

  switch (cmd) {
    case "help":
      ui.line(pc.dim(HELP));
      return { handled: true };

    case "exit":
    case "quit":
      return { handled: true, exit: true };

    case "clear":
      agent.messages = [];
      agent.todos.length = 0;
      agent.totalUsage = { input: 0, output: 0 };
      ui.success("  Conversation cleared.");
      return { handled: true };

    case "model":
      if (!arg) {
        ui.info(`  Current model: ${pc.cyan(`${agent.model.provider}:${agent.model.modelId}`)} (${agent.model.label})`);
        ui.info("  Switch with: /model <provider>:<model>   ·   see /models");
        return { handled: true };
      }
      try {
        deps.applyModel(arg);
        ui.success(`  Switched to ${pc.cyan(arg)}.`);
      } catch (e: any) {
        ui.error(`  ${e.message}`);
      }
      return { handled: true };

    case "models": {
      ui.line(pc.bold("\n  Built-in providers:"));
      for (const [name, p] of Object.entries(BUILTIN_PROVIDERS)) {
        const key = p.apiKeyEnv ? pc.dim(` [${p.apiKeyEnv}]`) : pc.dim(" [no key]");
        ui.line(`    ${pc.cyan(name.padEnd(12))} ${p.label}${key}`);
      }
      ui.line(pc.dim("\n  Examples: anthropic:claude-opus-4-8 · openai:gpt-4o · google:gemini-2.0-flash"));
      ui.line(pc.dim("            deepseek:deepseek-chat · groq:llama-3.3-70b-versatile · ollama:qwen2.5-coder"));
      ui.line(pc.dim("  Register any OpenAI-compatible endpoint in ~/.omnicode/config.json under \"providers\".\n"));
      return { handled: true };
    }

    case "mode":
      if (!arg) {
        ui.info(`  Permission mode: ${pc.cyan(permissions.mode)}  (options: ${MODES.join(", ")})`);
        return { handled: true };
      }
      if (!MODES.includes(arg as PermissionMode)) {
        ui.error(`  Unknown mode "${arg}". Options: ${MODES.join(", ")}`);
        return { handled: true };
      }
      permissions.setMode(arg as PermissionMode);
      agent.refreshSystem();
      config.permissionMode = arg as PermissionMode;
      ui.success(`  Permission mode: ${arg}`);
      return { handled: true };

    case "thinking": {
      const on = arg === "on" || (arg === "" && !config.thinking);
      config.thinking = on;
      saveConfig(config);
      ui.success(`  Extended thinking: ${on ? "on" : "off"}` + (agent.model.provider !== "anthropic" ? pc.dim("  (only applies to Anthropic models)") : ""));
      return { handled: true };
    }

    case "tools":
      ui.line(pc.bold("\n  Tools:"));
      for (const name of [
        "read_file", "list_directory", "glob", "grep",
        "write_file", "edit_file", "multi_edit",
        "run_command", "web_fetch", "update_todos", "spawn_agent",
      ]) {
        ui.line(`    ${pc.cyan(name)}`);
      }
      ui.line(pc.dim("  Plus any tools from configured MCP servers (name__tool).\n"));
      return { handled: true };

    case "usage":
    case "cost":
      ui.info(`  Tokens this session: ${agent.totalUsage.input} in / ${agent.totalUsage.output} out`);
      return { handled: true };

    case "save":
      deps.persist();
      ui.success("  Session saved.");
      return { handled: true };

    case "resume": {
      if (!arg) {
        const sessions = listSessions().slice(0, 15);
        if (sessions.length === 0) {
          ui.info("  No saved sessions.");
          return { handled: true };
        }
        ui.line(pc.bold("\n  Recent sessions:"));
        for (const s of sessions) {
          const when = new Date(s.updatedAt).toLocaleString();
          const first = s.messages.find((m) => m.role === "user");
          const preview = typeof first?.content === "string" ? first.content.slice(0, 50) : "";
          ui.line(`    ${pc.cyan(s.id)}  ${pc.dim(when)}  ${preview}`);
        }
        ui.line(pc.dim("\n  Resume with: /resume <id>\n"));
        return { handled: true };
      }
      const s = loadSession(arg);
      if (!s) {
        ui.error(`  No session "${arg}".`);
        return { handled: true };
      }
      agent.messages = s.messages;
      ui.success(`  Resumed session ${arg} (${s.messages.length} messages).`);
      return { handled: true };
    }

    case "compact":
      return {
        handled: true,
        compact: true,
        runPrompt:
          "Summarize our conversation so far into a compact brief that preserves all decisions, " +
          "file paths touched, the current task state, and any open TODOs. Output only the summary.",
      };

    case "init":
      return {
        handled: true,
        runPrompt:
          "Analyze this repository and create an OMNI.md file at the project root. It should concisely " +
          "document: what the project is, how to build/test/run it, the high-level architecture and key " +
          "directories, and any conventions a new contributor should follow. Inspect package manifests, " +
          "configs, and the directory structure first, then write the file with write_file.",
      };

    default:
      ui.error(`  Unknown command: /${cmd}. Try /help.`);
      return { handled: true };
  }
}

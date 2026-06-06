import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Global config + settings for omnicode.
 *
 * Config lives at ~/.omnicode/config.json and stores the user's default model,
 * permission mode, and any provider settings (base URLs, custom providers).
 * API keys are NEVER stored here — they are read from the environment so we
 * don't end up writing secrets to disk (matches the user's secrets-handling pref).
 */

export const OMNI_HOME = join(homedir(), ".omnicode");
export const CONFIG_PATH = join(OMNI_HOME, "config.json");
export const SESSIONS_DIR = join(OMNI_HOME, "sessions");
export const COMMANDS_DIR = join(OMNI_HOME, "commands");

export type PermissionMode =
  | "default" // prompt for writes/bash
  | "acceptEdits" // auto-accept file edits, prompt for bash
  | "plan" // read-only: research + plan, no mutations
  | "bypass"; // run everything without prompting (a.k.a. yolo)

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface CustomProvider {
  /** OpenAI-compatible base URL, e.g. https://my-host/v1 */
  baseURL: string;
  /** Name of the env var holding the API key (optional for local servers). */
  apiKeyEnv?: string;
}

export interface OmniConfig {
  /** Default model in "provider:model" form, e.g. "anthropic:claude-opus-4-8". */
  model?: string;
  /** Optional small/fast model used for subagents + summarization. */
  smallModel?: string;
  permissionMode?: PermissionMode;
  /** Max agent steps (tool-use round trips) before stopping. */
  maxSteps?: number;
  /** Max output tokens per model call. */
  maxTokens?: number;
  temperature?: number;
  /** Enable extended thinking / reasoning where the provider supports it. */
  thinking?: boolean;
  /** User-registered OpenAI-compatible providers, keyed by provider name. */
  providers?: Record<string, CustomProvider>;
  /** MCP servers to connect on startup, keyed by name. */
  mcpServers?: Record<string, McpServerConfig>;
}

const DEFAULTS: OmniConfig = {
  permissionMode: "default",
  maxSteps: 50,
  maxTokens: 8192,
  temperature: 0,
  thinking: false,
};

export function ensureHome(): void {
  for (const dir of [OMNI_HOME, SESSIONS_DIR, COMMANDS_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
}

export function loadConfig(): OmniConfig {
  ensureHome();
  if (!existsSync(CONFIG_PATH)) return { ...DEFAULTS };
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
    return { ...DEFAULTS, ...raw };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveConfig(cfg: OmniConfig): void {
  ensureHome();
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2) + "\n");
}

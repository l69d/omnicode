import type { UI } from "../ui.js";
import type { PermissionManager } from "../permissions.js";
import type { OmniConfig } from "../config.js";
import type { ResolvedModel } from "../providers.js";

export interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
}

export interface ToolContext {
  cwd: string;
  ui: UI;
  permissions: PermissionManager;
  config: OmniConfig;
  resolvedModel: ResolvedModel;
  /** Shared, mutable todo list rendered to the user. */
  todos: TodoItem[];
  /**
   * Runs a focused sub-agent and resolves with its final text answer.
   * Injected by the agent layer to avoid a circular import.
   */
  runSubAgent?: (description: string, prompt: string, signal?: AbortSignal) => Promise<string>;
}

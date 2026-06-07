import { streamText, stepCountIs } from "ai";
import type { ModelMessage, ToolSet, UserContent } from "ai";
import type { OmniConfig } from "./config.js";
import type { ResolvedModel } from "./providers.js";
import { UI } from "./ui.js";
import { PermissionManager } from "./permissions.js";
import { buildTools, type TodoItem } from "./tools/index.js";
import { buildSystemPrompt } from "./systemPrompt.js";
import { loadMemory } from "./memory.js";
import { HookRunner, withHooks } from "./hooks.js";

export interface Usage {
  input: number;
  output: number;
}

interface TurnResult {
  text: string;
  usage: Usage;
  steps: number;
  newMessages: ModelMessage[];
}

interface RunTurnOpts {
  model: ResolvedModel;
  system: string;
  messages: ModelMessage[];
  tools: ToolSet;
  config: OmniConfig;
  ui: UI;
  render: boolean;
  signal?: AbortSignal;
}

function inputSummary(toolName: string, input: any): string {
  if (!input || typeof input !== "object") return "";
  if ("path" in input) return String(input.path);
  if ("command" in input) return String(input.command).slice(0, 80);
  if ("pattern" in input) return String(input.pattern);
  if ("url" in input) return String(input.url);
  if ("description" in input) return String(input.description);
  if ("todos" in input) return `${(input.todos as any[])?.length ?? 0} items`;
  return "";
}

/** Provider-specific options (extended thinking for Anthropic, etc.). */
function providerOptions(model: ResolvedModel, config: OmniConfig): Record<string, any> | undefined {
  if (model.provider === "anthropic" && config.thinking) {
    return { anthropic: { thinking: { type: "enabled", budgetTokens: 6000 } } };
  }
  return undefined;
}

/** Core single-turn driver: streams a model response, runs tools, returns result. */
async function runTurn(opts: RunTurnOpts): Promise<TurnResult> {
  const { model, system, messages, tools, config, ui, render, signal } = opts;
  const thinking = model.provider === "anthropic" && config.thinking;

  // Anthropic prompt caching: marking the system block as ephemeral caches the
  // tool definitions + system prompt prefix, cutting cost/latency on later turns.
  const cache = model.provider === "anthropic" && config.promptCaching === true;
  const cachedMessages: ModelMessage[] = cache
    ? [
        {
          role: "system",
          content: system,
          providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
        },
        ...messages,
      ]
    : messages;

  const result = streamText({
    model: model.model,
    system: cache ? undefined : system,
    messages: cachedMessages,
    tools,
    stopWhen: stepCountIs(config.maxSteps ?? 50),
    temperature: thinking ? undefined : config.temperature,
    maxOutputTokens: thinking ? Math.max(config.maxTokens ?? 8192, 12000) : config.maxTokens,
    providerOptions: providerOptions(model, config),
    abortSignal: signal,
  });

  let text = "";
  let needMarker = true;
  let steps = 1;
  let streamErr: unknown = null;

  for await (const part of result.fullStream) {
    switch (part.type) {
      case "text-delta": {
        if (render && needMarker) {
          ui.assistantStart();
          needMarker = false;
        }
        if (render) ui.write(part.text);
        text += part.text;
        break;
      }
      case "reasoning-delta": {
        if (render) ui.reasoning(part.text);
        break;
      }
      case "tool-call": {
        if (render) {
          if (!needMarker) ui.line();
          ui.toolCall(part.toolName, inputSummary(part.toolName, (part as any).input));
          needMarker = true;
        }
        break;
      }
      case "tool-result": {
        if (render) {
          const out = (part as any).output;
          ui.toolResult(typeof out === "string" ? out : JSON.stringify(out, null, 2));
        }
        break;
      }
      case "tool-error": {
        if (render) ui.toolError(String((part as any).error));
        break;
      }
      case "finish-step": {
        steps++;
        break;
      }
      case "error": {
        streamErr = (part as any).error;
        break;
      }
    }
  }

  if (streamErr) throw streamErr instanceof Error ? streamErr : new Error(String(streamErr));

  const usageRaw = await result.usage.catch(() => undefined);
  const response = await result.response;
  if (render && text) ui.line();

  return {
    text,
    usage: { input: usageRaw?.inputTokens ?? 0, output: usageRaw?.outputTokens ?? 0 },
    steps: Math.max(1, steps - 1),
    newMessages: response.messages,
  };
}

/** The interactive agent: owns conversation history and shared state. */
export class Agent {
  messages: ModelMessage[] = [];
  todos: TodoItem[] = [];
  totalUsage: Usage = { input: 0, output: 0 };
  private tools: ToolSet;
  private system: string;
  private hookRunner!: HookRunner;

  constructor(
    public model: ResolvedModel,
    public config: OmniConfig,
    public ui: UI,
    public permissions: PermissionManager,
    public cwd: string,
    extraTools: ToolSet = {},
  ) {
    this.system = this.rebuildSystem();
    const ctx = {
      cwd,
      ui,
      permissions,
      config,
      resolvedModel: model,
      todos: this.todos,
      runSubAgent: (description: string, prompt: string, signal?: AbortSignal) =>
        this.runSubAgent(prompt, signal),
    };
    this.hookRunner = new HookRunner(config.hooks ?? [], cwd);
    this.tools = withHooks({ ...buildTools(ctx), ...extraTools }, this.hookRunner, ui);
  }

  private rebuildSystem(): string {
    return buildSystemPrompt({
      cwd: this.cwd,
      mode: this.permissions.mode,
      modelLabel: `${this.model.label} (${this.model.modelId})`,
      memory: loadMemory(this.cwd),
    });
  }

  /** Refresh the system prompt (e.g. after a permission-mode change). */
  refreshSystem(): void {
    this.system = this.rebuildSystem();
  }

  setModel(model: ResolvedModel): void {
    this.model = model;
    this.refreshSystem();
  }

  /** Run one user turn (which may span many tool-use steps). */
  async send(content: UserContent, signal?: AbortSignal, render = true): Promise<TurnResult> {
    this.messages.push({ role: "user", content });
    const res = await runTurn({
      model: this.model,
      system: this.system,
      messages: this.messages,
      tools: this.tools,
      config: this.config,
      ui: this.ui,
      render,
      signal,
    });
    this.messages.push(...res.newMessages);
    this.totalUsage.input += res.usage.input;
    this.totalUsage.output += res.usage.output;
    return res;
  }

  /** Run a self-contained sub-agent and return its final text answer. */
  private async runSubAgent(prompt: string, signal?: AbortSignal): Promise<string> {
    const ctx = {
      cwd: this.cwd,
      ui: this.ui,
      permissions: this.permissions,
      config: this.config,
      resolvedModel: this.model,
      todos: [] as TodoItem[],
    };
    const subTools = withHooks(buildTools(ctx, false), this.hookRunner, this.ui); // no nested sub-agents
    const subSystem =
      "You are a sub-agent invoked by the main coding agent to handle a focused task. " +
      "Use your tools to investigate or act, then return a single, complete answer. " +
      "Be thorough but concise; your final message is the only thing returned to the caller.";
    const res = await runTurn({
      model: this.model,
      system: subSystem,
      messages: [{ role: "user", content: prompt }],
      tools: subTools,
      config: { ...this.config, maxSteps: Math.min(this.config.maxSteps ?? 50, 20) },
      ui: this.ui,
      render: false,
      signal,
    });
    return res.text;
  }
}

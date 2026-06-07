import { spawnSync } from "node:child_process";
import type { ToolSet } from "ai";
import type { HookConfig } from "./config.js";
import { UI } from "./ui.js";

/**
 * Tool-use hooks, like Claude Code's hooks. Shell commands fire around tool
 * calls. A `preToolUse` hook receives `{event,tool,input}` as JSON on stdin; a
 * non-zero exit BLOCKS the tool call and its output becomes the reason shown to
 * the model. A `postToolUse` hook receives `{event,tool,input,output}` and is
 * observational (its exit code is ignored). Configure them in
 * ~/.omnicode/config.json under "hooks".
 */
export interface PreHookResult {
  block: boolean;
  reason?: string;
}

function matches(matcher: string | undefined, tool: string): boolean {
  if (!matcher || matcher === "*") return true;
  if (matcher.endsWith("*")) return tool.startsWith(matcher.slice(0, -1));
  return matcher === tool;
}

export class HookRunner {
  constructor(
    private hooks: HookConfig[],
    private cwd: string,
  ) {}

  get enabled(): boolean {
    return this.hooks.length > 0;
  }

  private exec(h: HookConfig, payload: unknown): { code: number; out: string } {
    const res = spawnSync(h.command, {
      shell: true,
      cwd: this.cwd,
      input: JSON.stringify(payload),
      encoding: "utf8",
      timeout: 30_000,
      env: process.env,
    });
    const out = ((res.stdout ?? "") + (res.stderr ?? "")).trim();
    return { code: res.status ?? (res.error ? 1 : 0), out };
  }

  runPre(tool: string, input: unknown): PreHookResult {
    for (const h of this.hooks) {
      if (h.event !== "preToolUse" || !matches(h.matcher, tool)) continue;
      const { code, out } = this.exec(h, { event: "preToolUse", tool, input });
      if (code !== 0) return { block: true, reason: out || `hook exited with ${code}` };
    }
    return { block: false };
  }

  runPost(tool: string, input: unknown, output: unknown): void {
    for (const h of this.hooks) {
      if (h.event !== "postToolUse" || !matches(h.matcher, tool)) continue;
      this.exec(h, { event: "postToolUse", tool, input, output });
    }
  }
}

/** Wrap each tool's execute so configured hooks fire around it. */
export function withHooks(tools: ToolSet, runner: HookRunner, ui: UI): ToolSet {
  if (!runner.enabled) return tools;
  const out: ToolSet = {};
  for (const [name, t] of Object.entries(tools)) {
    const orig = (t as any).execute;
    if (typeof orig !== "function") {
      out[name] = t;
      continue;
    }
    out[name] = {
      ...(t as any),
      execute: async (input: any, opts: any) => {
        const pre = runner.runPre(name, input);
        if (pre.block) {
          ui.toolError(`blocked by hook: ${pre.reason}`);
          return `Blocked by a preToolUse hook: ${pre.reason}`;
        }
        const result = await orig(input, opts);
        runner.runPost(name, input, result);
        return result;
      },
    } as any;
  }
  return out;
}

import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./types.js";

/**
 * Delegates a focused subtask to a sub-agent that runs its own tool loop and
 * returns only its final answer. Mirrors Claude Code's Task tool: useful for
 * broad searches or self-contained investigations so the main context stays
 * lean. The runner is injected by the agent layer.
 */
export function spawnAgentTool(ctx: ToolContext) {
  return tool({
    description:
      "Delegate a self-contained task to a sub-agent (e.g. 'find every place X is configured'). " +
      "The sub-agent has the same tools and returns a single text report. Use it for open-ended search " +
      "or multi-file investigation to avoid cluttering the main conversation. Give it a complete, standalone prompt.",
    inputSchema: z.object({
      description: z.string().describe("A 3-6 word label for the subtask."),
      prompt: z.string().describe("The full, self-contained instruction for the sub-agent."),
    }),
    execute: async ({ description, prompt }, { abortSignal }) => {
      if (!ctx.runSubAgent) return "Error: sub-agents are not available in this context.";
      ctx.ui.toolResult(`↳ sub-agent: ${description}`);
      try {
        const result = await ctx.runSubAgent(description, prompt, abortSignal ?? undefined);
        return result || "(sub-agent returned no output)";
      } catch (e: any) {
        return `Sub-agent error: ${e.message}`;
      }
    },
  });
}

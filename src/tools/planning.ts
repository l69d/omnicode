import { tool } from "ai";
import { z } from "zod";
import { pc } from "../ui.js";
import type { ToolContext } from "./types.js";

/**
 * The agent's scratchpad for multi-step work — equivalent to Claude Code's
 * TodoWrite. Keeping a visible, updated plan markedly improves multi-step
 * reliability across weaker models, which is exactly our cross-model goal.
 */
export function updateTodosTool(ctx: ToolContext) {
  return tool({
    description:
      "Create or update the task list for the current work. Call this at the start of any multi-step task and " +
      "after completing each step. Exactly one task should be 'in_progress' at a time.",
    inputSchema: z.object({
      todos: z
        .array(
          z.object({
            content: z.string().describe("Imperative description of the step."),
            status: z.enum(["pending", "in_progress", "completed"]),
          }),
        )
        .describe("The full, current task list (replaces the previous list)."),
    }),
    execute: async ({ todos }) => {
      ctx.todos.splice(0, ctx.todos.length, ...todos);
      ctx.ui.line();
      for (const t of todos) {
        const mark =
          t.status === "completed" ? pc.green("✔") : t.status === "in_progress" ? pc.yellow("▸") : pc.dim("○");
        const text = t.status === "completed" ? pc.dim(t.content) : t.content;
        ctx.ui.line(`  ${mark} ${text}`);
      }
      const done = todos.filter((t) => t.status === "completed").length;
      return `Updated task list: ${done}/${todos.length} complete.`;
    },
  });
}

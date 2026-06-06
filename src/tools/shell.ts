import { tool } from "ai";
import { z } from "zod";
import { spawn } from "node:child_process";
import type { ToolContext } from "./types.js";

const DEFAULT_TIMEOUT = 120_000;
const MAX_TIMEOUT = 600_000;
const MAX_OUTPUT = 30_000;

function firstToken(cmd: string): string {
  const m = cmd.trim().match(/^[A-Za-z0-9._\/-]+/);
  return m ? m[0] : "command";
}

export function runCommandTool(ctx: ToolContext) {
  return tool({
    description:
      "Run a shell command in the working directory and return its combined stdout/stderr and exit code. " +
      "Use for builds, tests, git, package managers, etc. Avoid interactive or long-running daemons.",
    inputSchema: z.object({
      command: z.string().describe("The shell command to run."),
      timeout_ms: z.number().int().positive().optional().describe(`Timeout in ms (default ${DEFAULT_TIMEOUT}, max ${MAX_TIMEOUT}).`),
      cwd: z.string().optional().describe("Directory to run in (relative to the working directory)."),
    }),
    execute: async ({ command, timeout_ms, cwd }, { abortSignal }) => {
      const decision = await ctx.permissions.check({
        category: "exec",
        title: "Run command",
        detail: command,
        allowKey: firstToken(command),
      });
      if (decision === "deny")
        return ctx.permissions.mode === "plan"
          ? "Blocked: plan mode does not run commands. Describe the command in your plan instead."
          : "User denied running this command.";

      const timeout = Math.min(timeout_ms ?? DEFAULT_TIMEOUT, MAX_TIMEOUT);
      const runCwd = cwd ? `${ctx.cwd}/${cwd}` : ctx.cwd;

      return await new Promise<string>((resolve) => {
        const child = spawn(command, {
          shell: true,
          cwd: runCwd,
          env: process.env,
        });
        let out = "";
        let killed = false;
        const onData = (d: Buffer) => {
          if (out.length < MAX_OUTPUT * 2) out += d.toString();
        };
        child.stdout.on("data", onData);
        child.stderr.on("data", onData);

        const timer = setTimeout(() => {
          killed = true;
          child.kill("SIGKILL");
        }, timeout);

        const onAbort = () => {
          killed = true;
          child.kill("SIGKILL");
        };
        abortSignal?.addEventListener("abort", onAbort, { once: true });

        child.on("close", (code) => {
          clearTimeout(timer);
          abortSignal?.removeEventListener("abort", onAbort);
          let body = out.trim();
          if (body.length > MAX_OUTPUT) body = body.slice(0, MAX_OUTPUT) + `\n… (truncated, ${out.length} bytes total)`;
          const status = killed ? `killed after ${timeout}ms timeout` : `exit code ${code}`;
          resolve(`[${status}]\n${body || "(no output)"}`);
        });

        child.on("error", (err) => {
          clearTimeout(timer);
          resolve(`Error launching command: ${err.message}`);
        });
      });
    },
  });
}

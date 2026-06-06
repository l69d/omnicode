import { tool } from "ai";
import { z } from "zod";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { ToolContext } from "./types.js";

const MAX_READ_BYTES = 400 * 1024;
const DEFAULT_LINE_LIMIT = 2000;

function rel(ctx: ToolContext, abs: string): string {
  const r = relative(ctx.cwd, abs);
  return r && !r.startsWith("..") ? r : abs;
}

export function readFileTool(ctx: ToolContext) {
  return tool({
    description:
      "Read a text file. Returns contents prefixed with line numbers. Use offset (1-based start line) and limit for large files.",
    inputSchema: z.object({
      path: z.string().describe("File path, absolute or relative to the working directory."),
      offset: z.number().int().positive().optional().describe("1-based line number to start at."),
      limit: z.number().int().positive().optional().describe("Maximum number of lines to read."),
    }),
    execute: async ({ path, offset, limit }) => {
      try {
        const abs = resolve(ctx.cwd, path);
        if (!existsSync(abs)) return `Error: no such file: ${path}`;
        const st = statSync(abs);
        if (st.isDirectory()) return `Error: ${path} is a directory. Use list_directory instead.`;
        if (st.size > MAX_READ_BYTES)
          return `Error: file is ${(st.size / 1024).toFixed(0)}KB, exceeds read limit. Use offset/limit or grep.`;
        const content = readFileSync(abs, "utf8");
        const lines = content.split("\n");
        const start = offset ? offset - 1 : 0;
        const end = Math.min(lines.length, start + (limit ?? DEFAULT_LINE_LIMIT));
        if (start >= lines.length) return `Error: offset ${offset} is past end of file (${lines.length} lines).`;
        const body = lines
          .slice(start, end)
          .map((l, i) => `${String(start + i + 1).padStart(6)}\t${l}`)
          .join("\n");
        const more = end < lines.length ? `\n… (${lines.length - end} more lines)` : "";
        return body.length ? body + more : "(empty file)";
      } catch (e: any) {
        return `Error reading ${path}: ${e.message}`;
      }
    },
  });
}

export function listDirectoryTool(ctx: ToolContext) {
  return tool({
    description: "List the entries of a directory (non-recursive). Directories are suffixed with '/'.",
    inputSchema: z.object({
      path: z.string().optional().describe("Directory path. Defaults to the working directory."),
    }),
    execute: async ({ path }) => {
      try {
        const abs = resolve(ctx.cwd, path ?? ".");
        if (!existsSync(abs)) return `Error: no such directory: ${path}`;
        const entries = readdirSync(abs, { withFileTypes: true })
          .filter((e) => !e.name.startsWith("."))
          .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1))
          .map((e) => (e.isDirectory() ? e.name + "/" : e.name));
        return entries.length ? entries.join("\n") : "(empty directory)";
      } catch (e: any) {
        return `Error listing ${path}: ${e.message}`;
      }
    },
  });
}

export function writeFileTool(ctx: ToolContext) {
  return tool({
    description:
      "Write a file, creating parent directories as needed. Overwrites if it exists. Prefer edit_file for small changes to existing files.",
    inputSchema: z.object({
      path: z.string().describe("File path to write."),
      content: z.string().describe("Full file contents."),
    }),
    execute: async ({ path, content }) => {
      const abs = resolve(ctx.cwd, path);
      const exists = existsSync(abs);
      const decision = await ctx.permissions.check({
        category: "write",
        title: `${exists ? "Overwrite" : "Create"} ${rel(ctx, abs)}`,
        detail: `${content.split("\n").length} lines, ${content.length} bytes`,
        allowKey: "write",
      });
      if (decision === "deny")
        return ctx.permissions.mode === "plan"
          ? "Blocked: plan mode is read-only. Present your plan instead of writing files."
          : "User denied writing this file.";
      try {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, content);
        return `Wrote ${content.length} bytes to ${rel(ctx, abs)}.`;
      } catch (e: any) {
        return `Error writing ${path}: ${e.message}`;
      }
    },
  });
}

function applyEdit(content: string, oldStr: string, newStr: string, replaceAll: boolean): { result?: string; error?: string } {
  if (oldStr === newStr) return { error: "old_string and new_string are identical." };
  const count = content.split(oldStr).length - 1;
  if (count === 0) return { error: "old_string not found in file. It must match exactly, including whitespace." };
  if (count > 1 && !replaceAll)
    return { error: `old_string matched ${count} times. Make it unique (add surrounding context) or set replace_all=true.` };
  return { result: replaceAll ? content.split(oldStr).join(newStr) : content.replace(oldStr, newStr) };
}

export function editFileTool(ctx: ToolContext) {
  return tool({
    description:
      "Replace an exact string in a file. old_string must match exactly and be unique unless replace_all is true.",
    inputSchema: z.object({
      path: z.string().describe("File to edit."),
      old_string: z.string().describe("Exact text to find (include enough context to be unique)."),
      new_string: z.string().describe("Replacement text."),
      replace_all: z.boolean().optional().describe("Replace every occurrence (default false)."),
    }),
    execute: async ({ path, old_string, new_string, replace_all }) => {
      const abs = resolve(ctx.cwd, path);
      if (!existsSync(abs)) return `Error: no such file: ${path}`;
      let content: string;
      try {
        content = readFileSync(abs, "utf8");
      } catch (e: any) {
        return `Error reading ${path}: ${e.message}`;
      }
      const { result, error } = applyEdit(content, old_string, new_string, !!replace_all);
      if (error) return `Error: ${error}`;
      const decision = await ctx.permissions.check({
        category: "write",
        title: `Edit ${rel(ctx, abs)}`,
        detail: `- ${old_string.split("\n")[0].slice(0, 70)}\n+ ${new_string.split("\n")[0].slice(0, 70)}`,
        allowKey: "write",
      });
      if (decision === "deny")
        return ctx.permissions.mode === "plan"
          ? "Blocked: plan mode is read-only. Present your plan instead of editing files."
          : "User denied this edit.";
      try {
        writeFileSync(abs, result!);
        return `Edited ${rel(ctx, abs)}.`;
      } catch (e: any) {
        return `Error writing ${path}: ${e.message}`;
      }
    },
  });
}

export function multiEditTool(ctx: ToolContext) {
  return tool({
    description: "Apply multiple edits to a single file, in order. All must succeed or none are applied.",
    inputSchema: z.object({
      path: z.string().describe("File to edit."),
      edits: z
        .array(
          z.object({
            old_string: z.string(),
            new_string: z.string(),
            replace_all: z.boolean().optional(),
          }),
        )
        .min(1)
        .describe("Edits applied sequentially to the file's text."),
    }),
    execute: async ({ path, edits }) => {
      const abs = resolve(ctx.cwd, path);
      if (!existsSync(abs)) return `Error: no such file: ${path}`;
      let content: string;
      try {
        content = readFileSync(abs, "utf8");
      } catch (e: any) {
        return `Error reading ${path}: ${e.message}`;
      }
      let working = content;
      for (let i = 0; i < edits.length; i++) {
        const { old_string, new_string, replace_all } = edits[i];
        const { result, error } = applyEdit(working, old_string, new_string, !!replace_all);
        if (error) return `Error on edit #${i + 1}: ${error}`;
        working = result!;
      }
      const decision = await ctx.permissions.check({
        category: "write",
        title: `Apply ${edits.length} edits to ${rel(ctx, abs)}`,
        allowKey: "write",
      });
      if (decision === "deny")
        return ctx.permissions.mode === "plan"
          ? "Blocked: plan mode is read-only."
          : "User denied these edits.";
      try {
        writeFileSync(abs, working);
        return `Applied ${edits.length} edits to ${rel(ctx, abs)}.`;
      } catch (e: any) {
        return `Error writing ${path}: ${e.message}`;
      }
    },
  });
}

import { tool } from "ai";
import { z } from "zod";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { ToolContext } from "./types.js";

const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "__pycache__", ".venv", "venv"]);
const MAX_RESULTS = 200;

function hasRipgrep(): boolean {
  try {
    execFileSync("rg", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const RG = hasRipgrep();

function walk(dir: string, onFile: (p: string) => void, depth = 0): void {
  if (depth > 25) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") && e.name !== ".") continue;
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue;
      walk(join(dir, e.name), onFile, depth + 1);
    } else if (e.isFile()) {
      onFile(join(dir, e.name));
    }
  }
}

/** Translate a simple glob (*, **, ?) into a RegExp anchored to the full path. */
function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (".+^${}()|[]\\".includes(c)) re += "\\" + c;
    else re += c;
  }
  return new RegExp(re + "$");
}

export function globTool(ctx: ToolContext) {
  return tool({
    description:
      "Find files by glob pattern (e.g. 'src/**/*.ts', '**/*.json'). Returns matching paths. Honors common ignore dirs.",
    inputSchema: z.object({
      pattern: z.string().describe("Glob pattern relative to the search path."),
      path: z.string().optional().describe("Directory to search in. Defaults to the working directory."),
    }),
    execute: async ({ pattern, path }) => {
      const root = resolve(ctx.cwd, path ?? ".");
      try {
        if (RG) {
          const out = execFileSync("rg", ["--files", "--glob", pattern], {
            cwd: root,
            encoding: "utf8",
            maxBuffer: 8 * 1024 * 1024,
          });
          const files = out.split("\n").filter(Boolean).slice(0, MAX_RESULTS);
          return files.length ? files.join("\n") : "No files matched.";
        }
        const re = globToRegExp(pattern);
        const matches: string[] = [];
        walk(root, (p) => {
          const r = relative(root, p);
          if (re.test(r) || re.test(p)) matches.push(r);
        });
        return matches.length ? matches.slice(0, MAX_RESULTS).join("\n") : "No files matched.";
      } catch (e: any) {
        return `Error: ${e.message}`;
      }
    },
  });
}

export function grepTool(ctx: ToolContext) {
  return tool({
    description:
      "Search file contents for a regular expression. Returns matching lines as path:line:text. Uses ripgrep when available.",
    inputSchema: z.object({
      pattern: z.string().describe("Regular expression to search for."),
      path: z.string().optional().describe("File or directory to search. Defaults to the working directory."),
      glob: z.string().optional().describe("Only search files matching this glob (e.g. '*.ts')."),
      ignore_case: z.boolean().optional().describe("Case-insensitive search."),
    }),
    execute: async ({ pattern, path, glob, ignore_case }) => {
      const target = resolve(ctx.cwd, path ?? ".");
      try {
        if (RG) {
          const args = ["--line-number", "--no-heading", "--color", "never", "--max-count", "50"];
          if (ignore_case) args.push("-i");
          if (glob) args.push("--glob", glob);
          args.push("-e", pattern, ".");
          let out = "";
          try {
            out = execFileSync("rg", args, {
              cwd: target,
              encoding: "utf8",
              maxBuffer: 8 * 1024 * 1024,
            });
          } catch (err: any) {
            // rg exits 1 when there are no matches.
            if (err.status === 1) return "No matches.";
            throw err;
          }
          const lines = out.split("\n").filter(Boolean).slice(0, MAX_RESULTS);
          return lines.length ? lines.join("\n") : "No matches.";
        }
        // JS fallback.
        const re = new RegExp(pattern, ignore_case ? "i" : undefined);
        const globRe = glob ? globToRegExp(glob) : null;
        const results: string[] = [];
        const searchFile = (p: string) => {
          if (results.length >= MAX_RESULTS) return;
          if (globRe && !globRe.test(p)) return;
          let txt: string;
          try {
            if (statSync(p).size > 2 * 1024 * 1024) return;
            txt = readFileSync(p, "utf8");
          } catch {
            return;
          }
          txt.split("\n").forEach((line, i) => {
            if (results.length < MAX_RESULTS && re.test(line))
              results.push(`${relative(ctx.cwd, p)}:${i + 1}:${line.slice(0, 300)}`);
          });
        };
        if (statSync(target).isFile()) searchFile(target);
        else walk(target, searchFile);
        return results.length ? results.join("\n") : "No matches.";
      } catch (e: any) {
        return `Error: ${e.message}`;
      }
    },
  });
}

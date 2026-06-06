import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { OMNI_HOME } from "./config.js";

/**
 * Loads project/user "memory" files, like Claude Code's CLAUDE.md.
 *
 * We honor both OMNI.md (ours) and CLAUDE.md (drop-in compatibility) so an
 * existing Claude Code repo works unchanged. Resolution order (later = higher
 * priority, appended last):
 *   1. ~/.omnicode/OMNI.md and ~/.claude/CLAUDE.md   (user global)
 *   2. every OMNI.md / CLAUDE.md from filesystem root down to cwd  (project)
 */

const FILE_NAMES = ["OMNI.md", "CLAUDE.md"];

interface MemoryFile {
  path: string;
  content: string;
}

function readIfExists(path: string): MemoryFile | null {
  try {
    if (existsSync(path)) {
      const content = readFileSync(path, "utf8").trim();
      if (content) return { path, content };
    }
  } catch {
    /* ignore unreadable */
  }
  return null;
}

function ancestorDirs(start: string): string[] {
  const dirs: string[] = [];
  let cur = start;
  while (true) {
    dirs.push(cur);
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return dirs.reverse(); // root → cwd
}

export function loadMemory(cwd: string): string {
  const files: MemoryFile[] = [];

  // User-global memory.
  for (const p of [join(OMNI_HOME, "OMNI.md"), join(homedir(), ".claude", "CLAUDE.md")]) {
    const f = readIfExists(p);
    if (f) files.push(f);
  }

  // Project memory, root → cwd so the closest file wins (appended last).
  for (const dir of ancestorDirs(cwd)) {
    for (const name of FILE_NAMES) {
      const f = readIfExists(join(dir, name));
      if (f) files.push(f);
    }
  }

  if (files.length === 0) return "";

  return files
    .map((f) => `<memory source="${f.path}">\n${f.content}\n</memory>`)
    .join("\n\n");
}

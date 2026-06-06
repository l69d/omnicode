import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Expands `@path` mentions in a user message: if the referenced file exists, its
 * contents are appended as context, like Claude Code's @file mentions. Keeps the
 * original text intact and appends one <file> block per resolved mention.
 */
const MENTION_RE = /(?:^|\s)@([^\s]+)/g;
const MAX_FILE_BYTES = 100 * 1024;

export function expandMentions(input: string, cwd: string): string {
  const seen = new Set<string>();
  const blocks: string[] = [];

  for (const match of input.matchAll(MENTION_RE)) {
    const ref = match[1].replace(/[.,;:]$/, "");
    if (seen.has(ref)) continue;
    const abs = resolve(cwd, ref);
    try {
      if (!existsSync(abs)) continue;
      const st = statSync(abs);
      if (!st.isFile() || st.size > MAX_FILE_BYTES) continue;
      seen.add(ref);
      blocks.push(`<file path="${ref}">\n${readFileSync(abs, "utf8")}\n</file>`);
    } catch {
      /* ignore unreadable mentions */
    }
  }

  if (blocks.length === 0) return input;
  return `${input}\n\n${blocks.join("\n\n")}`;
}

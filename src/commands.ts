import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Custom slash commands, like Claude Code's. A markdown file `foo.md` in
 * ~/.omnicode/commands/ (user) or <cwd>/.omnicode/commands/ (project) becomes the
 * command `/foo`. Its body is a prompt template; `$ARGUMENTS` is replaced with
 * everything after the command name, and `$1`, `$2`, ... with individual words.
 * An optional frontmatter `description:` is shown in `/commands`.
 */
export interface CustomCommand {
  name: string;
  description: string;
  template: string;
  source: string;
}

function parseFrontmatter(content: string): { description?: string; body: string } {
  const m = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { body: content.trim() };
  const dm = m[1].match(/description:\s*(.+)/);
  return { description: dm?.[1]?.trim().replace(/^["']|["']$/g, ""), body: m[2].trim() };
}

export function loadCustomCommands(cwd: string): Map<string, CustomCommand> {
  const map = new Map<string, CustomCommand>();
  // User dir first, then project dir so project commands override user ones.
  const dirs = [join(homedir(), ".omnicode", "commands"), join(cwd, ".omnicode", "commands")];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    let files: string[];
    try {
      files = readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".md")) continue;
      const name = f.slice(0, -3);
      try {
        const { description, body } = parseFrontmatter(readFileSync(join(dir, f), "utf8"));
        map.set(name, { name, description: description ?? `Custom command /${name}`, template: body, source: dir });
      } catch {
        /* skip unreadable command files */
      }
    }
  }
  return map;
}

export function expandCommand(template: string, args: string): string {
  const parts = args.length ? args.split(/\s+/) : [];
  let out = template.replace(/\$ARGUMENTS\b/g, args);
  out = out.replace(/\$(\d+)/g, (_, n) => parts[Number(n) - 1] ?? "");
  return out;
}

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelMessage } from "ai";
import { SESSIONS_DIR, ensureHome } from "./config.js";
import type { Usage } from "./agent.js";

export interface SessionData {
  id: string;
  createdAt: number;
  updatedAt: number;
  cwd: string;
  model: string;
  usage: Usage;
  messages: ModelMessage[];
}

export function newSessionId(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function pathFor(id: string): string {
  return join(SESSIONS_DIR, `${id}.json`);
}

export function saveSession(data: SessionData): void {
  ensureHome();
  data.updatedAt = Date.now();
  writeFileSync(pathFor(data.id), JSON.stringify(data, null, 2));
}

export function loadSession(id: string): SessionData | null {
  const p = pathFor(id);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

export function listSessions(): SessionData[] {
  ensureHome();
  return readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(SESSIONS_DIR, f), "utf8")) as SessionData;
      } catch {
        return null;
      }
    })
    .filter((s): s is SessionData => s !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Most recent session, optionally scoped to a working directory. */
export function latestSession(cwd?: string): SessionData | null {
  const all = listSessions();
  const scoped = cwd ? all.filter((s) => s.cwd === cwd) : all;
  return scoped[0] ?? null;
}

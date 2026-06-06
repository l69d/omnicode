import type { PermissionMode } from "./config.js";
import { UI, pc } from "./ui.js";

/**
 * Permission gate. Mirrors Claude Code's permission modes:
 *   default      — auto-allow read-only tools; prompt for writes/exec/network
 *   acceptEdits  — auto-allow file writes too; still prompt for exec/network
 *   plan         — read-only; block all mutating tools (model must present a plan)
 *   bypass       — allow everything, never prompt ("yolo")
 */

export type PermCategory = "read" | "write" | "exec" | "network";

export interface PermissionRequest {
  category: PermCategory;
  /** Short title, e.g. "Edit src/app.ts" or "Run command". */
  title: string;
  /** Optional detail shown to the user, e.g. the command or diff. */
  detail?: string;
  /**
   * A stable key for "always allow" memory within this session — e.g. the bash
   * command's first token, or "write". If omitted, only one-time allow applies.
   */
  allowKey?: string;
}

export type Decision = "allow" | "deny";

export class PermissionManager {
  private alwaysAllow = new Set<string>();
  /** When true (e.g. -p mode), never prompt — deny anything not auto-allowed. */
  nonInteractive = false;

  constructor(
    public mode: PermissionMode,
    private ui: UI,
  ) {}

  setMode(mode: PermissionMode): void {
    this.mode = mode;
  }

  private autoAllowed(category: PermCategory): boolean {
    if (this.mode === "bypass") return true;
    if (category === "read") return true;
    if (this.mode === "acceptEdits" && category === "write") return true;
    return false;
  }

  private blockedByPlan(category: PermCategory): boolean {
    return this.mode === "plan" && category !== "read";
  }

  /**
   * Returns "allow" or "deny". May prompt the user. In plan mode, mutating
   * categories are always denied with a message the model can act on.
   */
  async check(req: PermissionRequest): Promise<Decision> {
    if (this.blockedByPlan(req.category)) return "deny";
    if (this.autoAllowed(req.category)) return "allow";

    const key = req.allowKey ? `${req.category}:${req.allowKey}` : null;
    if (key && this.alwaysAllow.has(key)) return "allow";

    // No human to ask (e.g. -p mode): deny rather than hang.
    if (this.nonInteractive) return "deny";

    // Prompt.
    this.ui.line();
    this.ui.line(pc.yellow("  ⚠ permission needed: ") + pc.bold(req.title));
    if (req.detail) {
      for (const l of req.detail.split("\n").slice(0, 12)) this.ui.line(pc.dim("    " + l));
    }
    const optionsLine = key
      ? "    [y] allow once  [a] allow always (session)  [n] deny: "
      : "    [y] allow once  [n] deny: ";
    const ans = (await this.ui.ask(pc.cyan(optionsLine))).trim().toLowerCase();

    if (ans === "a" && key) {
      this.alwaysAllow.add(key);
      return "allow";
    }
    if (ans === "y" || ans === "yes") return "allow";
    return "deny";
  }
}

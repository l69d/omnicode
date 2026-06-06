import * as readline from "node:readline";
import pc from "picocolors";

/**
 * Terminal UI: owns stdin/stdout, renders the agent's activity, and prompts
 * the user (for chat input and permission decisions). One readline interface
 * is shared across the session so history/editing work.
 */
export class UI {
  private rl: readline.Interface;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      historySize: 1000,
      prompt: pc.cyan("› "),
    });
  }

  close(): void {
    this.rl.close();
  }

  /** Ask a free-text question and resolve with the trimmed answer. */
  ask(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(question, (answer) => resolve(answer));
    });
  }

  /** Read the next chat prompt from the user. */
  async readPrompt(): Promise<string> {
    const ans = await this.ask(pc.cyan("\n› "));
    return ans.trim();
  }

  // --- rendering helpers -------------------------------------------------

  write(s: string): void {
    process.stdout.write(s);
  }

  line(s = ""): void {
    process.stdout.write(s + "\n");
  }

  banner(model: string, mode: string, cwd: string): void {
    this.line();
    this.line(pc.bold(pc.magenta("  ▟▙ omnicode")) + pc.dim("  — one coding agent, any model"));
    this.line(pc.dim(`  model: ${pc.reset(pc.cyan(model))}${pc.dim(`   mode: ${mode}   cwd: ${cwd}`)}`));
    this.line(pc.dim("  /help for commands · /model to switch · Ctrl-C to cancel · /exit to quit"));
    this.line();
  }

  assistantStart(): void {
    process.stdout.write(pc.green("● "));
  }

  reasoning(delta: string): void {
    process.stdout.write(pc.dim(delta));
  }

  toolCall(name: string, summary: string): void {
    this.line(pc.yellow("  ⚙ ") + pc.bold(name) + pc.dim(summary ? `  ${summary}` : ""));
  }

  toolResult(preview: string): void {
    const lines = preview.split("\n").slice(0, 6);
    for (const l of lines) this.line(pc.dim("    " + l));
    const total = preview.split("\n").length;
    if (total > 6) this.line(pc.dim(`    … (+${total - 6} more lines)`));
  }

  toolError(msg: string): void {
    this.line(pc.red("    ✗ " + msg));
  }

  info(msg: string): void {
    this.line(pc.dim(msg));
  }

  success(msg: string): void {
    this.line(pc.green(msg));
  }

  warn(msg: string): void {
    this.line(pc.yellow(msg));
  }

  error(msg: string): void {
    this.line(pc.red(msg));
  }

  usage(promptTokens: number, completionTokens: number, steps: number): void {
    this.line(
      pc.dim(
        `  ↳ ${steps} step${steps === 1 ? "" : "s"} · ${promptTokens} in / ${completionTokens} out tokens`,
      ),
    );
  }
}

export { pc };

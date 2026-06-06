import type { ToolSet } from "ai";
import type { ToolContext } from "./types.js";
import { editFileTool, listDirectoryTool, multiEditTool, readFileTool, writeFileTool } from "./files.js";
import { globTool, grepTool } from "./search.js";
import { runCommandTool } from "./shell.js";
import { webFetchTool } from "./web.js";
import { updateTodosTool } from "./planning.js";
import { spawnAgentTool } from "./subagent.js";

export type { ToolContext, TodoItem } from "./types.js";

/** Build the core tool set. `includeSubagent` is false inside a sub-agent (no recursion). */
export function buildTools(ctx: ToolContext, includeSubagent = true): ToolSet {
  const tools: ToolSet = {
    read_file: readFileTool(ctx),
    list_directory: listDirectoryTool(ctx),
    glob: globTool(ctx),
    grep: grepTool(ctx),
    write_file: writeFileTool(ctx),
    edit_file: editFileTool(ctx),
    multi_edit: multiEditTool(ctx),
    run_command: runCommandTool(ctx),
    web_fetch: webFetchTool(ctx),
    update_todos: updateTodosTool(ctx),
  };
  if (includeSubagent) tools.spawn_agent = spawnAgentTool(ctx);
  return tools;
}

import { tool, jsonSchema, type ToolSet } from "ai";
import type { OmniConfig } from "./config.js";
import { UI } from "./ui.js";

/**
 * Loads tools from configured MCP (Model Context Protocol) servers, so omnicode
 * can use the same ecosystem of MCP servers as Claude Code. Servers are declared
 * in ~/.omnicode/config.json under "mcpServers". The MCP SDK is imported lazily
 * so the core CLI runs even if it isn't installed.
 */
export interface McpHandle {
  tools: ToolSet;
  close: () => Promise<void>;
}

export async function loadMcpTools(config: OmniConfig, ui: UI): Promise<McpHandle> {
  const servers = config.mcpServers ?? {};
  const names = Object.keys(servers);
  if (names.length === 0) return { tools: {}, close: async () => {} };

  let Client: any, StdioClientTransport: any;
  try {
    ({ Client } = await import("@modelcontextprotocol/sdk/client/index.js"));
    ({ StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js"));
  } catch {
    ui.warn("  MCP servers configured but @modelcontextprotocol/sdk is not installed — skipping.");
    return { tools: {}, close: async () => {} };
  }

  const tools: ToolSet = {};
  const clients: any[] = [];

  for (const name of names) {
    const cfg = servers[name];
    try {
      const transport = new StdioClientTransport({
        command: cfg.command,
        args: cfg.args ?? [],
        env: { ...process.env, ...(cfg.env ?? {}) },
      });
      const client = new Client({ name: "omnicode", version: "0.1.0" }, { capabilities: {} });
      await client.connect(transport);
      clients.push(client);

      const { tools: mcpTools } = await client.listTools();
      for (const t of mcpTools) {
        const toolName = `${name}__${t.name}`;
        tools[toolName] = tool({
          description: t.description ?? `MCP tool ${t.name} from ${name}`,
          inputSchema: jsonSchema(t.inputSchema ?? { type: "object", properties: {} }),
          execute: async (args: any) => {
            const res = await client.callTool({ name: t.name, arguments: args });
            const content = Array.isArray(res.content) ? res.content : [];
            const text = content
              .map((c: any) => (c.type === "text" ? c.text : JSON.stringify(c)))
              .join("\n");
            return text || "(no content)";
          },
        });
      }
      ui.info(`  ✓ MCP: ${name} (${mcpTools.length} tools)`);
    } catch (e: any) {
      ui.warn(`  ✗ MCP: failed to connect "${name}": ${e.message}`);
    }
  }

  return {
    tools,
    close: async () => {
      await Promise.allSettled(clients.map((c) => c.close()));
    },
  };
}

import { tool } from "ai";
import { z } from "zod";
import type { ToolContext } from "./types.js";

const MAX_CHARS = 30_000;

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function webFetchTool(ctx: ToolContext) {
  return tool({
    description:
      "Fetch a URL over HTTP(S) and return its text content (HTML is stripped to readable text). Use for docs, references, and up-to-date info.",
    inputSchema: z.object({
      url: z.string().url().describe("The absolute http(s) URL to fetch."),
    }),
    execute: async ({ url }, { abortSignal }) => {
      let host = url;
      try {
        host = new URL(url).host;
      } catch {
        return "Error: invalid URL.";
      }
      const decision = await ctx.permissions.check({
        category: "network",
        title: `Fetch ${host}`,
        detail: url,
        allowKey: host,
      });
      if (decision === "deny")
        return ctx.permissions.mode === "plan"
          ? "Blocked: plan mode does not access the network."
          : "User denied this network request.";
      try {
        const res = await fetch(url, {
          signal: abortSignal,
          headers: { "User-Agent": "omnicode/0.1 (+https://github.com/l69d/omnicode)" },
          redirect: "follow",
        });
        const type = res.headers.get("content-type") ?? "";
        const raw = await res.text();
        const text = /html/i.test(type) ? htmlToText(raw) : raw;
        const body = text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + "\n… (truncated)" : text;
        return `HTTP ${res.status} ${res.statusText} · ${type}\n\n${body}`;
      } catch (e: any) {
        return `Error fetching ${url}: ${e.message}`;
      }
    },
  });
}

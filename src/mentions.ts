import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import type { UserContent } from "ai";

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

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
};
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;

type MediaPart =
  | { type: "image"; image: string; mediaType: string }
  | { type: "file"; data: string; mediaType: string; filename: string };

/**
 * Builds a user message from text plus @path mentions and explicit attachments.
 * Text files are inlined as <file> blocks; images and PDFs become multimodal
 * content parts (base64) so vision-capable models can see them. Returns a plain
 * string when there is no media, keeping simple turns simple.
 */
export function buildUserContent(text: string, cwd: string, attachments: string[] = []): UserContent {
  const mentioned = [...text.matchAll(MENTION_RE)].map((m) => m[1].replace(/[.,;:]$/, ""));
  const paths = [...mentioned, ...attachments];
  const seen = new Set<string>();
  const textBlocks: string[] = [];
  const media: MediaPart[] = [];

  for (const ref of paths) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    const abs = resolve(cwd, ref);
    try {
      if (!existsSync(abs) || !statSync(abs).isFile()) continue;
      const size = statSync(abs).size;
      const ext = extname(ref).toLowerCase();
      if (IMAGE_MIME[ext]) {
        if (size > MAX_MEDIA_BYTES) continue;
        media.push({ type: "image", image: readFileSync(abs).toString("base64"), mediaType: IMAGE_MIME[ext] });
      } else if (ext === ".pdf") {
        if (size > MAX_MEDIA_BYTES) continue;
        media.push({
          type: "file",
          data: readFileSync(abs).toString("base64"),
          mediaType: "application/pdf",
          filename: ref.split("/").pop() || ref,
        });
      } else if (size <= MAX_FILE_BYTES) {
        textBlocks.push(`<file path="${ref}">\n${readFileSync(abs, "utf8")}\n</file>`);
      }
    } catch {
      /* ignore unreadable */
    }
  }

  const fullText = textBlocks.length ? `${text}\n\n${textBlocks.join("\n\n")}` : text;
  if (media.length === 0) return fullText;
  return [{ type: "text", text: fullText }, ...media];
}

import type { LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createOllama } from "ollama-ai-provider-v2";
import type { OmniConfig } from "./config.js";

/**
 * The pluggable model layer — the whole point of omnicode.
 *
 * A model is addressed as "provider:model-id", e.g.:
 *   anthropic:claude-opus-4-8
 *   openai:gpt-4o
 *   google:gemini-2.0-flash
 *   deepseek:deepseek-chat
 *   groq:llama-3.3-70b-versatile
 *   openrouter:meta-llama/llama-3.3-70b-instruct
 *   xai:grok-2-latest
 *   ollama:qwen2.5-coder       (local, no key)
 *   <custom>:<model>           (registered in config.providers)
 *
 * Native SDKs are used for Anthropic / OpenAI / Google so provider-specific
 * features (extended thinking, prompt caching, 1M context, reasoning) light up.
 * Everything else routes through the OpenAI-compatible adapter, so literally
 * any OpenAI-shaped endpoint plugs in with just a base URL + key.
 */

interface BuiltinProvider {
  /** OpenAI-compatible base URL (for the generic adapter). */
  baseURL?: string;
  /** Env var name holding the API key. */
  apiKeyEnv?: string;
  /** Whether a key is required (false for local servers like Ollama). */
  keyOptional?: boolean;
  /** "native" providers use a dedicated SDK rather than the openai-compatible one. */
  kind: "anthropic" | "openai" | "google" | "ollama" | "openai-compatible";
  /** Human label for errors/help. */
  label: string;
}

export const BUILTIN_PROVIDERS: Record<string, BuiltinProvider> = {
  anthropic: { kind: "anthropic", apiKeyEnv: "ANTHROPIC_API_KEY", label: "Anthropic (Claude)" },
  openai: { kind: "openai", apiKeyEnv: "OPENAI_API_KEY", label: "OpenAI" },
  google: { kind: "google", apiKeyEnv: "GOOGLE_GENERATIVE_AI_API_KEY", label: "Google Gemini" },
  gemini: { kind: "google", apiKeyEnv: "GOOGLE_GENERATIVE_AI_API_KEY", label: "Google Gemini" },
  deepseek: {
    kind: "openai-compatible",
    baseURL: "https://api.deepseek.com/v1",
    apiKeyEnv: "DEEPSEEK_API_KEY",
    label: "DeepSeek",
  },
  groq: {
    kind: "openai-compatible",
    baseURL: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY",
    label: "Groq",
  },
  openrouter: {
    kind: "openai-compatible",
    baseURL: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
    label: "OpenRouter",
  },
  together: {
    kind: "openai-compatible",
    baseURL: "https://api.together.xyz/v1",
    apiKeyEnv: "TOGETHER_API_KEY",
    label: "Together AI",
  },
  xai: {
    kind: "openai-compatible",
    baseURL: "https://api.x.ai/v1",
    apiKeyEnv: "XAI_API_KEY",
    label: "xAI (Grok)",
  },
  grok: {
    kind: "openai-compatible",
    baseURL: "https://api.x.ai/v1",
    apiKeyEnv: "XAI_API_KEY",
    label: "xAI (Grok)",
  },
  mistral: {
    kind: "openai-compatible",
    baseURL: "https://api.mistral.ai/v1",
    apiKeyEnv: "MISTRAL_API_KEY",
    label: "Mistral",
  },
  cerebras: {
    kind: "openai-compatible",
    baseURL: "https://api.cerebras.ai/v1",
    apiKeyEnv: "CEREBRAS_API_KEY",
    label: "Cerebras",
  },
  fireworks: {
    kind: "openai-compatible",
    baseURL: "https://api.fireworks.ai/inference/v1",
    apiKeyEnv: "FIREWORKS_API_KEY",
    label: "Fireworks",
  },
  ollama: { kind: "ollama", keyOptional: true, label: "Ollama (local)" },
  lmstudio: {
    kind: "openai-compatible",
    baseURL: "http://localhost:1234/v1",
    keyOptional: true,
    label: "LM Studio (local)",
  },
};

export interface ResolvedModel {
  provider: string;
  modelId: string;
  model: LanguageModel;
  label: string;
}

export class ProviderError extends Error {}

/** Split "provider:model" — model id may itself contain colons/slashes. */
export function parseModelSpec(spec: string): { provider: string; modelId: string } {
  const idx = spec.indexOf(":");
  if (idx === -1) {
    // Bare model id — infer provider from common prefixes.
    if (spec.startsWith("claude")) return { provider: "anthropic", modelId: spec };
    if (spec.startsWith("gpt") || spec.startsWith("o1") || spec.startsWith("o3"))
      return { provider: "openai", modelId: spec };
    if (spec.startsWith("gemini")) return { provider: "google", modelId: spec };
    throw new ProviderError(
      `Model "${spec}" has no provider. Use "provider:model", e.g. "anthropic:${spec}".`,
    );
  }
  return { provider: spec.slice(0, idx), modelId: spec.slice(idx + 1) };
}

function requireKey(envName: string | undefined, provider: string, optional?: boolean): string | undefined {
  if (!envName) return undefined;
  const key = process.env[envName];
  if (!key && !optional) {
    throw new ProviderError(
      `Missing API key for "${provider}". Set ${envName} in your environment.`,
    );
  }
  return key;
}

export function resolveModel(spec: string, config: OmniConfig): ResolvedModel {
  const { provider, modelId } = parseModelSpec(spec);
  const custom = config.providers?.[provider];
  const builtin = BUILTIN_PROVIDERS[provider];

  // 1) User-registered custom OpenAI-compatible provider takes precedence.
  if (custom) {
    const apiKey = custom.apiKeyEnv ? process.env[custom.apiKeyEnv] : undefined;
    const factory = createOpenAICompatible({
      name: provider,
      baseURL: custom.baseURL,
      apiKey: apiKey ?? "not-needed",
    });
    return { provider, modelId, model: factory(modelId), label: provider };
  }

  if (!builtin) {
    throw new ProviderError(
      `Unknown provider "${provider}". Built-ins: ${Object.keys(BUILTIN_PROVIDERS).join(", ")}.\n` +
        `Register a custom one with: omnicode provider add ${provider} --base-url <url> [--key-env <ENV>]`,
    );
  }

  switch (builtin.kind) {
    case "anthropic": {
      const apiKey = requireKey(builtin.apiKeyEnv, provider);
      return {
        provider,
        modelId,
        model: createAnthropic({ apiKey })(modelId),
        label: builtin.label,
      };
    }
    case "openai": {
      const apiKey = requireKey(builtin.apiKeyEnv, provider);
      return {
        provider,
        modelId,
        model: createOpenAI({ apiKey })(modelId),
        label: builtin.label,
      };
    }
    case "google": {
      const apiKey = requireKey(builtin.apiKeyEnv, provider);
      return {
        provider,
        modelId,
        model: createGoogleGenerativeAI({ apiKey })(modelId),
        label: builtin.label,
      };
    }
    case "ollama": {
      const baseURL = process.env.OLLAMA_HOST
        ? `${process.env.OLLAMA_HOST.replace(/\/$/, "")}/api`
        : undefined;
      const factory = createOllama(baseURL ? { baseURL } : {});
      return { provider, modelId, model: factory(modelId), label: builtin.label };
    }
    case "openai-compatible": {
      const apiKey = requireKey(builtin.apiKeyEnv, provider, builtin.keyOptional);
      const factory = createOpenAICompatible({
        name: provider,
        baseURL: builtin.baseURL!,
        apiKey: apiKey ?? "not-needed",
      });
      return { provider, modelId, model: factory(modelId), label: builtin.label };
    }
  }
}

/** Pick a sensible default model from whatever keys are present in the env. */
export function autoDetectModel(): string | undefined {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic:claude-sonnet-4-6";
  if (process.env.OPENAI_API_KEY) return "openai:gpt-4o";
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) return "google:gemini-2.0-flash";
  if (process.env.DEEPSEEK_API_KEY) return "deepseek:deepseek-chat";
  if (process.env.GROQ_API_KEY) return "groq:llama-3.3-70b-versatile";
  if (process.env.OPENROUTER_API_KEY) return "openrouter:anthropic/claude-3.5-sonnet";
  if (process.env.XAI_API_KEY) return "xai:grok-2-latest";
  // No cloud key? Assume a local Ollama coder model is available.
  return "ollama:qwen2.5-coder";
}

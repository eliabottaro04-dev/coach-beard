// FASE 5 — Configurazione dell'agente AI
//
// La API key NON è committata. Viene letta da variabile d'ambiente.
// In locale: scrivi .env.local con ANTHROPIC_API_KEY=... oppure
// OPENAI_API_KEY=... oppure DEEPSEEK_API_KEY=...
//
// Provider supportati:
//  - Anthropic (Claude) — se ANTHROPIC_API_KEY è presente
//  - OpenAI-compatibile (DeepSeek, Groq, OpenAI, Ollama, ecc.) — se
//    OPENAI_API_KEY + OPENAI_BASE_URL (opzionale) sono presenti

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

export type AgentConfig = {
  provider: 'anthropic' | 'openai-compat' | 'none';
  apiKey: string | null;
  baseUrl?: string;
  model: string;
  hasApiKey: boolean;
  datasetVersion: string;
};

let _env: Record<string, string> = {};

function loadEnv() {
  if (_env && Object.keys(_env).length > 0) return _env;
  // Carica .env.local e .env (formato KEY=VALUE una per riga)
  for (const filename of ['.env.local', '.env']) {
    const path = join(process.cwd(), filename);
    if (!existsSync(path)) continue;
    const lines = readFileSync(path, 'utf-8').split('\n');
    for (const line of lines) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
      if (!m) continue;
      const key = m[1];
      let value = m[2] ?? '';
      // Strip quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      _env[key] = value;
    }
  }
  return _env;
}

export function getAgentConfig(): AgentConfig {
  const env = loadEnv();

  // Supporta multipli provider: ANTHROPIC, DEEPSEEK, GROQ, OPENROUTER, GEMINI, OPENAI
  const anthropicKey = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  const deepseekKey = env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY;
  const groqKey = env.GROQ_API_KEY || process.env.GROQ_API_KEY;
  const openrouterKey = env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY;
  const geminiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY || env.GOOGLE_API_KEY || process.env.GOOGLE_API_KEY;
  const openaiKey = env.OPENAI_API_KEY || process.env.OPENAI_API_KEY;
  const openaiBase = env.OPENAI_BASE_URL || process.env.OPENAI_BASE_URL;
  const modelOverride = env.COACH_BEARD_MODEL || process.env.COACH_BEARD_MODEL;

  let provider: AgentConfig['provider'] = 'none';
  let apiKey: string | null = null;
  let baseUrl: string | undefined;
  let model = 'deterministico';

  if (anthropicKey) {
    provider = 'anthropic';
    apiKey = anthropicKey;
    model = modelOverride ?? 'claude-3-5-sonnet-20241022';
  } else if (deepseekKey) {
    provider = 'openai-compat';
    apiKey = deepseekKey;
    baseUrl = openaiBase ?? 'https://api.deepseek.com/v1';
    model = modelOverride ?? 'deepseek-chat';
  } else if (groqKey) {
    provider = 'openai-compat';
    apiKey = groqKey;
    baseUrl = openaiBase ?? 'https://api.groq.com/openai/v1';
    model = modelOverride ?? 'llama-3.3-70b-versatile';
  } else if (openrouterKey) {
    provider = 'openai-compat';
    apiKey = openrouterKey;
    baseUrl = openaiBase ?? 'https://openrouter.ai/api/v1';
    model = modelOverride ?? 'deepseek/deepseek-chat';
  } else if (geminiKey) {
    provider = 'openai-compat';
    apiKey = geminiKey;
    baseUrl = openaiBase ?? 'https://generativelanguage.googleapis.com/v1beta/openai/';
    model = modelOverride ?? 'gemini-2.0-flash';
  } else if (openaiKey) {
    provider = 'openai-compat';
    apiKey = openaiKey;
    baseUrl = openaiBase ?? 'https://api.openai.com/v1';
    model = modelOverride ?? 'gpt-4o-mini';
  }

  // Versione dataset (da package.json o da un campo statico)
  let datasetVersion = 'unknown';
  try {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'));
    datasetVersion = `v${pkg.version ?? '0.0.0'}-${new Date().toISOString().slice(0, 10)}`;
  } catch {}

  return {
    provider,
    apiKey,
    baseUrl,
    model,
    hasApiKey: !!apiKey,
    datasetVersion,
  };
}

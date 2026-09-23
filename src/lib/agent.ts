// FASE 5 — Agente AI con constraint "mai numeri inventati"
//
// ARCHITETTURA:
//  L'agente è un LLM che ha in dotazione SOLO tool che fanno query al DB.
//  Non può mai "inventare" un prezzo, credito o quotazione — deve passare
//  da un tool per averlo. Se l'API LLM fallisce (key mancante, timeout,
//  errore), si ricade nella modalità deterministica.
//
// MODALITÀ:
//  - ai:       chiama l'LLM con i tool (se ANTHROPIC_API_KEY è presente)
//  - fallback: risposta deterministica pura (nessun LLM, etichettata "[deterministica]")
//
// IL LLM NON PUÒ:
//  - inventare un numero (deve chiamare un tool)
//  - usare numeri non restituiti da un tool nella stessa conversazione
//  - invocare un tool con parametri che non gli sono stati forniti dall'utente

import { replayEffective } from './events';
import { getDataset } from './agent-tools';
import { TOOL_MAP, ALL_TOOLS, type AgentContext } from './agent-tools';
import { getAgentConfig } from './agent-config';

export type AgentMode = 'ai' | 'deterministic' | 'unavailable';

export type AgentResponse = {
  mode: AgentMode;
  message: string;
  toolCalls?: Array<{ tool: string; params: Record<string, any>; result: any }>;
  raw?: string;
};

// ─────────────────────────────────────────────────
// Costruzione del system prompt (regole ferree)
// ─────────────────────────────────────────────────

function buildSystemPrompt(managerName: string): string {
  return `\
Sei Coach Beard, l'assistente dell'asta di Fantacalcio di ${managerName}.
Sei un esperto di Serie A 2026-27 e di aste di fantacalcio.

REGOLA ASSOLUTA — MAI NUMERI INVENTATI:
Ogni prezzo, credito, quotazione o dato numerico che citi DEVE provenire
da un tool che hai chiamato in questa stessa conversazione. Non inventare,
non stimare, non arrotondare a caso. Se non hai chiamato il tool giusto,
chiamalo PRIMA di parlare.

REGOLE DELLA LEGA:
- 8 partecipanti, 500 crediti ciascuno
- Rosa: 3 P, 8 D, 8 C, 6 A (totale 25)
- Devono restare 1 credito per ogni slot vuoto

I TUOI TOOL (SOLO QUESTI, NIENT'ALTRO):
${ALL_TOOLS.map((t) => `- ${t.name}: ${t.description}`).join('\n')}

STILE:
- Rispondi in italiano
- Chiamati "Coach Beard"
- Usa i dati reali dai tool. Mai numeri inventati.
- Se l'utente chiede un parere su un giocatore, chiama prima getPlayerProfile.
- Se l'utente chiede quanto può spendere, chiama prima calculateBidCeiling.
- Spiega il ragionamento, poi dai la raccomandazione.
- Se non hai abbastanza dati, dillo e chiama il tool necessario.

NESSUNA INVENZIONE: se non conosci un dato, chiama il tool appropriato.`;
}

// ─────────────────────────────────────────────────
// Tool → OpenAI function format
// ─────────────────────────────────────────────────

function toolsToOpenAIFunctions() {
  return ALL_TOOLS.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        properties: (t.parameters as any).properties ?? {},
        required: (t.parameters as any).required ?? [],
      },
    },
  }));
}

// ─────────────────────────────────────────────────
// Esecuzione di un singolo tool (solo query DB, niente LLM)
// ─────────────────────────────────────────────────

function executeTool(
  toolName: string,
  params: Record<string, any>,
  context: AgentContext
): { ok: true; result: any } | { ok: false; error: string } {
  const tool = TOOL_MAP[toolName];
  if (!tool) return { ok: false, error: `Tool sconosciuto: ${toolName}` };
  try {
    const result = tool.execute(params, context);
    return { ok: true, result };
  } catch (err: any) {
    return { ok: false, error: err.message ?? String(err) };
  }
}

// ─────────────────────────────────────────────────
// Deterministic fallback: risponde SENZA LLM
// Usa regole fisse, mai numeri inventati (query al DB sempre)
// ─────────────────────────────────────────────────

function deterministicResponse(
  userMessage: string,
  context: AgentContext
): AgentResponse {
  const msg = userMessage.toLowerCase();

  // Query i dati necessari
  const ds = getDataset();
  const snap = context.snapshot;

  // Cerca di capire cosa chiede l'utente
  if (msg.includes('quanto') && (msg.includes('credit') || msg.includes('sold') || msg.includes('budget'))) {
    const owner = snap.managers.find((m) => m.isOwner)!;
    const emptySlots = 25 - owner.players.length;
    const ceiling = Math.max(0, owner.credits - emptySlots);
    const playerNames = owner.players.map((p) => `${p.name} (${p.prezzo})`).join(', ') || 'nessuno';
    return {
      mode: 'deterministic',
      message: `[Modalità deterministica]
Coach Beard dice:
Stato attuale per ${owner.name}:
- Crediti residui: ${owner.credits}
- Già spesi: ${owner.spent}
- Rosa: ${owner.players.length}/25 (${owner.byRole.P}P ${owner.byRole.D}D ${owner.byRole.C}C ${owner.byRole.A}A)
- Slot vuoti: ${emptySlots}
- Tetto massimo per il prossimo acquisto: ${ceiling}
  (formula: ${owner.credits} - ${emptySlots} = ${ceiling})
Acquisti finora: ${playerNames}`,
    };
  }

  if (msg.includes('consigli') || msg.includes('prossim') || msg.includes('chiam')) {
    const owner = snap.managers.find((m) => m.isOwner)!;
    const emptySlots = 25 - owner.players.length;
    const ceiling = Math.max(0, owner.credits - emptySlots);
    const candidates = ds.players
      .filter((p: any) => !snap.playerStatus[p.id] && p.quotAttuale && p.quotAttuale <= ceiling)
      .sort((a: any, b: any) => {
        if (b.pupillo !== a.pupillo) return b.pupillo ? 1 : -1;
        return (b.quotAttuale ?? 0) - (a.quotAttuale ?? 0);
      })
      .slice(0, 5);

    if (candidates.length === 0) {
      return {
        mode: 'deterministic',
        message: `[Modalità deterministica]
Coach Beard dice:
Non ci sono candidati disponibili entro il tetto ${ceiling} crediti.
Hai ${emptySlots} slot vuoti e ${owner.credits} crediti residui.
Completa prima la rosa prima di fare offerte più alte.`,
      };
    }

    const list = candidates
      .map((p: any, i: number) =>
        `${i + 1}) ${p.nome} (${p.squadra}, ${p.ruolo}) — quotazione ${p.quotAttuale}, fascia ${p.fascia ?? '?'}${p.pupillo ? ' ★ pupillo' : ''}`
      )
      .join('\n');

    return {
      mode: 'deterministic',
      message: `[Modalità deterministica]
Coach Beard dice:
Top ${candidates.length} candidati disponibili (ordine deterministico: pupilli prima, poi quotazione):
${list}
Tetto massimo per il prossimo acquisto: ${ceiling} crediti`,
    };
  }

  if (msg.includes('stato') || msg.includes('riepilog') || msg.includes('dove siamo')) {
    const matrix = snap.managers.map((m) => {
      const empty = 25 - m.players.length;
      return `${m.name}: ${m.credits} crediti, ${m.players.length}/25 (${m.byRole.P}P ${m.byRole.D}D ${m.byRole.C}C ${m.byRole.A}A), ${empty} vuoti`;
    }).join('\n');
    return {
      mode: 'deterministic',
      message: `[Modalità deterministica]
Coach Beard dice:
Stato asta: ${snap.state}, fase ${snap.phase}
— Situazione partecipanti —
${matrix}`,
    };
  }

  return {
    mode: 'deterministic',
    message: `[Modalità deterministica]
Coach Beard dice:
Non ho capito cosa intendi. Prova a chiedere:
- "Quanto budget ho?" — per sapere i tuoi crediti e il tetto massimo
- "Chi mi consigli?" — per avere una lista di candidati
- "Stato asta" — per il riepilogo di tutti i partecipanti`,
  };
}

// ─────────────────────────────────────────────────
// Agente principale
// ─────────────────────────────────────────────────

export async function runAgent(
  db: any,
  userMessage: string,
  options?: { managerId?: number; managerName?: string }
): Promise<AgentResponse> {
  const config = getAgentConfig();
  const ds = getDataset();
  const snap = await replayEffective(db, ds);

  const owner = options?.managerId
    ? snap.managers.find((m) => m.id === options.managerId)
    : options?.managerName
    ? snap.managers.find((m) => m.name === options.managerName)
    : snap.managers.find((m) => m.isOwner);

  const context: AgentContext = {
    snapshot: snap,
    datasetVersion: config.datasetVersion,
  };

  // ── Se non c'è API key → fallback deterministico immediato ──
  if (!config.hasApiKey) {
    return deterministicResponse(userMessage, context);
  }

  // ── Costruisco history per il LLM ──
  const systemPrompt = buildSystemPrompt(owner?.name ?? 'Elia');

  // ── Provo a chiamare l'LLM ──
  try {
    const response = await callLLM({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      systemPrompt,
      userMessage,
      tools: ALL_TOOLS,
      context,
    });
    return response;
  } catch (err: any) {
    console.error('[Coach Beard] LLM call failed:', err.message);
    return deterministicResponse(userMessage, context);
  }
}

// ─────────────────────────────────────────────────
// Chiamata LLM (supporta OpenAI-compatible e Anthropic)
// ─────────────────────────────────────────────────

async function callLLM(opts: {
  apiKey: string;
  baseUrl?: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
  tools: typeof ALL_TOOLS;
  context: AgentContext;
}): Promise<AgentResponse> {
  const { apiKey, baseUrl, model, systemPrompt, userMessage, tools, context } = opts;

  // Rileva il provider dalla baseUrl o dal modello
  const isAnthropic = !baseUrl || baseUrl.includes('anthropic') || model.startsWith('claude');
  const isOpenAI = !isAnthropic;

  if (isAnthropic) {
    return callAnthropic({ apiKey, model, systemPrompt, userMessage, tools, context });
  } else {
    return callOpenAICompatible({ apiKey, baseUrl: baseUrl!, model, systemPrompt, userMessage, tools, context });
  }
}

// ── Anthropic (Claude) ──
async function callAnthropic(opts: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
  tools: typeof ALL_TOOLS;
  context: AgentContext;
}): Promise<AgentResponse> {
  const { apiKey, model, systemPrompt, userMessage, tools, context } = opts;

  const messages: Array<{ role: string; content: string | Array<any> }> = [
    { role: 'user', content: userMessage },
  ];

  const toolDefs = tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: 'object',
      properties: (t.parameters as any).properties ?? {},
      required: (t.parameters as any).required ?? [],
    },
  }));

  const maxIterations = 10;
  for (let i = 0; i < maxIterations; i++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        system: systemPrompt,
        messages,
        tools: toolDefs,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${err}`);
    }

    const data = await res.json() as any;
    const stopReason = data.stop_reason;

    // Aggiungo il messaggio del modello
    const content = data.content ?? [];
    messages.push({ role: 'assistant', content });

    // Se ha finito con stop_reason != 'tool_use', restituisco
    if (stopReason !== 'tool_use') {
      const text = content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
      return { mode: 'ai', message: text, raw: JSON.stringify(data) };
    }

    // Esegui i tool chiamati
    for (const block of content) {
      if (block.type !== 'tool_use') continue;
      const exec = executeTool(block.name, block.input ?? {}, context);
      messages.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: block.id,
            content: JSON.stringify(exec.ok ? exec.result : { error: exec.error }),
          },
        ],
      });
    }
  }

  return { mode: 'ai', message: '[Coach Beard] Ho raggiunto il numero massimo di chiamate tool. Riprova con una domanda più specifica.', raw: '' };
}

// ── OpenAI-compatible (DeepSeek, Groq, Ollama, ecc.) ──
async function callOpenAICompatible(opts: {
  apiKey: string;
  baseUrl: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
  tools: typeof ALL_TOOLS;
  context: AgentContext;
}): Promise<AgentResponse> {
  const { apiKey, baseUrl, model, systemPrompt, userMessage, tools, context } = opts;

  const messages: Array<{ role: string; content: string | Array<any> }> = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ];

  const functions = toolsToOpenAIFunctions();
  const maxIterations = 10;

  for (let i = 0; i < maxIterations; i++) {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        tools: functions,
        tool_choice: 'auto',
        max_tokens: 1024,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI-compatible API error ${res.status}: ${err}`);
    }

    const data = await res.json() as any;
    const choices = data.choices ?? [];
    if (choices.length === 0) throw new Error('Nessuna risposta dal modello');

    const choice = choices[0];
    const msg = choice.message;

    // Se non ci sono tool call, restituisci
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return { mode: 'ai', message: msg.content ?? '', raw: JSON.stringify(data) };
    }

    // Aggiungo il messaggio dell'assistente
    messages.push(msg);

    // Esegui ogni tool chiamato
    for (const call of msg.tool_calls) {
      const exec = executeTool(call.function.name, JSON.parse(call.function.arguments), context);
      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(exec.ok ? exec.result : { error: exec.error }),
      });
    }
  }

  return { mode: 'ai', message: '[Coach Beard] Ho raggiunto il numero massimo di chiamate tool. Riprova con una domanda più specifica.', raw: '' };
}

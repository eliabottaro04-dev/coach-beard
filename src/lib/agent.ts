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

function buildSystemPrompt(owner: any, context: AgentContext): string {
  const snap = context.snapshot;
  const ownerName = owner?.name ?? 'Elia';
  const emptySlots = owner ? 25 - owner.players.length : 25;
  const ceiling = owner ? Math.max(0, owner.credits - emptySlots) : 500;
  const acquired = owner?.players?.map((p: any) => `${p.name} (${p.prezzo}cr)`).join(', ') || 'nessuno';

  // Analisi rivali più ricchi
  const topOpponents = snap.managers
    .filter((m: any) => m.id !== owner?.id)
    .sort((a: any, b: any) => b.credits - a.credits)
    .slice(0, 3)
    .map((m: any) => `${m.name}: ${m.credits}cr (tetto ${Math.max(0, m.credits - (25 - m.players.length))}cr)`)
    .join('; ');

  return `\
Sei Coach Beard, il leggendario assistente tattico per l'asta del Fantacalcio di ${ownerName}.
Sei un profondo conoscitore della Serie A 2026-27 e della teoria dei giochi applicata alle aste di fantacalcio (8 partecipanti, 500 crediti, 3P-8D-8C-6A).

QUADRO TATTICO AGGIORNATO (DATI REALI DAL DATABASE):
- Squadra di ${ownerName}: ${owner?.credits ?? 500} crediti residui, ${owner?.spent ?? 0} spesi
- Rosa attuale: ${owner?.players?.length ?? 0}/25 (${owner?.byRole?.P ?? 0}P ${owner?.byRole?.D ?? 0}D ${owner?.byRole?.C}C ${owner?.byRole?.A ?? 0}A)
- Slot vuoti: ${emptySlots} (deve restare almeno 1 credito per ogni slot)
- Tetto massimo legale per il prossimo acquisto: ${ceiling} crediti
- Giocatori già in rosa: ${acquired}
- Principali rivali per budget: ${topOpponents || 'Nessuno'}

REGOLA D'ORO — MAI NUMERI INVENTATI:
Ogni prezzo, quotazione o statistica DEVE provenire dal quadro tattico sopra o da una chiamata a uno dei tuoi tool. Non inventare, stimare o arrotondare cifre.

STRUTTURA DELLE RACCOMANDAZIONI TATTICHE:
Quando consigli o valuti un calciatore, fornisci una risposta chiara e strutturata:
- AZIONE: [BUY | BID_UP_TO | PASS]
- TETTO CONSIGLIATO: cifra esatta consigliata (non superare mai il tetto legale di ${ceiling} crediti)
- MOTIVAZIONE TATTICA: 2 o 3 punti incisivi (titolarità, bonus, slot coperti, rapporto qualità/prezzo)
- ALTERNATIVE: se consigli di passare, suggerisci un'alternativa con i tuoi tool

STILE:
- Rispondi sempre in italiano, carismatico, incisivo e pragmatico come Coach Beard
- Usa i tool autorizzati se hai bisogno di dettagli specifici su un calciatore o sul listone.`;
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

// ─────────────────────────────────────────────────
// Helper: Ricerca fuzzy / alias per calciatore
// ─────────────────────────────────────────────────

function findMatchingPlayer(query: string, ds: any): any | null {
  const q = query.toLowerCase().trim();
  const cleanQ = q.replace(/^(chi è|parlami di|scheda|profilo|info su|dimmi di|quanto vale|prendo|comprare)\s+/i, '').trim();

  // 1. Alias comuni
  const aliases: Record<string, number> = {
    'maignan': 4995, 'svilar': 4991, 'vicario': 4964, 'di gregorio': 2628, 'gregorio': 2628,
    'lautaro martinez': 2764, 'lautaro': 2764, 'martinez l.': 2764,
    'calhanoglu': 2666, 'paz n.': 6875, 'nico paz': 6875, 'paz': 6875,
    'dimarco': 2541, 'bastoni': 2538, 'tomori': 2540, 'buongiorno': 2627,
    'dybala': 2720, 'vlahovic': 2731, 'morata': 6777, 'retegui': 5853,
    'kvaratskhelia': 4976, 'kvara': 4976, 'leao': 2760, 'lookman': 4979,
    'thuram': 5841, 'koopmeiners': 2673, 'zaccagni': 2667, 'pulisic': 5848
  };

  for (const [alias, id] of Object.entries(aliases)) {
    if (cleanQ.includes(alias) || q.includes(alias)) {
      const found = ds.players.find((p: any) => p.id === id);
      if (found) return found;
    }
  }

  // 2. Match esatto per nome completo o cognome
  for (const p of ds.players) {
    const nomeNorm = p.nome.toLowerCase();
    if (cleanQ === nomeNorm) return p;
  }

  // 3. Match cognome o parola chiave lunga (> 3 lettere)
  const words = cleanQ.split(/\s+/).filter(w => w.length >= 4);
  for (const word of words) {
    const matches = ds.players.filter((p: any) => p.nome.toLowerCase().includes(word));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      // Priorità a giocatori con quotazione più alta
      return matches.sort((a: any, b: any) => (b.quotAttuale ?? 0) - (a.quotAttuale ?? 0))[0];
    }
  }

  return null;
}

// ─────────────────────────────────────────────────
// Deterministic fallback: risponde SENZA LLM
// Rispetta la pipeline tattica del PRD (Sezione 3)
// ─────────────────────────────────────────────────

function deterministicResponse(
  userMessage: string,
  context: AgentContext
): AgentResponse {
  const msg = userMessage.toLowerCase().trim();

  // Query i dati necessari
  const ds = getDataset();
  const snap = context.snapshot;
  const owner = snap.managers.find((m) => m.isOwner) ?? snap.managers[0];
  const emptySlots = 25 - owner.players.length;
  const ceiling = Math.max(0, owner.credits - emptySlots);

  // 1. BUDGET & TETTO RILANCIO
  if (msg.includes('quanto') && (msg.includes('credit') || msg.includes('sold') || msg.includes('budget') || msg.includes('tetto') || msg.includes('spendere'))) {
    const playerNames = owner.players.map((p) => `${p.name} (${p.prezzo})`).join(', ') || 'nessuno';
    const avgPerSlot = emptySlots > 0 ? (owner.credits / emptySlots).toFixed(1) : '0';
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
- Budget medio per slot rimanente: ${avgPerSlot} crediti
Acquisti finora: ${playerNames}`,
    };
  }

  // 2. CONFRONTO GIOCATORI ("meglio X o Y", "confronta X e Y")
  if ((msg.includes('meglio') || msg.includes('confront') || msg.includes(' vs ')) && (msg.includes(' o ') || msg.includes(' e ') || msg.includes(' con '))) {
    const parts = msg.replace(/^(chi è meglio tra|meglio|confronta|chi preferisci tra)\s+/i, '')
                     .split(/\s+(?:o|e|vs|contro)\s+/);
    if (parts.length >= 2) {
      const p1 = findMatchingPlayer(parts[0], ds);
      const p2 = findMatchingPlayer(parts[1], ds);

      if (p1 && p2) {
        const p1Status = snap.playerStatus[p1.id] ?? 'free';
        const p2Status = snap.playerStatus[p2.id] ?? 'free';
        const p1Owner = snap.playerOwner[p1.id] ? snap.managers.find(m => m.id === snap.playerOwner[p1.id])?.name : 'Nessuno';
        const p2Owner = snap.playerOwner[p2.id] ? snap.managers.find(m => m.id === snap.playerOwner[p2.id])?.name : 'Nessuno';

        let verdict = '';
        if (p1.quotAttuale > p2.quotAttuale) {
          verdict = `Punto su ${p1.nome}: quotazione e appeal superiori (${p1.quotAttuale} vs ${p2.quotAttuale}).`;
        } else if (p2.quotAttuale > p1.quotAttuale) {
          verdict = `Punto su ${p2.nome}: miglior rendimento atteso (${p2.quotAttuale} vs ${p1.quotAttuale}).`;
        } else {
          verdict = `Valutazione pari merito: scegli in base alle preferenze di squadra o ai piazzati.`;
        }

        return {
          mode: 'deterministic',
          message: `[Modalità deterministica]
Coach Beard — Confronto Tattico Diretto:

📊 1) ${p1.nome} (${p1.squadra}, ${p1.ruolo}):
- Quotazione: ${p1.quotAttuale} | Fascia: ${p1.fascia ?? 'N.D.'} | Titolarità: ${p1.titolarita ? (p1.titolarita * 100).toFixed(0) + '%' : 'N.D.'}
- Piazzati: Rigori: ${p1.rigorista ? 'Sì' : 'No'}, Punizioni: ${p1.punizioni ? 'Sì' : 'No'}
- Stato asta: ${p1Status === 'sold' ? `Preso da ${p1Owner}` : 'Disponibile'}

📊 2) ${p2.nome} (${p2.squadra}, ${p2.ruolo}):
- Quotazione: ${p2.quotAttuale} | Fascia: ${p2.fascia ?? 'N.D.'} | Titolarità: ${p2.titolarita ? (p2.titolarita * 100).toFixed(0) + '%' : 'N.D.'}
- Piazzati: Rigori: ${p2.rigorista ? 'Sì' : 'No'}, Punizioni: ${p2.punizioni ? 'Sì' : 'No'}
- Stato asta: ${p2Status === 'sold' ? `Preso da ${p2Owner}` : 'Disponibile'}

💡 Verdetto Coach Beard:
${verdict}`,
        };
      }
    }
  }

  // 3. ANALISI FABBISOGNI ROSA ("cosa mi manca", "situazione rosa", "emergenze")
  if (msg.includes('manca') || msg.includes('ruol') || msg.includes('emergenz') || msg.includes('fabbisogn') || msg.includes('scopert')) {
    const pNeed = 3 - owner.byRole.P;
    const dNeed = 8 - owner.byRole.D;
    const cNeed = 8 - owner.byRole.C;
    const aNeed = 6 - owner.byRole.A;

    return {
      mode: 'deterministic',
      message: `[Modalità deterministica]
Coach Beard — Analisi Tattica della Rosa per ${owner.name}:

📋 Situazione slot (totale ${owner.players.length}/25, ${emptySlots} vuoti):
- Portieri (P): ${owner.byRole.P}/3 ${pNeed > 0 ? `(mancano ${pNeed})` : '✅ Completo'}
- Difensori (D): ${owner.byRole.D}/8 ${dNeed > 0 ? `(mancano ${dNeed})` : '✅ Completo'}
- Centrocampisti (C): ${owner.byRole.C}/8 ${cNeed > 0 ? `(mancano ${cNeed})` : '✅ Completo'}
- Attaccanti (A): ${owner.byRole.A}/6 ${aNeed > 0 ? `(mancano ${aNeed})` : '✅ Completo'}

💰 Gestione Risorse:
- Crediti disponibili: ${owner.credits}
- Tetto massimo per un singolo giocatore: ${ceiling} crediti
- Riserva obbligatoria per completare la rosa: ${emptySlots > 1 ? emptySlots - 1 : 0} crediti (1 per ogni altro slot)`,
    };
  }

  // 4. ANALISI AVVERSARI ("chi ha più crediti", "avversari", "pericolos", "rivali")
  if (msg.includes('avversar') || msg.includes('pericolos') || msg.includes('più credit') || msg.includes('più sold') || msg.includes('classifica')) {
    const sorted = [...snap.managers].sort((a, b) => b.credits - a.credits);
    const lines = sorted.map((m, idx) => {
      const mEmpty = 25 - m.players.length;
      const mCeiling = Math.max(0, m.credits - mEmpty);
      return `${idx + 1}. ${m.name}${m.isOwner ? ' (TU)' : ''}: ${m.credits} cr residui, ${mEmpty} slot vuoti, tetto max ${mCeiling} cr`;
    }).join('\n');

    return {
      mode: 'deterministic',
      message: `[Modalità deterministica]
Coach Beard — Analisi Pressione Avversari:

🏆 Classifica Potere d'Acquisto:
${lines}

💡 Consiglio Tattico:
Occhio a chi ha più di te: evita rilanci folli sui loro obiettivi primari a inizio asta. Aspetta che scarichino i crediti prima di piazzare i tuoi colpi pesanti.`,
    };
  }

  // 5. TATTICA CHIAMATE / BLUFF ("chi chiamo", "bluff", "far spendere")
  if (msg.includes('bluff') || msg.includes('far spendere') || msg.includes('tattica chiamat')) {
    const expensiveAvailable = ds.players
      .filter((p: any) => !snap.playerStatus[p.id] && (p.quotAttuale ?? 0) >= 25 && !p.pupillo)
      .slice(0, 3);
    const names = expensiveAvailable.map((p: any) => `${p.nome} (${p.squadra}, quot. ${p.quotAttuale})`).join(', ');

    return {
      mode: 'deterministic',
      message: `[Modalità deterministica]
Coach Beard — Strategia delle Chiamate (Game Theory):

🎯 Strategia Drenante (Falli spendere):
Chiama giocatori dal nome altisonante che non sono tra i tuoi obiettivi prioritari per togliere liquidità agli avversari più ricchi.
Candidati ideali da chiamare adesso: ${names || 'Top di reparto non nei tuoi piani'}.

🛡️ Strategia Protetta (Per i tuoi obiettivi):
Non chiamare MAI i tuoi pupilli o le tue scommesse all'inizio. Tienili per i momenti di stanchezza dell'asta o quando i rivali diretti hanno terminato gli slot per quel ruolo.`,
    };
  }

  // 6. STATO ASTA GENERALE (prima della player search per evitare false corrispondenze)
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

  // 7. SCHEDA SINGOLO GIOCATORE ("chi è X", "parlami di X", "scheda X")
  // Guarda keywords esplicite oppure query breve (< 25 caratteri) escludendo le keyword di sistema già gestite sopra
  const matchedPlayer = findMatchingPlayer(userMessage, ds);
  if (matchedPlayer && (msg.includes('chi è') || msg.includes('parlami') || msg.includes('scheda') || msg.includes('info') || msg.includes('vale') || msg.includes('profilo') || msg.length < 25)) {
    const isSold = snap.playerStatus[matchedPlayer.id] === 'sold';
    const ownerName = isSold && snap.playerOwner[matchedPlayer.id]
      ? snap.managers.find(m => m.id === snap.playerOwner[matchedPlayer.id])?.name ?? 'Sconosciuto'
      : null;

    const maxSpend = Math.min(ceiling, Math.max(1, Math.round((matchedPlayer.quotAttuale ?? 1) * 1.2)));
    const action = isSold ? 'PASS (Già acquistato)' : matchedPlayer.quotAttuale > ceiling ? 'PASS (Fuori budget)' : 'BID_UP_TO';

    return {
      mode: 'deterministic',
      message: `[Modalità deterministica]
Coach Beard — Scheda Tattica Calciatore:

👤 ${matchedPlayer.nome} (${matchedPlayer.squadra})
- Ruolo: ${matchedPlayer.ruolo} (Mantra: ${matchedPlayer.ruoloMantra ?? matchedPlayer.ruolo})
- Quotazione: ${matchedPlayer.quotAttuale} | FVM: ${matchedPlayer.fvm ?? matchedPlayer.quotAttuale} | Fascia: ${matchedPlayer.fascia ?? 'N.D.'}
- Specialità: ${matchedPlayer.rigorista ? '🎯 Rigorista | ' : ''}${matchedPlayer.punizioni ? '⚡ Punizioni | ' : ''}${matchedPlayer.pupillo ? '⭐ TUO PUPILLO | ' : ''}Titolarità: ${matchedPlayer.titolarita ? (matchedPlayer.titolarita * 100).toFixed(0) + '%' : 'Titolare'}
- Stato asta: ${isSold ? `🔴 Assegnato a ${ownerName}` : '🟢 Libero'}
${matchedPlayer.noteGuida ? `- Note Guida: ${matchedPlayer.noteGuida}` : ''}

🎯 Raccomandazione Tattica:
- Azione: ${action}
- Tetto consigliato: fino a ${maxSpend} crediti (il tuo tetto legale è ${ceiling} crediti)`,
    };
  }

  // 8. CONSIGLI / TARGET
  if (msg.includes('consigli') || msg.includes('prossim') || msg.includes('chiam') || msg.includes('target') || msg.includes('prendere')) {
    // Filtro ruolo opzionale
    let targetRole: string | undefined;
    if (msg.includes('portier') || msg.includes(' p ') || msg.endsWith(' p')) targetRole = 'P';
    else if (msg.includes('difens') || msg.includes(' d ') || msg.endsWith(' d')) targetRole = 'D';
    else if (msg.includes('centrocamp') || msg.includes(' c ') || msg.endsWith(' c')) targetRole = 'C';
    else if (msg.includes('attacc') || msg.includes(' a ') || msg.endsWith(' a')) targetRole = 'A';

    const candidates = ds.players
      .filter((p: any) => {
        if (snap.playerStatus[p.id]) return false;
        if (targetRole && p.ruolo !== targetRole) return false;
        return p.quotAttuale && p.quotAttuale <= ceiling;
      })
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
Non ci sono candidati disponibili entro il tetto ${ceiling} crediti${targetRole ? ` per il ruolo ${targetRole}` : ''}.
Hai ${emptySlots} slot vuoti e ${owner.credits} crediti residui.
Completa prima la rosa prima di fare offerte più alte.`,
      };
    }

    const list = candidates
      .map((p: any, i: number) =>
        `${i + 1}) ${p.nome} (${p.squadra}, ${p.ruolo}) — quotazione ${p.quotAttuale}, fascia ${p.fascia ?? '?'}${p.pupillo ? ' ★ pupillo' : ''}${p.rigorista ? ' [Rigorista]' : ''}`
      )
      .join('\n');

    return {
      mode: 'deterministic',
      message: `[Modalità deterministica]
Coach Beard dice:
Top ${candidates.length} candidati disponibili${targetRole ? ` per il ruolo ${targetRole}` : ''} (ordine deterministico: pupilli prima, poi quotazione):
${list}
Tetto massimo per il prossimo acquisto: ${ceiling} crediti`,
    };
  }

  return {
    mode: 'deterministic',
    message: `[Modalità deterministica]
Coach Beard dice:
Non ho capito cosa intendi. Prova a chiedere:
- "Quanto budget ho?" — per sapere i tuoi crediti e il tetto massimo
- "Cosa mi manca?" — per l'analisi dei reparti scoperti
- "Chi mi consigli?" oppure "Consigli attaccanti" — per i migliori target disponibili
- "Chi è [Nome Calciatore]?" — per la scheda tecnica, quotazione e valutazione d'asta
- "Meglio [Nome1] o [Nome2]?" — per il confronto diretto
- "Chi ha più crediti?" — per la pressione degli avversari
- "Chi posso chiamare per far spendere gli altri?" — tattica delle chiamate
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

  // ── Costruisco history per il LLM con il quadro tattico ──
  const systemPrompt = buildSystemPrompt(owner, context);

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

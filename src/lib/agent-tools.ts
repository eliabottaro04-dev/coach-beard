// FASE 5 — Tool per l'agente AI
// Regola ferrea: ogni tool legge SOLO dal database/event-log/dataset.
// Nessun tool inventa, stima o deduce numeri senza consultarne la fonte.
//
// Interfaccia tool: { name, description, parameters, execute(params, context) }
// I parametri 'playerId', 'managerId' etc. sono sempre numeri/stringhe esterne,
// MAI generati dal LLM senza una query precedente.

import type { AuctionSnapshot } from './events';
import type { AuctionEvent } from './events';
import { replayEffective, listAllEvents } from './events';
import { LEAGUE_RULES, ROSTER_SIZE } from './league-rules';
import { loadDataset } from './dataset';

// ─────────────────────────────────────────────────
// Dataset (letto una volta, sempre dalla stessa versione locked)
// prefers public/ (Vercel) then data/ (local dev)
// ─────────────────────────────────────────────────

let _ds: any = null;
export function getDataset() {
  if (_ds) return _ds;
  _ds = loadDataset();
  return _ds;
}

// ─────────────────────────────────────────────────
// Tool: getAuctionState
// Ritorna stato, fase, versione dell'asta.
// Non ha parametri obbligatori.
// ─────────────────────────────────────────────────

export const getAuctionState = {
  name: 'getAuctionState',
  description: 'Ritorna lo stato attuale dell\'asta: fase (DRAFT/LIVE/PAUSED/COMPLETED), reparto corrente, versione del dataset bloccato, timestamp di avvio. Non ha parametri.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: (_params: any, context: AgentContext) => {
    const snap = context.snapshot;
    return {
      state: snap.state,
      phase: snap.phase,
      stateVersion: snap.stateVersion,
      datasetVersion: context.datasetVersion ?? 'unknown',
      startedAt: snap.startedAt,
      completedAt: snap.completedAt,
      _tool: 'getAuctionState',
    };
  },
};

// ─────────────────────────────────────────────────
// Tool: searchPlayers
// Cerca calciatori per nome (case-insensitive, parziale).
// Filtra per ruolo opzionale.
// ─────────────────────────────────────────────────

export const searchPlayers = {
  name: 'searchPlayers',
  description: 'Cerca calciatori per nome o cognome (parziale). Opzionalmente filtra per ruolo (P/D/C/A). Ritorna i primi `limit` risultati (default 20, max 50). I risultati mostrano: id, nome, ruolo, squadra, quotazione attuale, fascia, se è già stato acquistato.',
  parameters: {
    type: 'object',
    properties: {
      query:   { type: 'string',  description: 'Nome o cognome da cercare (parziale, case-insensitive)' },
      role:    { type: 'string',  description: 'Filtra per ruolo: P | D | C | A (opzionale)' },
      limit:   { type: 'integer', description: 'Numero massimo di risultati (default 20, max 50)', default: 20 },
    },
    required: ['query'],
  },
  execute: (params: { query: string; role?: string; limit?: number }, context: AgentContext) => {
    const ds = getDataset();
    const q = (params.query || '').toLowerCase().trim();
    if (!q) return { results: [], _tool: 'searchPlayers' };
    let results = ds.players.filter((p: any) => {
      if (!`${p.nome} ${p.squadra}`.toLowerCase().includes(q)) return false;
      if (params.role && p.ruolo !== params.role) return false;
      return true;
    }).slice(0, Math.min(params.limit ?? 20, 50));

    const snap = context.snapshot;
    return {
      count: results.length,
      results: results.map((p: any) => ({
        playerId: p.id,
        nome: p.nome,
        ruolo: p.ruolo,
        squadra: p.squadra,
        quotAttuale: p.quotAttuale,
        fascia: p.fascia,
        prezzoGuida: p.prezzoGuida,
        pupillo: p.pupillo,
        status: snap.playerStatus[p.id] ?? 'free',
        owner: snap.playerOwner[p.id] ? context.snapshot.managers.find((m) => m.id === snap.playerOwner[p.id])?.name : null,
      })),
      _tool: 'searchPlayers',
    };
  },
};

// ─────────────────────────────────────────────────
// Tool: getPlayerProfile
// Profilo completo di un calciatore.
// ─────────────────────────────────────────────────

export const getPlayerProfile = {
  name: 'getPlayerProfile',
  description: 'Ritorna il profilo dettagliato di un calciatore dato il suo playerId. Include: dati anagrafici, quotazione, fascia, prezzo guida personale, titolarità, note, flag (pupillo, valorizzato, penalizzato, giovane, rigorista, ballottaggio), e stato attuale nell\'asta.',
  parameters: {
    type: 'object',
    properties: {
      playerId: { type: 'integer', description: 'ID numerico del calciatore (dal listone)' },
    },
    required: ['playerId'],
  },
  execute: (params: { playerId: number }, context: AgentContext) => {
    const ds = getDataset();
    const p = ds.players.find((x: any) => x.id === params.playerId);
    if (!p) return { error: 'Calciatore non trovato', _tool: 'getPlayerProfile' };
    const snap = context.snapshot;
    const ownerId = snap.playerOwner[params.playerId];
    return {
      playerId: p.id,
      nome: p.nome,
      ruolo: p.ruolo,
      ruoloMantra: p.ruoloMantra,
      squadra: p.squadra,
      quotAttuale: p.quotAttuale,
      quotIniziale: p.quotIniziale,
      diff: p.diff,
      fvm: p.fvm,
      fascia: p.fascia,
      prezzoGuida: p.prezzoGuida,
      budgetPct: p.budgetPct,
      titolarita: p.titolarita,
      mv: p.mv,
      titolareXI: p.titolareXI,
      ballottaggio: p.ballottaggio,
      valorizzato: p.valorizzato,
      penalizzato: p.penalizzato,
      giovane: p.giovane,
      rigorista: p.rigorista,
      punizioni: p.punizioni,
      corner: p.corner,
      pupillo: p.pupillo,
      noteGuida: p.noteGuida,
      auctionStatus: snap.playerStatus[params.playerId] ?? 'free',
      owner: ownerId ? snap.managers.find((m) => m.id === ownerId)?.name : null,
      _tool: 'getPlayerProfile',
    };
  },
};

// ─────────────────────────────────────────────────
// Tool: getManagerState
// Stato completo di un partecipante.
// ─────────────────────────────────────────────────

export const getManagerState = {
  name: 'getManagerState',
  description: 'Ritorna lo stato completo di un partecipante: nome, crediti iniziali, spesi, residui, tetto massimo spendibile (preservando 1 credito per ogni slot vuoto), rosa dettagliata per ruolo e lista giocatori acquistati.',
  parameters: {
    type: 'object',
    properties: {
      managerId:   { type: 'integer', description: 'ID numerico del manager (1-8)' },
      managerName: { type: 'string',  description: 'Nome del manager (alternativa a managerId)' },
    },
    required: [],
  },
  execute: (params: { managerId?: number; managerName?: string }, context: AgentContext) => {
    const snap = context.snapshot;
    let mgr: any = null;
    if (params.managerId != null) {
      mgr = snap.managers.find((m) => m.id === params.managerId);
    } else if (params.managerName) {
      mgr = snap.managers.find((m) => m.name === params.managerName);
    } else {
      // default: owner
      mgr = snap.managers.find((m) => m.isOwner);
    }
    if (!mgr) return { error: 'Manager non trovato', _tool: 'getManagerState' };

    const emptySlots = ROSTER_SIZE - mgr.players.length;
    const bidCeiling = Math.max(0, mgr.credits - emptySlots);
    const rosa = LEAGUE_RULES.roster;
    const byRoleMax = rosa;

    return {
      managerId: mgr.id,
      name: mgr.name,
      isOwner: mgr.isOwner,
      initialCredits: mgr.initialCredits,
      spent: mgr.spent,
      credits: mgr.credits,
      bidCeiling,
      emptySlots,
      rosterMax: ROSTER_SIZE,
      byRole: {
        current: mgr.byRole,
        max: byRoleMax,
      },
      players: mgr.players.map((p: any) => ({
        playerId: p.playerId,
        nome: p.name,
        ruolo: p.ruolo,
        prezzo: p.prezzo,
        ts: p.ts,
      })),
      _tool: 'getManagerState',
    };
  },
};

// ─────────────────────────────────────────────────
// Tool: getLeagueMatrix
// Matrice di confronto tra tutti gli 8 partecipanti.
// ─────────────────────────────────────────────────

export const getLeagueMatrix = {
  name: 'getLeagueMatrix',
  description: 'Ritorna una matrice comparativa di tutti i partecipanti: crediti residui, spesi, tetto massimo, slot liberi per ruolo (P/D/C/A), spesa media per giocatore, prime 3 raccomandazioni per completare la rosa. Non espone dettagli degli avversari che non siano già noti dall\'asta.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
  },
  execute: (_params: any, context: AgentContext) => {
    const snap = context.snapshot;
    const rosa = LEAGUE_RULES.roster;
    const matrix = snap.managers.map((m) => {
      const emptySlots = ROSTER_SIZE - m.players.length;
      const bidCeiling = Math.max(0, m.credits - emptySlots);
      const avgPrice = m.players.length > 0 ? Math.round(m.spent / m.players.length) : 0;
      const slotsFree = {
        P: Math.max(0, rosa.P - m.byRole.P),
        D: Math.max(0, rosa.D - m.byRole.D),
        C: Math.max(0, rosa.C - m.byRole.C),
        A: Math.max(0, rosa.A - m.byRole.A),
      };
      return {
        managerId: m.id,
        name: m.name,
        isOwner: m.isOwner,
        initialCredits: m.initialCredits,
        spent: m.spent,
        credits: m.credits,
        bidCeiling,
        emptySlots,
        avgPricePerPlayer: avgPrice,
        slotsFree,
        slotsByRole: m.byRole,
      };
    });
    return { matrix, _tool: 'getLeagueMatrix' };
  },
};

// ─────────────────────────────────────────────────
// Tool: calculateBidCeiling
// Calcola il massimo spendibile per un manager su un reparto.
// ─────────────────────────────────────────────────

export const calculateBidCeiling = {
  name: 'calculateBidCeiling',
  description: 'Calcola il tetto massimo che un partecipante può spendere mantenendo la possibilità di completare la rosa. Formula: crediti_residui - (slot_vuoti). Se il reparto target è già pieno il tetto può essere 0. Non applica sconti per "premio".',
  parameters: {
    type: 'object',
    properties: {
      managerId:   { type: 'integer', description: 'ID numerico del manager' },
      managerName: { type: 'string',  description: 'Nome del manager (alternativa)' },
      targetRole:  { type: 'string',  description: 'Reparto per cui si sta valutando l\'offerta (P/D/C/A). Se il manager ha già lo slot pieno, il tetto è 0.' },
    },
    required: ['managerId'],
  },
  execute: (params: { managerId?: number; managerName?: string; targetRole?: string }, context: AgentContext) => {
    const snap = context.snapshot;
    let mgr: any = null;
    if (params.managerId != null) mgr = snap.managers.find((m) => m.id === params.managerId);
    else if (params.managerName) mgr = snap.managers.find((m) => m.name === params.managerName);
    else mgr = snap.managers.find((m) => m.isOwner);
    if (!mgr) return { error: 'Manager non trovato', _tool: 'calculateBidCeiling' };

    const rosa = LEAGUE_RULES.roster;
    const emptySlots = ROSTER_SIZE - mgr.players.length;
    const bidCeiling = Math.max(0, mgr.credits - emptySlots);
    let roleCeiling = bidCeiling;
    if (params.targetRole) {
      const slotPieno = mgr.byRole[params.targetRole] >= rosa[params.targetRole];
      roleCeiling = slotPieno ? 0 : bidCeiling;
    }
    return {
      managerId: mgr.id,
      name: mgr.name,
      credits: mgr.credits,
      emptySlots,
      bidCeiling,
      roleCeiling: params.targetRole ? roleCeiling : undefined,
      targetRole: params.targetRole ?? null,
      slotPieno: params.targetRole ? mgr.byRole[params.targetRole] >= rosa[params.targetRole] : null,
      formula: `${mgr.credits} - ${emptySlots} = ${bidCeiling}`,
      _tool: 'calculateBidCeiling',
    };
  },
};

// ─────────────────────────────────────────────────
// Tool: rankNextNominations
// Ranking deterministico delle prossime chiamate disponibili.
// ─────────────────────────────────────────────────

export const rankNextNominations = {
  name: 'rankNextNominations',
  description: 'Ritorna le prossime N chiamate consigliate (default 5, max 10). Ordine deterministico: prima pupilli non ancora acquistati, poi per quotazione attuale discendente, filtrati per reparto corrente se specificato. Esclude calciatori già venduti o dichiarati invenduti.',
  parameters: {
    type: 'object',
    properties: {
      count:       { type: 'integer', description: 'Numero di suggerimenti (default 5, max 10)' },
      roleFilter:  { type: 'string',  description: 'Filtra per ruolo: P | D | C | A' },
      excludeIds:  { type: 'array',  items: { type: 'integer' }, description: 'PlayerId da escludere dalla lista' },
    },
    required: [],
  },
  execute: (params: { count?: number; roleFilter?: string; excludeIds?: number[] }, context: AgentContext) => {
    const ds = getDataset();
    const snap = context.snapshot;
    const excludeSet = new Set(params.excludeIds ?? []);

    const candidates = ds.players.filter((p: any) => {
      if (snap.playerStatus[p.id] === 'sold') return false;
      if (snap.playerStatus[p.id] === 'unsold') return false;
      if (excludeSet.has(p.id)) return false;
      if (params.roleFilter && p.ruolo !== params.roleFilter) return false;
      if (!p.quotAttuale || p.quotAttuale < 1) return false;
      return true;
    });

    // Ordinamento deterministico:
    // 1) Pupilli prima
    // 2) Quotazione attuale discendente
    // 3) Prezzo guida (se presente)
    candidates.sort((a: any, b: any) => {
      if (b.pupillo !== a.pupillo) return b.pupillo ? 1 : -1;
      if ((b.quotAttuale ?? 0) !== (a.quotAttuale ?? 0)) return (b.quotAttuale ?? 0) - (a.quotAttuale ?? 0);
      return (b.prezzoGuida ?? 0) - (a.prezzoGuida ?? 0);
    });

    const count = Math.min(params.count ?? 5, 10);
    const selected = candidates.slice(0, count);

    return {
      count: selected.length,
      phase: snap.phase,
      nominations: selected.map((p: any, i: number) => ({
        rank: i + 1,
        playerId: p.id,
        nome: p.nome,
        ruolo: p.ruolo,
        squadra: p.squadra,
        quotAttuale: p.quotAttuale,
        fascia: p.fascia,
        prezzoGuida: p.prezzoGuida,
        pupillo: p.pupillo,
        reason: p.pupillo ? 'Pupillo' : `Quotazione ${p.quotAttuale}`,
      })),
      _tool: 'rankNextNominations',
    };
  },
};

// ─────────────────────────────────────────────────
// Tool: comparePlayers
// Confronto diretto tra due calciatori sugli stessi fattori.
// ─────────────────────────────────────────────────

export const comparePlayers = {
  name: 'comparePlayers',
  description: 'Confronta due calciatori (playerId A vs playerId B) su fattori oggettivi: quotazione attuale, FMV, prezzo guida, titolarità, fascia, flag speciali (pupillo, valorizzato, ballottaggio). Non produce una raccomandazione: restituisce i dati grezzi per il LLM che li interpreterà.',
  parameters: {
    type: 'object',
    properties: {
      playerIdA: { type: 'integer', description: 'ID del primo calciatore' },
      playerIdB: { type: 'integer', description: 'ID del secondo calciatore' },
    },
    required: ['playerIdA', 'playerIdB'],
  },
  execute: (params: { playerIdA: number; playerIdB: number }, context: AgentContext) => {
    const ds = getDataset();
    const pA = ds.players.find((x: any) => x.id === params.playerIdA);
    const pB = ds.players.find((x: any) => x.id === params.playerIdB);
    const snap = context.snapshot;

    function playerData(p: any) {
      if (!p) return { error: 'Non trovato' };
      return {
        playerId: p.id,
        nome: p.nome,
        ruolo: p.ruolo,
        squadra: p.squadra,
        quotAttuale: p.quotAttuale,
        quotIniziale: p.quotIniziale,
        fvm: p.fvm,
        fascia: p.fascia,
        prezzoGuida: p.prezzoGuida,
        titolarita: p.titolarita,
        ballottaggio: p.ballottaggio,
        valorizzato: p.valorizzato,
        penalizzato: p.penalizzato,
        giovane: p.giovane,
        rigorista: p.rigorista,
        pupillo: p.pupillo,
        auctionStatus: snap.playerStatus[p.id] ?? 'free',
      };
    }
    return { playerA: playerData(pA), playerB: playerData(pB), _tool: 'comparePlayers' };
  },
};

// ─────────────────────────────────────────────────
// Tool: getSourceEvidence
// Recupera le evidenze e fonti per una raccomandazione.
// ─────────────────────────────────────────────────

export const getSourceEvidence = {
  name: 'getSourceEvidence',
  description: 'Ritorna le evidenze e fonti a supporto di una valutazione per un calciatore: quotazione (listone), FMV (storico), prezzo guida personale, note dalla guida oggettiva, fascia dalla strategia personale, e situazione nel reparto avversario (quanti avversari hanno quello slot pieno/libero).',
  parameters: {
    type: 'object',
    properties: {
      playerId: { type: 'integer', description: 'ID del calciatore' },
    },
    required: ['playerId'],
  },
  execute: (params: { playerId: number }, context: AgentContext) => {
    const ds = getDataset();
    const p = ds.players.find((x: any) => x.id === params.playerId);
    if (!p) return { error: 'Calciatore non trovato', _tool: 'getSourceEvidence' };

    const snap = context.snapshot;
    // Quanti manager hanno lo slot del ruolo di p già pieno
    const rosa = LEAGUE_RULES.roster;
    const slotPieni = snap.managers.filter((m) => m.byRole[p.ruolo] >= rosa[p.ruolo]).length;
    const slotLiberi = snap.managers.filter((m) => m.byRole[p.ruolo] < rosa[p.ruolo]).length;

    return {
      playerId: p.id,
      nome: p.nome,
      sources: {
        quotazioneAttuale: { value: p.quotAttuale, source: 'Listone 2026-27' },
        quotazioneIniziale: { value: p.quotIniziale, source: 'Listone 2026-27' },
        fvm: { value: p.fvm, source: 'FantaMediaVoto storico' },
        prezzoGuida: { value: p.prezzoGuida, source: 'Strategia personale' },
        budgetPct: { value: p.budgetPct, source: 'Strategia personale' },
        titolarita: { value: p.titolarita, source: 'Guida oggettiva' },
        fascia: { value: p.fascia, source: 'Strategia personale' },
        note: { value: p.noteGuida, source: 'Guida oggettiva' },
        ballottaggio: { value: p.ballottaggio, source: 'Guida oggettiva' },
        valorizzato: { value: p.valorizzato, source: 'Guida oggettiva' },
        penalizzato: { value: p.penalizzato, source: 'Guida oggettiva' },
      },
      ruoloScarisita: {
        ruolo: p.ruolo,
        slotPieniNellaLega: slotPieni,
        slotLiberiNellaLega: slotLiberi,
        source: 'Calcolo da stato asta',
      },
      _tool: 'getSourceEvidence',
    };
  },
};

// ─────────────────────────────────────────────────
// Registry dei tool (mappa per esecuzione)
// ─────────────────────────────────────────────────

export const ALL_TOOLS = [
  getAuctionState,
  searchPlayers,
  getPlayerProfile,
  getManagerState,
  getLeagueMatrix,
  calculateBidCeiling,
  rankNextNominations,
  comparePlayers,
  getSourceEvidence,
] as const;

export const TOOL_MAP: Record<string, typeof ALL_TOOLS[number]> = Object.fromEntries(
  ALL_TOOLS.map((t) => [t.name, t])
) as any;

// ─────────────────────────────────────────────────
// Context passato a ogni tool
// ─────────────────────────────────────────────────

export type AgentContext = {
  snapshot: AuctionSnapshot;
  datasetVersion: string;
};

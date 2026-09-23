// FASE 2B — Motore deterministico: regole + calcoli
// Questo file contiene TUTTA la logica del motore.
// È una libreria (non un'app): viene importato dai test e dalla web app.

import { leagueConfig } from '../config/league.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = resolve(__dirname, '..');

// ---------- caricamento dataset ----------
let _dataset = null;
export function loadDataset() {
  if (_dataset) return _dataset;
  _dataset = JSON.parse(readFileSync(resolve(ROOT, 'data/dataset.json'), 'utf-8'));
  return _dataset;
}

// ---------- struttura stato asta ----------
// Stato iniziale di un manager
export function newManagerState(slot, name, isOwner) {
  return {
    slot,
    name,
    isOwner,
    initialCredits: leagueConfig.initialCredits,
    spent: 0,
    credits: leagueConfig.initialCredits,
    players: [],            // array di { id, nome, ruolo, squadra, prezzo }
    byRole: { P: 0, D: 0, C: 0, A: 0 },
  };
}

// Stato iniziale dell'asta
export function newAuctionState() {
  return {
    status: 'DRAFT',         // DRAFT → READY → LIVE → PAUSED → COMPLETED
    phase: 'P',              // reparto corrente
    stateVersion: 0,
    datasetVersion: '1.0.0',
    startedAt: null,
    completedAt: null,
    managers: leagueConfig.managers.map((m) => newManagerState(m.slot, m.name, m.isOwner)),
    purchases: [],           // storico eventi
    playerStatus: {},        // { [playerId]: 'free' | 'sold' | 'unsold' }
  };
}

// ---------- utility ----------
export function getManager(state, slotOrName) {
  return state.managers.find((m) => m.slot === slotOrName || m.name === slotOrName);
}

export function getPlayer(id) {
  return loadDataset().players.find((p) => p.id === id);
}

export function searchPlayers(query, opts = {}) {
  const q = (query || '').toLowerCase().trim();
  if (!q) return [];
  let results = loadDataset().players.filter((p) => {
    const blob = `${p.nome} ${p.squadra}`.toLowerCase();
    return blob.includes(q);
  });
  if (opts.role) results = results.filter((p) => p.ruolo === opts.role);
  if (opts.onlyAvailable) results = results.filter((p) => p.quotAttuale != null);
  return results.slice(0, opts.limit || 30);
}

// ---------- calcoli economici ----------

// quanto può ancora spendere un manager preservando 1 credito per ogni slot vuoto rimanente
export function calculateBidCeiling(state, managerSlot) {
  const m = getManager(state, managerSlot);
  if (!m) throw new Error(`Manager non trovato: ${managerSlot}`);
  const rosa = leagueConfig.rosterSize;
  const totalSlots = rosa.P + rosa.D + rosa.C + rosa.A;
  const emptySlots = totalSlots - m.players.length;
  return m.credits - emptySlots; // preserva 1 credito per slot vuoto
}

// quanto ha speso + quanto può ancora spendere
export function managerSummary(state, managerSlot) {
  const m = getManager(state, managerSlot);
  if (!m) return null;
  return {
    name: m.name,
    isOwner: m.isOwner,
    initial: m.initialCredits,
    spent: m.spent,
    remaining: m.credits,
    players: m.players.length,
    byRole: { ...m.byRole },
    bidCeiling: calculateBidCeiling(state, managerSlot),
  };
}

// ---------- validazione acquisto ----------
// Verifica se un acquisto è ammissibile, PRIMA di committarlo
export function validatePurchase(state, { playerId, managerSlot, price }) {
  const errors = [];
  const p = getPlayer(playerId);
  if (!p) errors.push('Calciatore non trovato');
  const m = getManager(state, managerSlot);
  if (!m) errors.push('Manager non trovato');

  if (errors.length > 0) return { ok: false, errors };

  if (state.status !== 'LIVE') {
    errors.push(`Asta non in stato LIVE (attualmente: ${state.status})`);
  }

  if (state.playerStatus[playerId] === 'sold') {
    errors.push('Calciatore già acquistato');
  }

  const rosa = leagueConfig.rosterSize;
  if (m.byRole[p.ruolo] >= rosa[p.ruolo]) {
    errors.push(`Slot ${p.ruolo} pieno per ${m.name} (${m.byRole[p.ruolo]}/${rosa[p.ruolo]})`);
  }

  if (!Number.isInteger(price) || price <= 0) {
    errors.push('Prezzo deve essere un intero positivo');
  }

  if (m.credits < price) {
    errors.push(`Crediti insufficienti: ${m.name} ha ${m.credits}, servono ${price}`);
  }

  // preserva almeno 1 credito per ogni slot ancora vuoto
  const ceiling = calculateBidCeiling(state, managerSlot);
  if (price > ceiling) {
    errors.push(`Prezzo ${price} supera il tetto massimo ${ceiling} (per completare la rosa)`);
  }

  return { ok: errors.length === 0, errors, ceiling };
}

// ---------- registrazione acquisto (transazione in memoria) ----------
export function recordPurchase(state, { playerId, managerSlot, price, nominatedBy = null }) {
  const v = validatePurchase(state, { playerId, managerSlot, price });
  if (!v.ok) return { ok: false, errors: v.errors };

  const p = getPlayer(playerId);
  const m = getManager(state, managerSlot);

  // muta lo stato
  m.spent += price;
  m.credits -= price;
  m.players.push({
    id: p.id, nome: p.nome, ruolo: p.ruolo, squadra: p.squadra, prezzo: price,
  });
  m.byRole[p.ruolo] += 1;
  state.playerStatus[playerId] = 'sold';
  state.purchases.push({
    ts: new Date().toISOString(),
    sequenceId: state.purchases.length + 1,
    event: 'PURCHASE',
    playerId, managerSlot, price, nominatedBy,
  });
  state.stateVersion += 1;

  return { ok: true, purchase: state.purchases[state.purchases.length - 1] };
}

// marca un calciatore come invenduto (ricalcolabile)
export function markUnsold(state, { playerId, nominatedBy = null }) {
  const p = getPlayer(playerId);
  if (!p) return { ok: false, errors: ['Calciatore non trovato'] };
  if (state.playerStatus[playerId] === 'sold') {
    return { ok: false, errors: ['Calciatore già venduto'] };
  }
  state.playerStatus[playerId] = 'unsold';
  state.purchases.push({
    ts: new Date().toISOString(),
    sequenceId: state.purchases.length + 1,
    event: 'UNSOLD', playerId, nominatedBy,
  });
  state.stateVersion += 1;
  return { ok: true };
}

// riapri un calciatore "unsold" (perché riammesso all'asta)
export function markAvailable(state, { playerId }) {
  if (state.playerStatus[playerId] === 'sold') {
    return { ok: false, errors: ['Calciatore già venduto, usa undo'] };
  }
  delete state.playerStatus[playerId];
  return { ok: true };
}

// annulla l'ultimo evento significativo (PURCHASE o UNSOLD), con compensazione a log
export function undoLast(state) {
  // cerca l'ultimo PURCHASE o UNSOLD non ancora compensato
  let target = null;
  for (let i = state.purchases.length - 1; i >= 0; i--) {
    const e = state.purchases[i];
    if ((e.event === 'PURCHASE' || e.event === 'UNSOLD') && !e.compensated) {
      target = { ...e }; // clone per non restituire riferimento interno
      break;
    }
  }
  if (!target) return { ok: false, errors: ['Nessun acquisto o invenduto da annullare'] };

  // ripristina lo stato in base al tipo di evento
  if (target.event === 'UNSOLD') {
    delete state.playerStatus[target.playerId];
  } else {
    const p = getPlayer(target.playerId);
    const m = getManager(state, target.managerSlot);
    if (!p || !m) return { ok: false, errors: ['Stato inconsistente'] };
    m.spent -= target.price;
    m.credits += target.price;
    const idx = m.players.findIndex((x) => x.id === target.playerId);
    if (idx >= 0) m.players.splice(idx, 1);
    m.byRole[p.ruolo] -= 1;
    delete state.playerStatus[target.playerId];
  }

  // marca l'evento originale come compensato
  for (let i = state.purchases.length - 1; i >= 0; i--) {
    if (state.purchases[i].sequenceId === target.sequenceId) {
      state.purchases[i].compensated = true;
      state.purchases[i].compensatedAt = new Date().toISOString();
      break;
    }
  }

  // aggiungi evento di compensazione al log (non cambia la lunghezza dell'array reale)
  state.purchases.push({
    ts: new Date().toISOString(),
    sequenceId: state.purchases.length + 1,
    event: 'COMPENSATE',
    compensatedSequenceId: target.sequenceId,
    compensatedEventType: target.event,
    compensatedAt: new Date().toISOString(),
  });
  state.stateVersion += 1;
  return { ok: true, undone: target };
}

// ---------- raccomandazione deterministica (max spendibile + suggerimento) ----------
export function recommendBid(state, { playerId, managerSlot }) {
  const p = getPlayer(playerId);
  const m = getManager(state, managerSlot);
  if (!p || !m) return { action: 'PASS', reasons: ['dati non validi'] };

  const reasons = [];
  let action = 'PASS';
  let ceiling = calculateBidCeiling(state, managerSlot);

  // 1) se lo slot è pieno → passa
  const rosa = leagueConfig.rosterSize;
  if (m.byRole[p.ruolo] >= rosa[p.ruolo]) {
    return { action: 'PASS', reasons: [`Slot ${p.ruolo} pieno`], recommendedMaxBid: 0, ceiling };
  }

  // 2) prezzo guida è il riferimento (esiste?)
  let maxBid = 0;
  if (p.prezzoGuida != null) {
    maxBid = p.prezzoGuida;
    reasons.push(`Prezzo guida: ${p.prezzoGuida}`);
  } else {
    // fallback: 1 credito per ogni "fascia" - qui usiamo la quotazione come proxy
    maxBid = Math.max(1, p.quotAttuale || 0);
    reasons.push(`Fallback basato su quotazione ${p.quotAttuale}`);
  }

  // 3) aggiusta in base alla fase: se siamo a fine reparto, si può osare di più
  if (p.pupillo) {
    maxBid = Math.round(maxBid * 1.1);
    reasons.push(`Pupillo: +10% sul prezzo guida`);
  }

  // 4) clamp al massimo spendibile
  if (maxBid > ceiling) {
    reasons.push(`Tetto ${ceiling} < prezzo guida ${maxBid}, mi adeguo`);
    maxBid = ceiling;
  }

  // 5) decisione
  if (maxBid >= 1) action = 'BID_UP_TO';
  if (m.credits < 1) action = 'PASS';

  return {
    action,
    recommendedMaxBid: maxBid,
    ceiling,
    confidence: p.prezzoGuida != null ? 'MEDIUM' : 'LOW',
    reasons: reasons.slice(0, 3),
    sourceRefs: p.prezzoGuida != null ? ['strategiaFanta'] : ['fallback-quotazione'],
  };
}

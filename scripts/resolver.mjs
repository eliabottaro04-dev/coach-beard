// FASE 2 — Resolver calciatori
// Regole d'oro:
//  1) Mai indovinare: se un nome matcha più calciatori, BLOCCA.
//  2) Gli alias espliciti hanno priorità assoluta.
//  3) Match deterministico: stessa stringa + stesso ruolo + stessa squadra = stesso calciatore.
//  4) Match fuzzy per cognome SOLO se esattamente 1 candidato nel listone con quel cognome+ruolo.
//
// Output: { resolved: [{input, playerId}], ambiguous: [{input, candidates}], unresolved: [{input}] }

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const ROOT       = resolve(__dirname, '..');

const norm = (s) => (s == null ? '' : String(s))
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[''`´]/g, "'")
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .trim();

// Toglie suffissi iniziali "N." "L." "M." "G." "Jo." "T." tipici delle guide
const stripInitial = (s) => norm(s).replace(/^([a-z]+)\.?\s+([a-z]+\.)\s*$/, '$1 $2').trim();

let _dataset = null;
function loadDataset() {
  if (_dataset) return _dataset;
  _dataset = JSON.parse(readFileSync(resolve(ROOT, 'data/dataset.json'), 'utf-8'));
  return _dataset;
}

let _aliases = null;
function loadAliases() {
  if (_aliases) return _aliases;
  _aliases = JSON.parse(readFileSync(resolve(ROOT, 'data/aliases.json'), 'utf-8'));
  return _aliases;
}

/**
 * Risolve un singolo nome (opzionalmente con squadra e ruolo noti) verso un ID canonico.
 * Regole:
 *  1) Se esiste un alias esplicito per `input` → usa quello.
 *  2) Match esatto normalizzato (nome + squadra opzionale) → 1 risultato = OK, 0/2+ = BLOCCA.
 *  3) Match fuzzy per cognome + stesso ruolo → 1 risultato = OK, 2+ = BLOCCA (ambiguità).
 *  4) Nessun match → "unresolved".
 *
 * @param {{ name: string, squadra?: string, ruolo?: string }} input
 * @returns {{ ok: true, playerId: number } | { ok: false, reason: 'unresolved' | 'ambiguous', candidates?: number[] }}
 */
export function resolvePlayer(input) {
  const ds = loadDataset();
  const aliases = loadAliases();
  const rawName = (input.name || '').toString().trim();
  if (!rawName) return { ok: false, reason: 'unresolved' };

  // 1) alias esplicito
  const aliasHit = (aliases.aliases || []).find((a) => norm(a.from) === norm(rawName));
  if (aliasHit) {
    return { ok: true, playerId: aliasHit.toPlayerId, source: 'alias' };
  }

  // 2) match esatto normalizzato
  const nn = norm(rawName);
  const exactMatches = ds.players.filter((p) => {
    if (norm(p.nome) !== nn) return false;
    if (input.squadra && norm(p.squadra) !== norm(input.squadra)) return false;
    if (input.ruolo && p.ruolo !== input.ruolo) return false;
    return true;
  });
  if (exactMatches.length === 1) {
    return { ok: true, playerId: exactMatches[0].id, source: 'exact' };
  }
  if (exactMatches.length > 1) {
    return { ok: false, reason: 'ambiguous', candidates: exactMatches.map((p) => p.id) };
  }

  // 3) match fuzzy per cognome (prima parola), ristretto al ruolo se noto
  const cognome = nn.split(' ')[0].replace(/[.,]/g, '');
  if (cognome.length < 4) return { ok: false, reason: 'unresolved' };
  const fuzzyMatches = ds.players.filter((p) => {
    if (norm(p.nome).split(' ')[0].replace(/[.,]/g, '') !== cognome) return false;
    if (input.ruolo && p.ruolo !== input.ruolo) return false;
    if (input.squadra && norm(p.squadra) !== norm(input.squadra)) return false;
    return true;
  });
  if (fuzzyMatches.length === 1) {
    return { ok: true, playerId: fuzzyMatches[0].id, source: 'fuzzy-cognome' };
  }
  if (fuzzyMatches.length > 1) {
    return { ok: false, reason: 'ambiguous', candidates: fuzzyMatches.map((p) => p.id) };
  }

  return { ok: false, reason: 'unresolved' };
}

/**
 * Risolve un batch di input e produce un report.
 * Se `strict=true`, lancia un errore se trova ambiguità o nomi non risolti (BLOCCA INGESTIONE).
 */
export function resolveBatch(inputs, { strict = true } = {}) {
  const report = {
    total: inputs.length,
    resolved: [],
    ambiguous: [],   // { input, candidates: [{playerId, nome, squadra, ruolo}] }
    unresolved: [],  // { input }
    blocked: false,
  };

  for (const input of inputs) {
    const r = resolvePlayer(input);
    if (r.ok) {
      report.resolved.push({ input, playerId: r.playerId, source: r.source });
    } else if (r.reason === 'ambiguous') {
      const ds = loadDataset();
      report.ambiguous.push({
        input,
        candidates: r.candidates.map((id) => {
          const p = ds.players.find((x) => x.id === id);
          return p ? { playerId: id, nome: p.nome, squadra: p.squadra, ruolo: p.ruolo } : { playerId: id };
        }),
      });
    } else {
      report.unresolved.push({ input });
    }
  }

  if (strict && (report.ambiguous.length > 0 || report.unresolved.length > 0)) {
    report.blocked = true;
  }

  return report;
}

/**
 * Funzione di utilità per l'ingestione: usata dai futuri adapter Excel.
 * Se il report è bloccato, lancia con un messaggio leggibile che dice esattamente cosa aggiungere agli alias.
 */
export function assertResolvable(inputs) {
  const r = resolveBatch(inputs, { strict: true });
  if (!r.blocked) return r;
  const lines = [];
  if (r.ambiguous.length > 0) {
    lines.push(`❌ ${r.ambiguous.length} NOMI AMBIGUI (bloccano l'ingestione):`);
    for (const a of r.ambiguous.slice(0, 20)) {
      const opts = a.candidates.map((c) => `${c.nome} (${c.squadra}, ${c.ruolo})`).join('  |  ');
      lines.push(`   • "${a.input.name}" [${a.input.squadra || '?'}/${a.input.ruolo || '?'}]  → candidati: ${opts}`);
    }
    lines.push('   → aggiungi un alias esplicito in data/aliases.json per ogni nome ambiguo.');
  }
  if (r.unresolved.length > 0) {
    lines.push(`❌ ${r.unresolved.length} NOMI NON RISOLTI:`);
    for (const u of r.unresolved.slice(0, 20)) {
      lines.push(`   • "${u.input.name}" [${u.input.squadra || '?'}/${u.input.ruolo || '?'}]`);
    }
  }
  const err = new Error('Ingestione bloccata dal resolver.\n\n' + lines.join('\n'));
  err.report = r;
  throw err;
}

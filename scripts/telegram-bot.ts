#!/usr/bin/env node
// Bot Telegram Coach Beard
// Long polling: npx tsx scripts/telegram-bot.ts
//
// REGISTRAZIONE ACQUISTI con comando libero:
//   "Maignan a Federico 100"     → acquista Maignan per Federico a 100 crediti
//   "compra Maignan Federico 100" → acquista Maignan per Federico a 100 crediti
//
// QUERY:
//   "stato"                     → riepilogo crediti/rose
//   "budget"                    → i tuoi crediti e tetto
//   "chi è Maignan"            → profilo calciatore
//   "rosa Federico"             → rosa di Federico
//   "prossime"                 → prossime chiamate consigliate
//
// PAIRING:
//   Al primo avvio senza pairing, il bot mostra un codice da 6 cifre.
//   Scrivi "pairing ABC123" + il codice segreto (nel tuo .env.local) per autorizzarti.
//   Una volta paired, solo il tuo chat_id può comunicare col bot.

import Database from 'better-sqlite3';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ── Caricamento env ──────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env.local');
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m) {
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
        v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  }
}

// ── Config ────────────────────────────────────────────────────────────
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const PAIRING_SECRET = process.env.TELEGRAM_PAIRING_SECRET ?? '';
const DB_PATH = join(__dirname, '..', 'data', 'coach-beard.db');
const ROOT = join(__dirname, '..');
const DATASET_PATH = join(__dirname, '..', 'data', 'dataset.json');

if (!BOT_TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN mancante in .env.local');
  console.error('   Aggiungi: TELEGRAM_BOT_TOKEN=123456789:ABCdef...');
  process.exit(1);
}

// ── Dataset e DB ─────────────────────────────────────────────────────
function loadDataset() {
  if (!existsSync(DATASET_PATH))
    throw new Error('dataset.json non trovato. Esegui: npm run build:dataset');
  return JSON.parse(readFileSync(DATASET_PATH, 'utf-8'));
}

function getDb() {
  // Cerca il DB in entrambe le posizioni possibili
  const candidates = [
    join(__dirname, '..', 'data', 'coach-beard.db'),
    join(__dirname, '..', 'coach-beard.db'),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return new Database(p);
  }
  throw new Error(`coach-beard.db non trovato in:\n  - ${candidates.join('\n  - ')}\nAvvia l'app almeno una volta (npm run dev).`);
}

// ── Resolver locale (stessa logica di resolver.mjs) ──────────────────
function resolvePlayer(ds: any, name: string) {
  const q = name.toLowerCase().trim();
  const aliases: Record<string, number> = {
    'maignan': 4995, 'svilar': 4991, 'vicario': 4964, 'gregorio': 2628,
    'lautaro martinez': 2764, 'martinez l.': 2764, 'martinez l': 2764,
    'calhanoglu': 2666, 'paz n.': 6875, 'paz n': 6875, 'nico paz': 6875,
    'mbay': 6891, 'malen': 2758, 'dimarco': 2541, 'bastoni': 2538,
    'tomori': 2540, 'thiaw': 2632, 'gabbia': 2542, 'buongiorno': 2627,
    'isak': 4989, 'lw': 2734, 'dybala': 2720, 'vlahovic': 2731,
  };
  if (aliases[q]) {
    const p = ds.players.find((x: any) => x.id === aliases[q]);
    if (p) return p;
  }
  // Fuzzy: cerca per cognome normalizzato
  const words = q.split(' ').filter(Boolean);
  const cognome = words[words.length - 1] ?? q;
  const candidates = ds.players.filter((p: any) => {
    const pn = p.nome.toLowerCase();
    return pn.includes(cognome) || cognome.includes(pn.split(' ').pop() ?? '');
  });
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    // Prendi il miglior match: nome + cognome
    const best = candidates.find((p: any) => {
      const pn = p.nome.toLowerCase();
      return pn.includes(q) || q.includes(pn);
    });
    return best ?? candidates[0];
  }
  return null;
}

// ── Replay efficace (copia minimale di events.ts) ─────────────────────
function replayEffective(db: Database.Database, ds: any) {
  type Event = { sequenceId: number; type: string; ts: string; payload_json: string; compensated_seq: number | null };
  const rows = db.prepare(
    'SELECT sequence_id, type, ts, payload_json, compensated_seq FROM auction_events ORDER BY sequence_id ASC'
  ).all() as Event[];
  const events = rows.map((r) => ({ ...r, payload: JSON.parse(r.payload_json) }));

  const compensated = new Set<number>();
  for (const e of events) {
    if (e.type === 'COMPENSATE' && e.compensated_seq != null) compensated.add(e.compensated_seq);
  }
  const effective = events.filter((e) => e.type === 'COMPENSATE' || !compensated.has(e.sequenceId));

  // Carica i nomi dei manager dal DB
  const dbManagerRows = db.prepare('SELECT id, name, is_owner FROM managers').all() as Array<{ id: number; name: string; is_owner: number }>;
  const managers = Array.from({ length: 8 }, (_, i) => {
    const dbRow = dbManagerRows.find((r) => r.id === i + 1);
    return {
      id: i + 1, name: dbRow?.name ?? '', isOwner: i === 0, initialCredits: 500,
      spent: 0, credits: 500, byRole: { P: 0, D: 0, C: 0, A: 0 }, players: [] as any[],
    };
  });
  const playerStatus: Record<string, string> = {};
  const playerOwner: Record<string, number> = {};
  let state = 'DRAFT', phase = 'P';

  for (const e of effective) {
    if (e.type === 'START') { state = 'LIVE'; }
    else if (e.type === 'PURCHASE') {
      const { playerId, managerId, price } = e.payload;
      const p = ds.players.find((x: any) => x.id === playerId);
      const m = managers.find((x) => x.id === managerId);
      if (p && m) {
        m.spent += price; m.credits -= price;
        m.players.push({ playerId, name: p.nome, ruolo: p.ruolo, prezzo: price });
        m.byRole[p.ruolo] = (m.byRole[p.ruolo] || 0) + 1;
        playerStatus[playerId] = 'sold';
        playerOwner[playerId] = managerId;
      }
    } else if (e.type === 'UNSOLD') {
      const { playerId } = e.payload;
      playerStatus[playerId] = 'unsold';
    }
  }
  return { state, phase, managers, playerStatus, playerOwner };
}

// ── Parsing comandi di acquisto ──────────────────────────────────────
// "Maignan a Federico 100"  → { player: "Maignan", buyer: "Federico", price: 100 }
// "compra Maignan per Federico 100" → { player: "Maignan", buyer: "Federico", price: 100 }
function parsePurchaseCmd(text: string) {
  const t = text.trim();

  // Pattern 1: "Giocatore a Manager Prezzo"  (es. "Maignan a Federico 100")
  let m = t.match(/^(.+?)\s+a\s+(\S+)\s+(\d+)\s*$/i);
  if (m) return { player: m[1].trim(), buyer: m[2].trim(), price: parseInt(m[3]) };

  // Pattern 2: "compra Giocatore per Manager Prezzo"
  m = t.match(/^compra?\s+(.+?)\s+(?:per|a)\s+(\S+)\s+(\d+)\s*$/i);
  if (m) return { player: m[1].trim(), buyer: m[2].trim(), price: parseInt(m[3]) };

  // Pattern 3: "Giocatore → Manager Prezzo"
  m = t.match(/^(.+?)\s*[→\->]\s*(\S+)\s+(\d+)\s*$/i);
  if (m) return { player: m[1].trim(), buyer: m[2].trim(), price: parseInt(m[3]) };

  return null;
}

// ── Nome manager → id ────────────────────────────────────────────────
function resolveManager(name: string, managers: any[]): number | null {
  const q = name.toLowerCase().trim();
  const m = managers.find((m) => m.name.toLowerCase().includes(q) || m.name === q);
  if (m) return m.id;
  // Cerca per ruolo parziale
  const byId: Record<number, string> = { 1: 'elia', 2: 'condor', 3: 'lucio', 4: 'lensi', 5: 'renzo', 6: 'galga', 7: 'tella', 8: 'nica' };
  for (const [id, n] of Object.entries(byId)) {
    if (n.includes(q) || q.includes(n)) return parseInt(id);
  }
  return null;
}

// ── Formattazione risposte Telegram ──────────────────────────────────
function fmtCredits(m: any) {
  const empty = 25 - m.players.length;
  const ceiling = Math.max(0, m.credits - empty);
  return `${m.name}: ${m.credits}cr (${m.spent} spesi) | rosa ${m.players.length}/25 | tetto ${ceiling}`;
}

function fmtBudget(ds: any, db: Database.Database) {
  const snap = replayEffective(db, ds);
  const m = snap.managers.find((x) => x.isOwner)!;
  const empty = 25 - m.players.length;
  const ceiling = Math.max(0, m.credits - empty);
  const players = m.players.map((p: any) => `${p.name} (${p.ruolo}) ${p.prezzo}cr`).join(', ') || 'nessuno';
  return `Coach Beard — Budget\n` +
    `Crediti residui: ${m.credits}\n` +
    `Già spesi: ${m.spent}\n` +
    `Rosa: ${m.players.length}/25\n` +
    `Tetto per prossimo acquisto: ${ceiling}\n` +
    `  (formula: ${m.credits} - ${empty} slot = ${ceiling})\n` +
    `Acquisti:\n${players}`;
}

function fmtPlayer(ds: any, playerName: string) {
  const p = resolvePlayer(ds, playerName);
  if (!p) return `⚠️ Non trovo "${playerName}" nel listone. Prova con nome + cognome esatti.`;
  const notes = p.noteGuida ? `\n📝 ${p.noteGuida}` : '';
  return `⚽ ${p.nome} — ${p.squadra} (${p.ruolo})\n` +
    `Quotazione: ${p.quotAttuale}\n` +
    `Fascia: ${p.fascia ?? '?'}\n` +
    `Prezzo guida: ${p.prezzoGuida ?? '?'}\n` +
    `Titolare: ${p.titolarita ?? '?'}\n` +
    `${p.ballottaggio ? '⚠️ Ballottaggio\n' : ''}` +
    `${p.pupillo ? '⭐ Pupillo\n' : ''}` +
    `${p.valorizzato ? '📈 Valorizzato\n' : ''}` +
    `${p.penalizzato ? '📉 Penalizzato\n' : ''}` +
    `${notes}`;
}

function fmtState(ds: any, db: Database.Database) {
  const snap = replayEffective(db, ds);
  const lines = snap.managers.map(fmtCredits);
  const freePlayers = ds.players.filter((p: any) => !snap.playerStatus[p.id]).length;
  return `🏟️ Asta — ${snap.state} | Reparto ${snap.phase}\n` +
    `Calciatori liberi: ${freePlayers}\n\n` +
    lines.join('\n');
}

function fmtRoster(ds: any, db: Database.Database, managerName: string) {
  const snap = replayEffective(db, ds);
  const m = snap.managers.find((x) => x.name.toLowerCase().includes(managerName.toLowerCase()));
  if (!m) return `⚠️ Non trovo "${managerName}". Prova: Elia, Condor, Lucio, Lensi, Renzo, Galga, Tella, Nica.`;
  const byRole: Record<string, string[]> = { P: [], D: [], C: [], A: [] };
  for (const p of m.players) byRole[p.ruolo].push(`${p.name} (${p.prezzo})`);
  const empty = 25 - m.players.length;
  const ceiling = Math.max(0, m.credits - empty);
  return `👥 ${m.name} — ${m.credits}cr | ${m.players.length}/25\n` +
    `P (${m.byRole.P}/3): ${byRole.P.join(', ') || '-'}\n` +
    `D (${m.byRole.D}/8): ${byRole.D.join(', ') || '-'}\n` +
    `C (${m.byRole.C}/8): ${byRole.C.join(', ') || '-'}\n` +
    `A (${m.byRole.A}/6): ${byRole.A.join(', ') || '-'}\n` +
    `Tetto: ${ceiling}`;
}

function fmtNext(ds: any, db: Database.Database) {
  const snap = replayEffective(db, ds);
  const candidates = ds.players
    .filter((p: any) => !snap.playerStatus[p.id] && p.quotAttuale && p.quotAttuale > 0)
    .sort((a: any, b: any) => {
      if (b.pupillo !== a.pupillo) return b.pupillo ? 1 : -1;
      return (b.quotAttuale ?? 0) - (a.quotAttuale ?? 0);
    })
    .slice(0, 5);
  if (candidates.length === 0) return '📭 Nessun calciatore libero con quotazione > 0.';
  return `📋 Prossime chiamate:\n` +
    candidates.map((p: any, i: number) =>
      `${i + 1}) ${p.nome} (${p.squadra}) — quot ${p.quotAttuale} ${p.pupillo ? '⭐' : ''}`
    ).join('\n');
}

// ── Registro acquisto ─────────────────────────────────────────────────
function registerPurchase(ds: any, db: Database.Database, playerName: string, buyerName: string, price: number): string {
  const player = resolvePlayer(ds, playerName);
  if (!player) return `⚠️ Non trovo "${playerName}". Prova con nome completo.`;

  const snap = replayEffective(db, ds);
  if (snap.playerStatus[player.id] === 'sold') {
    const owner = snap.managers.find((m) => m.id === snap.playerOwner[player.id])?.name ?? '?';
    return `⚠️ ${player.nome} è già stato acquistato da ${owner}.`;
  }
  if (snap.playerStatus[player.id] === 'unsold') {
    return `⚠️ ${player.nome} è stato dichiarato invenduto.`;
  }

  const managerId = resolveManager(buyerName, snap.managers);
  if (!managerId) {
    return `⚠️ Non trovo "${buyerName}". Prova: Elia, Condor, Lucio, Lensi, Renzo, Galga, Tella, Nica.`;
  }

  const m = snap.managers.find((x: any) => x.id === managerId)!;
  const empty = 25 - m.players.length;
  const ceiling = m.credits - empty;

  if (price <= 0) return `⚠️ Il prezzo deve essere > 0.`;
  if (price > ceiling) return `⚠️ ${m.name} ha tetto ${ceiling} (${m.credits} crediti - ${empty} slot). Non può spendere ${price}.`;
  if (m.byRole[player.ruolo] >= (player.ruolo === 'P' ? 3 : player.ruolo === 'D' ? 8 : player.ruolo === 'C' ? 8 : 6)) {
    return `⚠️ ${m.name} ha già lo slot ${player.ruolo} pieno.`;
  }

  // Scrive nel DB direttamente (è già tutto validato sopra)
  const ts = new Date().toISOString();
  const idempotencyKey = `tg-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  try {
    db.prepare(`
      INSERT INTO auction_events (type, ts, idempotency_key, payload_json, compensated_seq)
      VALUES (?, ?, ?, ?, NULL)
    `).run('PURCHASE', ts, idempotencyKey, JSON.stringify({ playerId: player.id, managerId, price }));

    return `✅ ACQUISTATO\n${player.nome} → ${m.name}\nPrezzo: ${price} crediti\nRestanti ${m.credits - price} crediti`;
  } catch (err: any) {
    return `❌ Errore: ${err.message}`;
  }
}

// ── Help ─────────────────────────────────────────────────────────────
const HELP = `Coach Beard 🤖

COMANDI DI ACQUISTO:
  Maignan a Elia 100
  compra Maignan per Elia 100
  Maignan → Elia 100

QUERIES:
  stato       — riepilogo completo
  budget      — i tuoi crediti e tetto
  chi è [nome] — profilo calciatore
  rosa [nome] — rosa di un partecipante
  prossime    — top 5 chiamate libere
  ai [domanda] — chiedi a Coach Beard (se key API attiva)`;

// ── API Telegram ─────────────────────────────────────────────────────
const BASE = `https://api.telegram.org/bot${BOT_TOKEN}`;
let offset = 0;
let pairedChatId: string | null = null;
let pairingMode = false;
let pendingCode: string | null = null;

// Carica pairing salvato
const pairingFile = join(__dirname, '..', 'data', 'telegram-pairing.json');
if (existsSync(pairingFile)) {
  try { pairedChatId = JSON.parse(readFileSync(pairingFile, 'utf-8')).chatId ?? null; }
  catch {}
}

async function api(method: string, params: Record<string, any> = {}) {
  const res = await fetch(`${BASE}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`${method} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function sendMessage(chatId: string, text: string) {
  // Telegram tronca a 4096
  if (text.length > 4000) text = text.slice(0, 3997) + '...';
  await api('sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown' });
}

async function loop() {
  console.log('🤖 Coach Beard Telegram Bot avviato');
  console.log(`   Pairing secret: ${PAIRING_SECRET ? '✓ impostato' : '✗ non impostato'}`);
  console.log(`   Paired chat_id: ${pairedChatId ?? 'nessuno (pairing richiesto)'}`);
  console.log('   Long polling in corso...\n');

  while (true) {
    try {
      const updates = await api('getUpdates', { offset, timeout: 30 });
      for (const u of (updates.result ?? []) as any[]) {
        offset = u.update_id + 1;
        const msg = u.message ?? u.edited_message;
        if (!msg || !msg.text) continue;
        const chatId = String(msg.chat.id);
        const text = msg.text.trim();

        // ── Gestione pairing ──
        if (!pairedChatId) {
          const msg = text.replace(/^\/\w+\s*/, ''); // toglie /pairing o /start
          if (msg.toLowerCase().startsWith('pairing ')) {
            const code = msg.split(' ')[1]?.toUpperCase();
            if (code === PAIRING_SECRET.toUpperCase() && PAIRING_SECRET) {
              pairedChatId = chatId;
              require('fs').writeFileSync(pairingFile, JSON.stringify({ chatId, ts: new Date().toISOString() }));
              await sendMessage(chatId, '✅ *Pairing effettuato!* Sei autorizzato.\n' + HELP);
            } else {
              await sendMessage(chatId, '❌ Codice pairing errato.');
            }
            continue;
          }
          // Altrimenti chiede pairing
          await sendMessage(chatId, `🔐 Per autorizzarti, scrivi:\n/pairing [codice segreto]\n\n(Lo trovi in .env.local: TELEGRAM_PAIRING_SECRET)`);
          continue;
        }

        // ── Solo paired chat può parlare ──
        if (chatId !== pairedChatId) {
          console.log(`[WARN] Messaggio da chat non autorizzata: ${chatId}`);
          continue;
        }

        // ── Routing comandi ──
        console.log(`[${new Date().toISOString()}] ${chatId}: ${text}`);
        const ds = loadDataset();
        const db = getDb();

        const lower = text.toLowerCase();

        if (lower === '/start' || lower === '/help' || lower === 'help') {
          await sendMessage(chatId, HELP);
        }
        else if (lower === 'stato') {
          await sendMessage(chatId, fmtState(ds, db));
        }
        else if (lower === 'budget') {
          await sendMessage(chatId, fmtBudget(ds, db));
        }
        else if (lower === 'prossime') {
          await sendMessage(chatId, fmtNext(ds, db));
        }
        else if (lower.startsWith('chi è ') || lower.startsWith('chi è')) {
          const name = text.replace(/^chi[\s\W]+/i, '').trim();
          await sendMessage(chatId, fmtPlayer(ds, name));
        }
        else if (lower.startsWith('rosa ')) {
          const name = text.slice(5).trim();
          await sendMessage(chatId, fmtRoster(ds, db, name));
        }
        else if (lower.startsWith('ai ') || lower.startsWith('?')) {
          const q = text.replace(/^(ai|\?)\s*/i, '').trim();
          await sendMessage(chatId, `[Modalità deterministica]\nIl bot Telegram non usa l'LLM per rispondere alle query.\nUsa i comandi: stato, budget, chi è [nome], rosa [nome], prossime.\n\nPer l'AI completo usa la chat web su localhost.`);
        }
        else {
          // Prova a interpretare come acquisto
          const purchase = parsePurchaseCmd(text);
          if (purchase) {
            const result = registerPurchase(ds, db, purchase.player, purchase.buyer, purchase.price);
            await sendMessage(chatId, result);
          } else {
            await sendMessage(chatId, `🤔 Non ho capito.\nProva:\n• "stato"\n• "budget"\n• "chi è Maignan"\n• "Maignan a Elia 100"\n• "help"`);
          }
        }
      }
    } catch (err: any) {
      console.error('[ERRORE]', err.message);
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

loop().catch(console.error);

# Deploy Coach Beard su Vercel

## Panoramica

Coach Beard è un'app Next.js che funziona sia **in locale con SQLite** (filesystem) sia **in produzione su Vercel con Postgres** (database gestito). Lo switch è automatico e dipende da una sola variabile d'ambiente.

---

## Architettura

```
Locale (senza DATABASE_URL)          Produzione (Vercel)
─────────────────────────           ─────────────────────
better-sqlite3                      pg (Postgres/Neon)
  ./coach-beard.db  ← file locale    DATABASE_URL → Neon
                                                             
npm run dev                        Deploy Vercel
npm run ingest                     npm run ingest (locale → Neon)
```

**Come funziona**: il file `src/lib/db-factory.ts` controlla se `DATABASE_URL` è impostata. Se sì, usa l'adapter Postgres. Altrimenti usa l'adapter SQLite locale. Il resto del codice non sa quale backend sta usando.

---

## Variabili d'ambiente

| Variabile | Quando serve | Esempio | Note |
|-----------|-------------|---------|------|
| `DATABASE_URL` | Solo su Vercel (locale: opzionale) | `postgres://user:pass@ep-xxx.us-east-2.aws.neon.tech/fantacalcio?sslmode=require` | Se assente → SQLite locale |
| `TELEGRAM_BOT_TOKEN` | Solo bot locale | `123456789:ABCdef...` | Mai su Vercel |
| `TELEGRAM_PAIRING_SECRET` | Solo bot locale | `ABC123` | Mai su Vercel |

---

## Setup Neon (database Postgres)

1. Vai su [neon.tech](https://neon.tech) → **Sign up** (free tier)
2. Crea un progetto **"fantacalcio"** → scegli region (es. Frankfurt / eu-central-1)
3. Dalla dashboard → **Connection Details** → copia la stringa che inizia con `postgres://`
4. La stringa completa è la tua `DATABASE_URL`

---

## Step per il deploy

### 1. Setup Neon

Copia la `DATABASE_URL` da Neon. Aggiungila in locale temporaneamente per test:

```bash
# In .env.local (NON committare!)
DATABASE_URL=postgres://user:pass@ep-xxx.us-east-2.aws.neon.tech/fantacalcio?sslmode=require
```

### 2. Installa dipendenze e popola Neon

```bash
# Installa pg (aggiunto a package.json)
npm install

# Crea tabelle + seed su Neon
npm run ingest

# Risultato atteso:
# ✅ Ingest completato!
#    managers: 8
#    config: 7
#    events: 0
```

Se hai un'asta locale in corso e vuoi migrare tutto:

```bash
npm run ingest -- --from-sqlite
# oppure con percorso esplicito:
npm run ingest -- --from-sqlite ./coach-beard.db
```

### 3. Committa e pusha su GitHub

```bash
git add .
git status
# Verifica che NON siano in lista:
#   - .env.local
#   - *.db, *.db-shm, *.db-wal
#   - Dati/
#   - data/telegram-pairing.json
git commit -m "feat: dual-mode DB (SQLite/Postgres) + Vercel ready"
git push
```

### 4. Configura Vercel

1. Vai su [vercel.com](https://vercel.com) → il tuo progetto → **Settings** → **Environment Variables**
2. Aggiungi `DATABASE_URL` con il valore di Neon
3. **Non** aggiungere `TELEGRAM_BOT_TOKEN` su Vercel (il bot resta locale)
4. Salva → Vercel ricostruisce automaticamente

### 5. Verifica il deploy

```bash
# Verifica che il DB sia Postgres
curl https://<your-app>.vercel.app/api/health
# Risposta: { "ok": true, "dbType": "postgres", "dbReady": true }

# Verifica persistenza: registra un acquisto → ricarica
curl -X POST https://<your-app>.vercel.app/api/auction/purchase \
  -H "Content-Type: application/json" \
  -d '{"playerId": 4995, "managerId": 1, "price": 10}'
```

Su Neon dashboard → **SQL Editor** → esegui:
```sql
SELECT count(*) FROM auction_events;
```
Dovrebbe mostrare il numero di eventi registrati.

---

## Bot Telegram (solo locale)

Il bot usa **long polling** (loop infinito) che è incompatibile con le serverless functions di Vercel (timeout 10-60s).

**Soluzione**: il bot resta esclusivamente locale. Nella sessione locale:

```bash
# In una nuova finestra terminale
npm run bot:telegram

# Output atteso:
# 🤖 Coach Beard Telegram Bot avviato
#    Pairing secret: ✓ impostato
```

Il bot usa `coach-beard.db` locale (SQLite). Non tocca mai il Postgres remoto.

**In futuro** (out of scope): se vuoi il bot su Vercel, convertilo a **webhook Telegram** invece di long polling. I webhook funzionano con serverless functions.

---

## Dati e file da committare

| Cartella/File | Committare? | Motivo |
|---|---|---|
| `data/dataset.json` | ✅ Sì | Output pre-calcolato, necessario al bundle Vercel |
| `data/abbinamenti.json` | ✅ Sì | Output pre-calcolato, necessario al bundle Vercel |
| `Dati/` | ❌ No | Excel sorgente, mai su GitHub |
| `*.db`, `*.db-shm`, `*.db-wal` | ❌ No | Database SQLite locale |
| `.env.local` | ❌ No | Contiene secrets (mai committare) |
| `data/telegram-pairing.json` | ❌ No | Dati pairing locali |

---

## Test locale (rollback SQLite)

```bash
# Rimuovi temporaneamente DATABASE_URL
# (Windows PowerShell)
Remove-Item env:DATABASE_URL
# oppure in bash:
# unset DATABASE_URL

# Elimina il DB vecchio per testare la ricreazione
Remove-Item ./coach-beard.db, ./coach-beard.db-*

# Avvia l'app
npm run dev

# Verifica che sia SQLite
# → /api/health risponde { "dbType": "sqlite" }
```

---

## Struttura file DB (per riferimento)

### Adapter pattern

```
src/lib/
  db-factory.ts     # getDb() — switch SQLite/Postgres
  db-sqlite.ts      # Adapter SQLite (better-sqlite3)
  db-postgres.ts    # Adapter Postgres (pg Pool)
  events.ts         # Logica event-sourcing (async)
  db.ts             # Re-export per compatibilità
```

### Schema Postgres (creato automaticamente da `ingest`)

```sql
CREATE TABLE managers (
  id        BIGINT PRIMARY KEY,
  name      TEXT NOT NULL DEFAULT '',
  is_owner  BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE league_config (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE auction_events (
  sequence_id      BIGSERIAL PRIMARY KEY,
  type             TEXT NOT NULL,
  ts               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idempotency_key  TEXT,
  payload_json     TEXT NOT NULL,
  compensated_seq  BIGINT REFERENCES auction_events(sequence_id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX uniq_idem ON auction_events(idempotency_key)
  WHERE idempotency_key IS NOT NULL;
```

---

## Troubleshooting

### `❌ Errore: connect ETIMEDOUT` su Neon
- Verifica che `?sslmode=require` sia nella URL
- Prova con `neon.tech` dashboard → SQL Editor per testare la connessione

### `/api/health` dice ancora `sqlite` dopo deploy
- La env var `DATABASE_URL` non è stata impostata in Vercel dashboard
- Verifica Settings → Environment Variables

### `npm run ingest` fallisce con "already exists"
- Normale per Postgres: `CREATE TABLE IF NOT EXISTS` è idempotente
- È un warning, non un errore

### Bot Telegram non risponde
- Il bot gira SOLO in locale, non su Vercel
- Verifica che `TELEGRAM_BOT_TOKEN` sia in `.env.local` (non su Vercel)

---

## Perché non ho messo tutto su Vercel Postgres?

- **Dataset**: letto da filesystem (`data/dataset.json`). Su Vercel i file vengono bundlati a build time, quindi funziona. Non servono modifiche.
- **Excel sorgenti** (`Dati/`): non servono su Vercel — il dataset.json è già l'output pre-calcolato.
- **Ingestione**: serve solo per popolare il DB remoto la prima volta. Può essere fatta dal PC locale.

"use client";

import { useEffect, useState, useRef, useCallback } from "react";

// ─── Tipi ─────────────────────────────────────────────────────────────────────

type Phase = "P" | "D" | "C" | "A";
type AuctionState = "DRAFT" | "READY" | "LIVE" | "PAUSED" | "COMPLETED";

type Player = {
  id: number;
  nome: string;
  nomeNormalizzato: string;
  squadra: string;
  ruolo: "P" | "D" | "C" | "A";
  quotAttuale: number | null;
  prezzoGuida: number | null;
  fascia: string | null;
  pupillo: boolean;
};

type PurchaseRecord = {
  playerId: number;
  name: string;
  ruolo: string;
  squadra: string;
  prezzo: number;
};

type Manager = {
  id: number;
  name: string;
  isOwner: boolean;
  credits: number;
  spent: number;
  byRole: { P: number; D: number; C: number; A: number };
  playerCount: number;
  players: PurchaseRecord[];
};

type AuctionSnapshot = {
  state: AuctionState;
  phase: Phase;
  managers: Manager[];
  playerStatus: Record<string, string>;
};

type AgentMessage = {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
};

// ─── Costanti UI ─────────────────────────────────────────────────────────────

const ROSTER_RULES = { P: 3, D: 8, C: 8, A: 6 } as const;
const TOTAL_SLOTS = 25;
const ROLES = (["P", "D", "C", "A"] as const);
const ROLE_LABELS: Record<string, string> = { P: "Portieri", D: "Difensori", C: "Centrocampisti", A: "Attaccanti" };
const PHASE_COLORS: Record<string, string> = {
  P: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  D: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  C: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  A: "bg-rose-500/20 text-rose-300 border-rose-500/40",
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function fmtCredits(n: number) {
  return n.toLocaleString("it-IT");
}

// ─── Componente principale ────────────────────────────────────────────────────

// ─── Utilità normalizzazione nome ────────────────────────────────────────────
function norm(s: string): string {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[''`´]/g, "'").toLowerCase()
    .replace(/\s+/g, ' ').trim();
}

export default function AstaPage() {
  // ── Stato auction ──────────────────────────────────────────────────────
  const [snapshot, setSnapshot] = useState<AuctionSnapshot | null>(null);
  const [loadingAuction, setLoadingAuction] = useState(true);

  // ── Selezione manager attivo ───────────────────────────────────────────
  const [activeManager, setActiveManager] = useState<number>(1);

  // ── Ricerca giocatore ─────────────────────────────────────────────────
  const [query, setQuery] = useState("");
  const [dataset, setDataset] = useState<{ players: Player[] } | null>(null);
  const [filteredPlayers, setFilteredPlayers] = useState<Player[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [buyPrice, setBuyPrice] = useState<string>("");
  // Profilo dettagliato del giocatore (per statistiche + tetto)
  const [playerProfile, setPlayerProfile] = useState<any | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  // ── Chat ───────────────────────────────────────────────────────────────
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── Errori / feedback ─────────────────────────────────────────────────
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [auctionStarted, setAuctionStarted] = useState(false);

  // ── Abbinamenti ──────────────────────────────────────────────────────
  const [abbinamenti, setAbbinamenti] = useState<Record<string, any> | null>(null);
  const [showAbbinamenti, setShowAbbinamenti] = useState(false);

  const loadAbbinamenti = useCallback(async () => {
    try {
      const res = await fetch("/api/auction/abbinamenti", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      if (json.ok) setAbbinamenti(json.byRole);
    } catch {}
  }, []);

  // ── Carica profilo dettagliato del giocatore (per tetto rilancio) ───
  const loadPlayerProfile = useCallback(async (playerId: number) => {
    setProfileLoading(true);
    try {
      const res = await fetch(`/api/giocatori/detail?id=${playerId}`, { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json();
      if (json.ok) setPlayerProfile(json);
    } catch (err) {
      console.error("Errore caricamento profilo:", err);
    } finally {
      setProfileLoading(false);
    }
  }, []);

  // ─── Load auction state ──────────────────────────────────────────────────
  async function loadAuction() {
    try {
      const res = await fetch("/api/auction/state", { cache: "no-store" });
      if (!res.ok) throw new Error("API error " + res.status);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      setSnapshot(json as unknown as AuctionSnapshot);
      if (json.state === "LIVE" || json.state === "PAUSED") setAuctionStarted(true);
    } catch (err: any) {
      showFeedback(false, "Errore caricamento asta: " + err.message);
    } finally {
      setLoadingAuction(false);
    }
  }

  // ─── Load dataset ────────────────────────────────────────────────────────
  async function loadDataset() {
    try {
      const res = await fetch("/api/dataset", { cache: "no-store" });
      if (!res.ok) throw new Error("API error " + res.status);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      const players: Player[] = (json.players || []).map((p: any) => ({
        id: p.id,
        nome: p.nome,
        nomeNormalizzato: norm(p.nome),
        squadra: p.squadra,
        ruolo: p.ruolo,
        quotAttuale: p.quotAttuale,
        prezzoGuida: p.prezzoGuida,
        fascia: p.fascia,
        pupillo: p.pupillo ?? false,
      }));
      setDataset({ players });
    } catch (err: any) {
      showFeedback(false, "Errore dataset: " + err.message);
    }
  }

  useEffect(() => {
    loadAuction();
    loadDataset();
    loadAbbinamenti();
    const interval = setInterval(loadAuction, 5000);
    return () => clearInterval(interval);
  }, [loadAbbinamenti]);

  // ─── Search filtering ────────────────────────────────────────────────────
  useEffect(() => {
    if (!dataset || !query.trim()) {
      setFilteredPlayers([]);
      return;
    }
    const q = norm(query);
    const hits = dataset.players
      .filter((p) => {
        if (q.length < 2) return false;
        const team = norm(p.squadra);
        return (
          p.nomeNormalizzato.includes(q) ||
          team.includes(q) ||
          String(p.id).startsWith(q)
        );
      })
      .filter((p) => snapshot ? snapshot.playerStatus[String(p.id)] !== "sold" : true)
      .sort((a, b) => {
        // Priorità: cognome inizia con query > cognome contiene > altro
        const an = a.nomeNormalizzato.split(" ").pop() ?? "";
        const bn = b.nomeNormalizzato.split(" ").pop() ?? "";
        const aq = an.startsWith(q) ? 0 : 1;
        const bq = bn.startsWith(q) ? 0 : 1;
        if (aq !== bq) return aq - bq;
        return (b.quotAttuale ?? 0) - (a.quotAttuale ?? 0);
      })
      .slice(0, 20);
    setFilteredPlayers(hits);
  }, [query, dataset, snapshot]);

  // ─── Chat scroll ─────────────────────────────────────────────────────────
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ─── Helpers ────────────────────────────────────────────────────────────────
  const showFeedback = (ok: boolean, text: string) => {
    setFeedback({ ok, text });
    setTimeout(() => setFeedback(null), 4000);
  };

  const currentManager = snapshot?.managers.find((m) => m.id === activeManager);

  const slotLeft = (mgr: Manager, role: string) => {
    const max = ROSTER_RULES[role as keyof typeof ROSTER_RULES];
    const br = (mgr.byRole ?? { P: 0, D: 0, C: 0, A: 0 }) as Record<string, number>;
    return max - (br[role] ?? 0);
  };

  const maxBid = (mgr: Manager) => {
    const empty = TOTAL_SLOTS - (mgr.playerCount ?? 0);
    return Math.max(0, (mgr.credits ?? 0) - empty);
  };

  // ─── Start auction ────────────────────────────────────────────────────────
  async function handleStart() {
    setLoadingAuction(true);
    try {
      const res = await fetch("/api/auction/start", { method: "POST" });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      setAuctionStarted(true);
      showFeedback(true, "✅ Asta avviata!");
      await loadAuction();
    } catch (err: any) {
      showFeedback(false, "Errore: " + err.message);
    } finally {
      setLoadingAuction(false);
    }
  }

  // ─── Buy ─────────────────────────────────────────────────────────────────
  async function handleBuy() {
    if (!selectedPlayer || !currentManager || !buyPrice) return;
    const price = parseInt(buyPrice);
    if (isNaN(price) || price <= 0) {
      showFeedback(false, "Inserisci un prezzo valido (> 0)");
      return;
    }
    if (price > maxBid(currentManager)) {
      showFeedback(false, `Tetto massimo: ${maxBid(currentManager)} crediti`);
      return;
    }
    const mgr = currentManager;
    if (slotLeft(mgr, selectedPlayer.ruolo) <= 0) {
      showFeedback(false, `Slot ${selectedPlayer.ruolo} pieno per ${mgr.name}`);
      return;
    }

    try {
      const res = await fetch("/api/auction/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playerId: selectedPlayer.id,
          managerId: mgr.id,
          price,
          idempotencyKey: `web-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        }),
      });
      const json = await res.json();
      if (!json.ok) {
        const errMsg = Array.isArray(json.errors) ? json.errors[0]?.message : json.error;
        throw new Error(errMsg ?? "Errore acquisto");
      }
      showFeedback(true, `✅ ${selectedPlayer.nome} acquistato da ${mgr.name} per ${price} crediti!`);
      setSelectedPlayer(null);
      setBuyPrice("");
      setQuery("");
      await loadAuction();
    } catch (err: any) {
      showFeedback(false, "❌ " + err.message);
    }
  }

  // ─── Undo last ────────────────────────────────────────────────────────────
  async function handleUndo(seqId: number) {
    try {
      const res = await fetch("/api/auction/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sequenceId: seqId }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      showFeedback(true, `↩️ Ultimo acquisto annullato`);
      await loadAuction();
    } catch (err: any) {
      showFeedback(false, "Errore undo: " + err.message);
    }
  }

  // ─── Chat ────────────────────────────────────────────────────────────────
  async function handleChat(e: React.FormEvent) {
    e.preventDefault();
    const text = chatInput.trim();
    if (!text || chatLoading) return;
    const userMsg: AgentMessage = { role: "user", content: text, timestamp: new Date() };
    setMessages((m) => [...m, userMsg]);
    setChatInput("");
    setChatLoading(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, managerId: activeManager }),
      });
      const json = await res.json();
      const reply = json.message ?? json.error ?? "Nessuna risposta";
      setMessages((m) => [
        ...m,
        { role: "assistant", content: reply, timestamp: new Date() },
      ]);
    } catch (err: any) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "⚠️ Errore: " + err.message, timestamp: new Date() },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="flex h-[calc(100vh-57px)] flex-col lg:flex-row">

      {/* ═══════════════════════════════════════════════════════════════════
          COLONNA SX: Asta
      ═══════════════════════════════════════════════════════════════════ */}
      <div className="flex-1 overflow-y-auto p-4">

        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">🏟️ Asta Live</h1>
            {snapshot && (
              <div className="mt-1 flex items-center gap-3 text-sm text-slate-400">
                <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${snapshot.state === "LIVE" ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-300" : "border-slate-600 bg-slate-800 text-slate-400"}`}>
                  {snapshot.state}
                </span>
                <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${PHASE_COLORS[snapshot.phase]}`}>
                  Fase {ROLE_LABELS[snapshot.phase]}
                </span>
              </div>
            )}
          </div>
          {!auctionStarted && (
            <button
              onClick={handleStart}
              disabled={loadingAuction}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {loadingAuction ? "Avvio…" : "▶ Avvia Asta"}
            </button>
          )}
          <button
            onClick={loadAuction}
            className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-300 hover:bg-slate-700"
          >
            🔄
          </button>
        </div>

        {/* Feedback toast */}
        {feedback && (
          <div className={`mb-3 rounded-lg border px-4 py-3 text-sm ${feedback.ok ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-rose-500/40 bg-rose-500/10 text-rose-200"}`}>
            {feedback.text}
          </div>
        )}

        {/* Manager tabs */}
        {snapshot && (
          <div className="mb-4 flex flex-wrap gap-2">
            {snapshot.managers.map((mgr) => (
              <button
                key={mgr.id}
                onClick={() => setActiveManager(mgr.id)}
                className={`flex flex-col items-center rounded-lg border px-3 py-2 text-xs transition ${
                  activeManager === mgr.id
                    ? mgr.isOwner
                      ? "border-amber-500/60 bg-amber-500/20 text-amber-200"
                      : "border-emerald-500/60 bg-emerald-500/20 text-emerald-200"
                    : "border-slate-700 bg-slate-800/50 text-slate-400 hover:border-slate-600"
                }`}
              >
                <span className="text-base font-semibold">{mgr.name || `M${mgr.id}`}</span>
                <span className="text-xs opacity-70">{mgr.credits ?? 0}cr</span>
              </button>
            ))}
          </div>
        )}

        {/* Rosa manager attivo */}
        {currentManager && (
          <ManagerCard
            manager={currentManager}
            onUndo={handleUndo}
          />
        )}

        {/* ── Pannello acquisto ───────────────────────────────────────── */}
        {auctionStarted && currentManager && (
          <div className="mt-4 rounded-2xl border border-slate-700 bg-slate-800/60 p-4">
            <h2 className="mb-3 text-lg font-semibold text-white">
              💰 Acquista per {currentManager.name || `Manager ${currentManager.id}`}
              <span className="ml-2 text-sm font-normal text-slate-400">
                (tetto: {maxBid(currentManager)} cr)
              </span>
            </h2>

            {/* Ricerca */}
            <input
              type="text"
              placeholder="Cerca giocatore per nome o squadra…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />

            {/* Risultati ricerca */}
            {filteredPlayers.length > 0 && (
              <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900">
                {filteredPlayers.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setSelectedPlayer(p);
                      setQuery(p.nome);
                      setFilteredPlayers([]);
                      setPlayerProfile(null);
                      loadPlayerProfile(p.id);
                    }}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-700"
                  >
                    <div>
                      <span className="mr-2 font-medium text-white">{p.nome}</span>
                      <span className="text-xs text-slate-400">{p.squadra}</span>
                      {p.pupillo && <span className="ml-1 text-xs">⭐</span>}
                    </div>
                    <div className="text-right">
                      <span className="text-xs text-emerald-400">{p.ruolo}</span>
                      <span className="ml-2 font-medium text-white">{p.quotAttuale}</span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Profilo giocatore selezionato con statistiche + tetto */}
            {selectedPlayer && (
              <div className="mt-3 rounded-2xl border border-emerald-500/40 bg-emerald-500/5 p-4">
                {profileLoading ? (
                  <p className="text-sm text-slate-400">Carico statistiche…</p>
                ) : playerProfile ? (
                  <>
                    {/* Header profilo */}
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`text-2xl font-bold ${
                            playerProfile.player.ruolo === "P" ? "text-blue-300" :
                            playerProfile.player.ruolo === "D" ? "text-emerald-300" :
                            playerProfile.player.ruolo === "C" ? "text-amber-300" :
                            "text-rose-300"
                          }`}>
                            {playerProfile.player.ruolo}
                          </span>
                          <h3 className="text-lg font-bold text-white">{playerProfile.player.nome}</h3>
                          {playerProfile.player.pupillo && <span title="Pupillo">⭐</span>}
                          {playerProfile.player.valorizzato && <span className="text-emerald-400" title="Valorizzato">▲</span>}
                          {playerProfile.player.penalizzato && <span className="text-rose-400" title="Penalizzato">▼</span>}
                          {playerProfile.player.ballottaggio && <span className="text-amber-400" title="Ballottaggio">?</span>}
                        </div>
                        <p className="text-sm text-slate-300">{playerProfile.player.squadra}</p>
                      </div>
                      <div className="text-right">
                        <div className="text-3xl font-bold text-white">{playerProfile.player.quotAttuale ?? "—"}</div>
                        <div className="text-xs text-slate-400">Quotazione</div>
                      </div>
                    </div>

                    {/* Stats grid */}
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-2">
                        <div className="text-slate-400">Quot. iniz.</div>
                        <div className="text-base font-semibold text-white">{playerProfile.player.quotIniziale ?? "—"}</div>
                      </div>
                      <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-2">
                        <div className="text-slate-400">FMV</div>
                        <div className="text-base font-semibold text-white">{playerProfile.player.fvm ?? "—"}</div>
                      </div>
                      <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-2">
                        <div className="text-slate-400">Fascia</div>
                        <div className={`text-base font-semibold ${
                          playerProfile.player.fascia === "Top" ? "text-emerald-300" : "text-white"
                        }`}>{playerProfile.player.fascia ?? "—"}</div>
                      </div>
                      <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-2">
                        <div className="text-slate-400">Prezzo guida</div>
                        <div className="text-base font-semibold text-amber-300">{playerProfile.player.prezzoGuida ?? "—"}</div>
                      </div>
                      <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-2">
                        <div className="text-slate-400">Titolarità</div>
                        <div className="text-base font-semibold text-white">{playerProfile.player.titolarita ?? "—"}</div>
                      </div>
                      <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-2">
                        <div className="text-slate-400">Budget %</div>
                        <div className="text-base font-semibold text-white">
                          {playerProfile.player.budgetPct != null ? `${playerProfile.player.budgetPct}%` : "—"}
                        </div>
                      </div>
                    </div>

                    {/* Tetto massimo rilancio */}
                    {playerProfile.auction.status === "sold" ? (
                      <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3">
                        <p className="text-sm text-rose-200">
                          ❌ Già venduto a <strong>{playerProfile.auction.ownerName ?? "?"}</strong>
                        </p>
                      </div>
                    ) : playerProfile.auction.slotRuoloPieno ? (
                      <div className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 p-3">
                        <p className="text-sm text-rose-200">
                          ❌ Slot {playerProfile.player.ruolo} pieno
                        </p>
                      </div>
                    ) : playerProfile.auction.bidCeiling != null ? (
                      <div className="mt-3 rounded-lg border-2 border-emerald-500/50 bg-emerald-500/10 p-3">
                        <div className="flex items-baseline justify-between">
                          <div>
                            <div className="text-xs uppercase text-emerald-300">💰 Tetto massimo rilancio</div>
                            <div className="text-3xl font-bold text-emerald-200">
                              {playerProfile.auction.bidCeiling} cr
                            </div>
                          </div>
                          <div className="text-right text-xs text-slate-300">
                            <div>{playerProfile.auction.formula}</div>
                            <div className="mt-1">
                              Slot liberi:{" "}
                              <span className="text-slate-100">
                                {playerProfile.auction.slotsFree.P}P {playerProfile.auction.slotsFree.D}D {playerProfile.auction.slotsFree.C}C {playerProfile.auction.slotsFree.A}A
                              </span>
                            </div>
                          </div>
                        </div>
                        {playerProfile.player.prezzoGuida != null && (
                          <p className="mt-2 text-xs text-slate-300">
                            {playerProfile.auction.bidCeiling >= playerProfile.player.prezzoGuida
                              ? <>✅ Budget OK per il prezzo guida (<strong>{playerProfile.player.prezzoGuida}</strong>).</>
                              : <>⚠️ Sotto prezzo guida ({playerProfile.player.prezzoGuida}): puoi offrire al massimo <strong>{playerProfile.auction.bidCeiling}</strong>.</>}
                          </p>
                        )}
                      </div>
                    ) : null}

                    {/* Form acquisto */}
                    {playerProfile.auction.status !== "sold" && !playerProfile.auction.slotRuoloPieno && (
                      <div className="mt-3 flex items-center gap-2">
                        <input
                          type="number"
                          min={1}
                          max={playerProfile.auction.bidCeiling ?? 9999}
                          value={buyPrice}
                          onChange={(e) => setBuyPrice(e.target.value)}
                          placeholder="Prezzo offerta"
                          className="flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-center text-white focus:border-emerald-500 focus:outline-none"
                        />
                        <button
                          onClick={() => {
                            setBuyPrice(String(playerProfile.player.prezzoGuida ?? playerProfile.player.quotAttuale ?? 1));
                          }}
                          className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-2 text-xs text-amber-200 hover:bg-amber-500/20"
                          title="Usa prezzo guida"
                        >
                          🎯 Guida
                        </button>
                        <button
                          onClick={() => {
                            setBuyPrice(String(playerProfile.auction.bidCeiling));
                          }}
                          className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-2 py-2 text-xs text-emerald-200 hover:bg-emerald-500/20"
                          title="Usa tetto massimo"
                        >
                          💰 Tetto
                        </button>
                        <button
                          onClick={handleBuy}
                          disabled={!buyPrice || parseInt(buyPrice) <= 0 || parseInt(buyPrice) > (playerProfile.auction.bidCeiling ?? 0)}
                          className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                        >
                          ✅ Compra
                        </button>
                        <button
                          onClick={() => {
                            setSelectedPlayer(null);
                            setQuery("");
                            setBuyPrice("");
                            setPlayerProfile(null);
                          }}
                          className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-400 hover:bg-slate-700"
                        >
                          ✕
                        </button>
                      </div>
                    )}
                    {playerProfile.auction.status === "sold" && (
                      <div className="mt-3 text-right">
                        <button
                          onClick={() => {
                            setSelectedPlayer(null);
                            setQuery("");
                            setPlayerProfile(null);
                          }}
                          className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-400 hover:bg-slate-700"
                        >
                          ✕ Chiudi
                        </button>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-slate-400">Caricamento profilo…</p>
                )}
              </div>
            )}

            {selectedPlayer && slotLeft(currentManager, selectedPlayer.ruolo) <= 0 && (
              <p className="mt-2 text-xs text-amber-400">
                ⚠️ Slot {selectedPlayer.ruolo} pieno ({ROSTER_RULES[selectedPlayer.ruolo as keyof typeof ROSTER_RULES]}/{ROSTER_RULES[selectedPlayer.ruolo as keyof typeof ROSTER_RULES]})
              </p>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════
            ABBINAMENTI VINCENTI (dalla strategia)
        ═══════════════════════════════════════════════════════════════════ */}
        {abbinamenti && (
          <section className="mt-4 rounded-2xl border border-slate-700 bg-slate-800/40 p-4">
            <button
              onClick={() => setShowAbbinamenti(!showAbbinamenti)}
              className="flex w-full items-center justify-between"
            >
              <div>
                <h2 className="text-lg font-bold text-white">🎯 Abbinamenti Vincenti</h2>
                <p className="text-xs text-slate-400">
                  Combo di squadre consigliate dalla strategia (Top per ruolo)
                </p>
              </div>
              <span className="text-2xl text-slate-400">{showAbbinamenti ? "▾" : "▸"}</span>
            </button>

            {showAbbinamenti && (
              <div className="mt-4 space-y-3">
                {Object.entries(abbinamenti).map(([role, data]: [string, any]) => {
                  if (!data.combos || data.combos.length === 0) return null;
                  const roleCombos = data.combos
                    .slice()
                    .sort((a: any, b: any) => (b.rating ?? 0) - (a.rating ?? 0));

                  return (
                    <details key={role} open className="rounded-lg border border-slate-700 bg-slate-900/50">
                      <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800/50">
                        <span className={`mr-2 ${
                          role === 'P' ? 'text-blue-300' :
                          role === 'D' ? 'text-emerald-300' :
                          role === 'C' ? 'text-amber-300' :
                          'text-rose-300'
                        }`}>{role}</span>
                        {ROLE_LABELS[role as keyof typeof ROLE_LABELS]} · {roleCombos.length} combinazioni
                        <span className="ml-2 text-xs text-slate-500">({data.header})</span>
                      </summary>

                      <div className="space-y-2 px-3 pb-3">
                        {roleCombos.map((combo: any, idx: number) => {
                          const free = combo.players.filter((p: any) => p.status === "free");
                          const sold = combo.players.filter((p: any) => p.status === "sold");
                          const allFree = free.length === combo.players.length && combo.players.length > 0;
                          const allSold = combo.players.length > 0 && sold.length === combo.players.length;

                          return (
                            <div key={idx} className={`rounded-lg border p-2.5 text-sm ${
                              allSold
                                ? "border-rose-500/30 bg-rose-500/5 opacity-60"
                                : allFree
                                ? "border-emerald-500/40 bg-emerald-500/10"
                                : "border-amber-500/30 bg-amber-500/5"
                            }`}>
                              {/* Header combo */}
                              <div className="flex items-center justify-between">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {combo.teams.map((t: string, i: number) => (
                                    <span key={i} className="rounded bg-slate-800 px-1.5 py-0.5 text-xs font-medium text-slate-200">
                                      {t}
                                    </span>
                                  ))}
                                </div>
                                <div className="flex items-center gap-2">
                                  {combo.rating != null && (
                                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                                      combo.rating >= 95 ? "bg-emerald-500/20 text-emerald-300"
                                      : combo.rating >= 90 ? "bg-amber-500/20 text-amber-300"
                                      : "bg-slate-700 text-slate-300"
                                    }`}>
                                      {combo.rating}/100
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Info partite */}
                              {combo.info && (
                                <p className="mt-1 text-xs text-slate-400">{combo.info}</p>
                              )}

                              {/* Status */}
                              <div className="mt-2 flex gap-3 text-xs">
                                {combo.players.length > 0 ? (
                                  <>
                                    <span className="text-emerald-400">🟢 {free.length} liberi</span>
                                    {sold.length > 0 && (
                                      <span className="text-rose-400">🔴 {sold.length} presi</span>
                                    )}
                                  </>
                                ) : (
                                  <span className="text-slate-500">Nessun giocatore in queste squadre</span>
                                )}
                              </div>

                              {/* Lista giocatori cliccabili */}
                              {free.length > 0 && free.length <= 8 && (
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {free.map((p: any) => (
                                    <button
                                      key={p.id}
                                      onClick={() => {
                                        setSelectedPlayer({
                                          id: p.id, nome: p.nome, nomeNormalizzato: norm(p.nome),
                                          squadra: p.squadra, ruolo: p.ruolo, quotAttuale: p.quotAttuale,
                                          prezzoGuida: p.prezzoGuida ?? null, fascia: p.fascia ?? null, pupillo: !!p.pupillo,
                                        });
                                        setQuery(p.nome);
                                        setFilteredPlayers([]);
                                        setPlayerProfile(null);
                                        loadPlayerProfile(p.id);
                                      }}
                                      className="rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-200 hover:bg-emerald-500/20"
                                      title={`${p.nome} (${p.squadra}) - quot ${p.quotAttuale}`}
                                    >
                                      {p.nome} <span className="text-slate-500">·{p.quotAttuale ?? "?"}</span>
                                    </button>
                                  ))}
                                </div>
                              )}

                              {/* Presi (solo conteggio + lista compatta) */}
                              {sold.length > 0 && (
                                <details className="mt-1.5">
                                  <summary className="cursor-pointer text-xs text-rose-400 hover:underline">
                                    Vedi {sold.length} già presi
                                  </summary>
                                  <div className="mt-1 flex flex-wrap gap-1">
                                    {sold.map((p: any) => (
                                      <span key={p.id} className="rounded bg-rose-500/10 px-1.5 py-0.5 text-xs text-rose-300 line-through">
                                        {p.nome} <span className="text-slate-500">→{p.ownerName ?? "?"}</span>
                                      </span>
                                    ))}
                                  </div>
                                </details>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  );
                })}
              </div>
            )}
          </section>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════════════════
          COLONNA DX: Chat Helper
      ═══════════════════════════════════════════════════════════════════ */}
      <div className="flex w-full flex-col border-t border-slate-700 lg:max-w-sm lg:border-t-0 lg:border-l">
        <div className="border-b border-slate-700 bg-slate-800/80 px-4 py-3">
          <h2 className="text-sm font-semibold text-white">🤖 Coach Beard Chat</h2>
          <p className="text-xs text-slate-400">Chiedi budget, consigli, stato rosa…</p>
        </div>

        {/* Messaggi */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <p className="text-center text-xs text-slate-500">
              Prova: &ldquo;Quanto budget ho?&rdquo; o &ldquo;Chi mi consigli?&rdquo;
            </p>
          )}
          {messages.map((msg, i) => (
            <div
              key={i}
              className={`rounded-lg px-3 py-2 text-sm whitespace-pre-wrap ${
                msg.role === "user"
                  ? "ml-8 bg-slate-700 text-white"
                  : "mr-4 bg-slate-800 text-slate-200 border border-slate-700"
              }`}
            >
              {msg.content}
            </div>
          ))}
          {chatLoading && (
            <div className="mr-4 rounded-lg bg-slate-800 px-3 py-2 text-sm text-slate-400 border border-slate-700">
              Coach Beard sta pensando…
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input chat */}
        <form onSubmit={handleChat} className="border-t border-slate-700 p-3">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Scrivi qui…"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              disabled={chatLoading}
              className="flex-1 rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={chatLoading || !chatInput.trim()}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              →
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {["Quanto budget ho?", "Chi mi consigli?", "Stato asta", "Rosa"].map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => { setChatInput(q); }}
                className="rounded-full border border-slate-600 bg-slate-800 px-2 py-0.5 text-xs text-slate-400 hover:border-slate-500 hover:text-slate-300"
              >
                {q}
              </button>
            ))}
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── ManagerCard ─────────────────────────────────────────────────────────────

function ManagerCard({
  manager,
  onUndo,
}: {
  manager: Manager;
  onUndo: (seqId: number) => void;
}) {
  const mgr = manager;
  const players = mgr.players ?? [];
  const byRole = mgr.byRole ?? { P: 0, D: 0, C: 0, A: 0 };
  const credits = mgr.credits ?? 0;
  const spent = mgr.spent ?? 0;
  const playerCount = mgr.playerCount ?? players.length;
  const empty = TOTAL_SLOTS - playerCount;
  const ceiling = Math.max(0, credits - empty);
  const filledP = byRole.P, filledD = byRole.D, filledC = byRole.C, filledA = byRole.A;
  const maxP = ROSTER_RULES.P, maxD = ROSTER_RULES.D, maxC = ROSTER_RULES.C, maxA = ROSTER_RULES.A;

  const totalBids = players.length;
  const lastSeqId = totalBids > 0 ? totalBids : null;

  return (
    <div className={`rounded-2xl border p-4 ${mgr.isOwner ? "border-amber-500/50 bg-amber-500/5" : "border-slate-700 bg-slate-800/40"}`}>
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h2 className={`text-lg font-bold ${mgr.isOwner ? "text-amber-200" : "text-white"}`}>
            {mgr.name || `Manager ${mgr.id}`}
            {mgr.isOwner && " ★"}
          </h2>
          <p className="text-xs text-slate-400">
            {playerCount}/25 giocatori · {ROLES.map((r) => `${byRole[r]}/${ROSTER_RULES[r]}${r}`).join(" · ")}
          </p>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-bold ${credits < 100 ? "text-rose-400" : "text-white"}`}>
            {fmtCredits(credits)}
          </div>
          <div className="text-xs text-slate-400">crediti</div>
          <div className="mt-1 text-xs text-slate-500">
            Spesi: {fmtCredits(spent)} · Tetto: {ceiling}
          </div>
        </div>
      </div>

      {/* Barra progressi crediti */}
      <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-slate-700">
        <div
          className={`h-full rounded-full transition-all ${credits > 200 ? "bg-emerald-500" : credits > 100 ? "bg-amber-500" : "bg-rose-500"}`}
          style={{ width: `${Math.max(0, Math.min(100, (credits / 500) * 100))}%` }}
        />
      </div>

      {/* Progressione ruoli */}
      <div className="mb-3 grid grid-cols-4 gap-2 text-center text-xs">
        {[
          { role: "P", filled: filledP, max: maxP, color: "text-blue-300" },
          { role: "D", filled: filledD, max: maxD, color: "text-emerald-300" },
          { role: "C", filled: filledC, max: maxC, color: "text-amber-300" },
          { role: "A", filled: filledA, max: maxA, color: "text-rose-300" },
        ].map(({ role, filled, max, color }) => (
          <div key={role} className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1">
            <div className={`font-semibold ${color}`}>{role}</div>
            <div className="text-slate-400">{filled}/{max}</div>
            <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-slate-700">
              <div
                className={`h-full ${color.replace("text-", "bg-")}`}
                style={{ width: `${Math.min(100, (filled / max) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Giocatori */}
      {players.length === 0 ? (
        <p className="text-center text-sm text-slate-500">Nessun giocatore acquistato</p>
      ) : (
        <div className="space-y-1">
          {ROLES.map((role) => {
            const rolePlayers = players.filter((p) => p.ruolo === role);
            if (rolePlayers.length === 0) return null;
            return (
              <div key={role}>
                <div className={`mb-1 text-xs font-semibold uppercase tracking-wide ${{
                  P: "text-blue-400", D: "text-emerald-400", C: "text-amber-400", A: "text-rose-400",
                }[role]}`}>
                  {ROLE_LABELS[role]} ({rolePlayers.length}/{ROSTER_RULES[role as keyof typeof ROSTER_RULES]})
                </div>
                <div className="space-y-0.5">
                  {rolePlayers.map((p) => (
                    <div key={p.playerId} className="flex items-center justify-between rounded-lg bg-slate-800/80 px-3 py-1.5 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-white">{p.name}</span>
                        <span className="text-xs text-slate-400">{p.squadra}</span>
                      </div>
                      <span className="font-semibold text-emerald-400">{p.prezzo}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Undo ultimo */}
      {lastSeqId && (
        <div className="mt-3 flex justify-end">
          <button
            onClick={() => onUndo(lastSeqId)}
            className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/20"
          >
            ↩️ Annulla ultimo acquisto
          </button>
        </div>
      )}
    </div>
  );
}

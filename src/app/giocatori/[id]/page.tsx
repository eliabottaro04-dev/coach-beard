"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Player = {
  id: number; nome: string; ruolo: string; ruoloMantra: string | null;
  squadra: string;
  quotAttuale: number | null; quotIniziale: number | null; diff: number | null;
  fvm: number | null;
  fascia: string | null; prezzoGuida: number | null; budgetPct: number | null;
  pmaPct: number | null; titolarita: string | null; mv: number | null;
  titolareXI: string | null;
  ballottaggio: boolean; valorizzato: boolean; penalizzato: boolean;
  giovane: boolean; nomeNascosto: boolean;
  rigorista: boolean; punizioni: boolean; corner: boolean;
  noteGuida: string | null; pupillo: boolean;
  sources: Record<string, { value: any; source: string }>;
};

type Auction = {
  status: "free" | "sold" | "unsold";
  ownerName: string | null;
  ownerCredits: number | null;
  ownerEmptySlots: number | null;
  bidCeiling: number | null;
  slotRuoloPieno: boolean;
  slotsFree: { P: number; D: number; C: number; A: number };
  formula: string | null;
};

type ApiResponse = { ok: boolean; player?: Player; auction?: Auction; error?: string };

const ROLE_COLORS: Record<string, string> = {
  P: "from-blue-500/20 to-blue-600/10 border-blue-500/40",
  D: "from-emerald-500/20 to-emerald-600/10 border-emerald-500/40",
  C: "from-amber-500/20 to-amber-600/10 border-amber-500/40",
  A: "from-rose-500/20 to-rose-600/10 border-rose-500/40",
};

const ROLE_TEXT: Record<string, string> = {
  P: "text-blue-300",
  D: "text-emerald-300",
  C: "text-amber-300",
  A: "text-rose-300",
};

export default function GiocatoreRevisione({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [playerId, setPlayerId] = useState<string | null>(null);

  useEffect(() => {
    params.then((p) => setPlayerId(p.id));
  }, [params]);

  const load = async () => {
    if (!playerId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/giocatori/detail?id=${playerId}`, { cache: "no-store" });
      const json = (await res.json()) as ApiResponse;
      setData(json);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [playerId]);

  if (loading || !data) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8">
        <p className="text-slate-400">Carico profilo…</p>
      </main>
    );
  }

  if (!data.ok || !data.player || !data.auction) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8">
        <Link href="/giocatori" className="text-sm text-emerald-400 hover:underline">← Torna alla lista</Link>
        <p className="mt-4 text-rose-300">Errore: {data.error ?? "Giocatore non trovato"}</p>
      </main>
    );
  }

  const p = data.player;
  const a = data.auction;
  const available = a.status === "free" && !a.slotRuoloPieno;
  const canBid = available && a.bidCeiling != null && a.bidCeiling > 0;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      {/* Back link */}
      <Link href="/giocatori" className="text-sm text-emerald-400 hover:underline">← Torna alla lista</Link>

      {/* Hero card */}
      <section className={`mt-4 rounded-2xl border bg-gradient-to-br p-6 ${ROLE_COLORS[p.ruolo]}`}>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className={`text-3xl font-bold ${ROLE_TEXT[p.ruolo]}`}>{p.ruolo}</span>
              {p.pupillo && <span title="Pupillo" className="text-2xl">⭐</span>}
              {p.valorizzato && <span title="Valorizzato" className="rounded bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-300">▲ Valorizzato</span>}
              {p.penalizzato && <span title="Penalizzato" className="rounded bg-rose-500/20 px-2 py-0.5 text-xs text-rose-300">▼ Penalizzato</span>}
              {p.ballottaggio && <span title="Ballottaggio" className="rounded bg-amber-500/20 px-2 py-0.5 text-xs text-amber-300">? Ballottaggio</span>}
              {p.giovane && <span title="Giovane" className="rounded bg-blue-500/20 px-2 py-0.5 text-xs text-blue-300">★ Giovane</span>}
              {p.rigorista && <span title="Rigorista" className="rounded bg-purple-500/20 px-2 py-0.5 text-xs text-purple-300">⚽ Rigorista</span>}
              {p.punizioni && <span title="Punizioni" className="rounded bg-cyan-500/20 px-2 py-0.5 text-xs text-cyan-300">🎯 Punizioni</span>}
              {p.corner && <span title="Corner" className="rounded bg-indigo-500/20 px-2 py-0.5 text-xs text-indigo-300">⛳ Corner</span>}
            </div>
            <h1 className="mt-2 text-4xl font-bold text-white">{p.nome}</h1>
            <p className="mt-1 text-lg text-slate-300">{p.squadra} {p.ruoloMantra && <span className="text-slate-500">· {p.ruoloMantra}</span>}</p>
          </div>
          <div className="text-right">
            <div className="text-5xl font-bold text-white">{p.quotAttuale ?? "—"}</div>
            <div className="mt-1 text-xs uppercase text-slate-400">Quotazione attuale</div>
          </div>
        </div>
      </section>

      {/* Stats grid */}
      <section className="mt-6 grid gap-3 sm:grid-cols-4">
        <StatBox label="Quot. iniziale" value={p.quotIniziale ?? "—"} sub={p.diff != null ? `Diff: ${p.diff > 0 ? "+" : ""}${p.diff}` : undefined} />
        <StatBox label="FMV" value={p.fvm ?? "—"} sub="FantaMediaVoto storico" />
        <StatBox label="Titolarità" value={p.titolarita ?? "—"} sub={p.titolareXI ?? undefined} />
        <StatBox label="Fascia" value={p.fascia ?? "—"} sub="Strategia personale" />
        <StatBox label="Prezzo guida" value={p.prezzoGuida ?? "—"} sub="Budget %" value2={p.budgetPct != null ? `${p.budgetPct}%` : null} />
        <StatBox label="MV" value={p.mv ?? "—"} sub="Media voto" />
        <StatBox label="PMA %" value={p.pmaPct != null ? `${p.pmaPct}%` : "—"} sub="Presenza media" />
        <StatBox label="Note guida" value={p.noteGuida ?? "—"} sub="Dalla guida" wide />
      </section>

      {/* TETTO MASSIMO RILANCIO — la parte più importante */}
      <section className={`mt-6 rounded-2xl border-2 p-6 ${
        canBid
          ? "border-emerald-500/50 bg-emerald-500/5"
          : "border-slate-600 bg-slate-800/40"
      }`}>
        <h2 className="text-lg font-bold text-white">💰 Tetto massimo rilancio</h2>

        {a.status === "sold" ? (
          <p className="mt-3 text-rose-300">
            ❌ Giocatore già venduto a <strong>{a.ownerName ?? "?"}</strong>
          </p>
        ) : a.status === "unsold" ? (
          <p className="mt-3 text-slate-400">
            ⚠️ Giocatore dichiarato invenduto in questa sessione
          </p>
        ) : a.slotRuoloPieno ? (
          <p className="mt-3 text-rose-300">
            ❌ Hai lo slot {p.ruolo} pieno ({a.slotsFree[p.ruolo as keyof typeof a.slotsFree]} liberi → 0 per questo ruolo)
          </p>
        ) : a.bidCeiling != null ? (
          <>
            <div className="mt-4 flex items-baseline gap-3">
              <div className="text-6xl font-bold text-emerald-300">
                {a.bidCeiling}
              </div>
              <div className="text-slate-300">
                <div>crediti massimi</div>
                <div className="text-xs text-slate-500">{a.formula}</div>
              </div>
            </div>
            <p className="mt-3 text-sm text-slate-300">
              Puoi offrire fino a <strong className="text-emerald-300">{a.bidCeiling} crediti</strong> per {p.nome}
              preservando 1 credito per ogni slot ancora vuoto.
            </p>

            {/* Confronto con quotazione/prezzo guida */}
            <div className="mt-4 grid grid-cols-3 gap-3">
              {p.quotAttuale != null && (
                <Box label="Quotazione" value={p.quotAttuale}
                  hint={a.bidCeiling < p.quotAttuale ? "⚠️ Sotto quotazione" : a.bidCeiling > p.quotAttuale * 2 ? "🔥 Sopra 2× quot." : "OK"} />
              )}
              {p.prezzoGuida != null && (
                <Box label="Prezzo guida" value={p.prezzoGuida}
                  hint={a.bidCeiling < p.prezzoGuida ? "⚠️ Sotto guida" : a.bidCeiling > p.prezzoGuida * 2 ? "🔥 Sopra 2× guida" : "OK"} />
              )}
              <Box label="Slot vuoti" value={a.ownerEmptySlots ?? 0} sub={`${a.slotsFree.P}P ${a.slotsFree.D}D ${a.slotsFree.C}C ${a.slotsFree.A}A`} />
            </div>

            {/* Suggerimento operativo */}
            <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-200">
              💡 <strong>Suggerimento Coach Beard:</strong>{" "}
              {p.prezzoGuida != null && a.bidCeiling >= p.prezzoGuida
                ? <>Budget OK per il prezzo guida. Rilancio sicuro fino a <strong>{p.prezzoGuida}</strong> crediti.</>
                : p.prezzoGuida != null && a.bidCeiling < p.prezzoGuida
                ? <>Budget sotto il prezzo guida. Puoi permetterti al massimo <strong>{a.bidCeiling}</strong>, non il prezzo guida di {p.prezzoGuida}.</>
                : <>Rilancio massimo consentito: <strong>{a.bidCeiling}</strong> crediti.</>
              }
            </div>

            {canBid && (
              <button
                onClick={() => router.push(`/asta?buy=${p.id}&prezzo=${p.prezzoGuida ?? p.quotAttuale ?? 1}`)}
                className="mt-4 w-full rounded-xl border border-emerald-500/50 bg-emerald-500/15 px-4 py-3 text-base font-semibold text-emerald-200 hover:bg-emerald-500/25">
                Compra su Asta Live ({p.prezzoGuida ?? p.quotAttuale ?? "?"} cr)
              </button>
            )}
          </>
        ) : (
          <p className="mt-3 text-slate-400">Nessun tetto disponibile (manager non ancora definito).</p>
        )}
      </section>

      {/* Fonti */}
      <section className="mt-6 rounded-2xl border border-slate-600 bg-slate-800/40 p-4">
        <h3 className="text-sm font-semibold uppercase text-slate-400">📚 Fonti dei dati</h3>
        <ul className="mt-2 space-y-1 text-xs text-slate-400">
          {Object.entries(p.sources).map(([k, v]) => (
            <li key={k}>
              <span className="text-slate-300">{k}</span> = <span className="text-white">{String(v.value ?? "—")}</span>
              <span className="ml-2 text-slate-500">({v.source})</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

function StatBox({ label, value, sub, value2, wide = false }: { label: string; value: any; sub?: string; value2?: string | null; wide?: boolean }) {
  return (
    <div className={`rounded-lg border border-slate-700 bg-slate-800/60 p-3 ${wide ? "sm:col-span-2" : ""}`}>
      <div className="text-xs uppercase text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-bold text-white">{value}</div>
      {value2 && <div className="text-sm text-slate-300">{value2}</div>}
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function Box({ label, value, hint, sub }: { label: string; value: any; hint?: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-700 bg-slate-800/60 p-3">
      <div className="text-xs uppercase text-slate-400">{label}</div>
      <div className="mt-1 text-xl font-bold text-white">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-amber-300">{hint}</div>}
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

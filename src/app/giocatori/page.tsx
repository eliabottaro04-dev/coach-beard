"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

type Player = {
  id: number;
  nome: string;
  squadra: string;
  ruolo: "P" | "D" | "C" | "A";
  quotAttuale: number | null;
  quotIniziale: number | null;
  diff: number | null;
  fvm: number | null;
  fascia: string | null;
  prezzoGuida: number | null;
  titolarita: string | null;
  pupillo: boolean;
  valorizzato: boolean;
  penalizzato: boolean;
  ballottaggio: boolean;
  giovane: boolean;
  status: "free" | "sold" | "unsold";
  ownerName: string | null;
  obiettivo?: boolean;
};

type ApiResponse = { ok: boolean; count?: number; players?: Player[]; error?: string };

const ROLE_COLORS: Record<string, string> = {
  P: "text-blue-300",
  D: "text-emerald-300",
  C: "text-amber-300",
  A: "text-rose-300",
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  free: { label: "Libero", cls: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" },
  sold: { label: "Venduto", cls: "bg-rose-500/20 text-rose-300 border border-rose-500/40" },
  unsold: { label: "Invenduto", cls: "bg-slate-600/30 text-slate-400 border border-slate-500/40" },
};

export default function GiocatoriPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [obiettivoOnly, setObiettivoOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (roleFilter !== "ALL") params.set("role", roleFilter);
      if (query) params.set("q", query);
      const res = await fetch(`/api/giocatori?${params}`, { cache: "no-store" });
      const json = (await res.json()) as ApiResponse;
      if (!json.ok) { setError(json.error ?? "Errore"); return; }
      setPlayers(json.players ?? []);
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }, [query, roleFilter]);

  useEffect(() => { load(); }, [load]);

  const filtered = players.filter((p) => {
    if (statusFilter !== "ALL" && p.status !== statusFilter) return false;
    if (obiettivoOnly && !p.obiettivo) return false;
    return true;
  });

  const byRole = filtered.reduce((acc, p) => { acc[p.ruolo] = (acc[p.ruolo] ?? 0) + 1; return acc; }, {} as Record<string, number>);

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white">Giocatori</h1>
          <p className="mt-1 text-slate-300">
            {players.length > 0
              ? `${filtered.length} di ${players.length} giocatori`
              : "Tutti i giocatori del listone"}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <button onClick={load} disabled={loading}
            className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50">
            {loading ? "Carico…" : "Aggiorna"}
          </button>
        </div>
      </div>

      {/* Ricerca */}
      <div className="mt-6">
        <input
          type="search"
          placeholder="Cerca per nome o squadra…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-lg border border-slate-600 bg-slate-800 px-4 py-2.5 text-white placeholder-slate-400 focus:border-emerald-500 focus:outline-none"
        />
      </div>

      {/* Filtri ruolo */}
      <div className="mt-4 flex flex-wrap gap-2">
        {(["ALL","P","D","C","A"] as const).map((r) => (
          <button key={r} onClick={() => setRoleFilter(r)}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition ${
              roleFilter === r
                ? "border-emerald-500 bg-emerald-500/20 text-emerald-200"
                : "border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700"
            }`}>
            {r === "ALL" ? "Tutti" : r}
            {r !== "ALL" && players.length > 0 && (byRole[r] != null) && (
              <span className="ml-1.5 opacity-60">({players.filter((p) => p.ruolo === r && filtered.includes(p)).length})</span>
            )}
          </button>
        ))}
      </div>

      {/* Filtri stato */}
      <div className="mt-3 flex flex-wrap gap-2">
        {(["ALL","free","sold","unsold"] as const).map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)}
            className={`rounded-full border px-3 py-1 text-xs transition ${
              statusFilter === s
                ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
                : "border-slate-600 bg-slate-800/60 text-slate-400 hover:bg-slate-700"
            }`}>
            {s === "ALL" ? "Qualsiasi stato" : STATUS_BADGE[s]?.label ?? s}
          </button>
        ))}
        <button onClick={() => setObiettivoOnly(!obiettivoOnly)}
          className={`rounded-full border px-3 py-1 text-xs transition ${
            obiettivoOnly
              ? "border-amber-500/60 bg-amber-500/10 text-amber-300"
              : "border-slate-600 bg-slate-800/60 text-slate-400 hover:bg-slate-700"
          }`}>
          ⭐ Solo obiettivi ({players.filter((p) => p.obiettivo).length})
        </button>
      </div>

      {error ? (
        <div className="mt-6 rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-rose-200">
          <p className="font-semibold">Errore</p>
          <p className="mt-1 text-sm">{error}</p>
        </div>
      ) : (
        <>
          {/* Tabella */}
          <div className="mt-6 overflow-hidden rounded-2xl border border-slate-600">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-800 text-slate-300">
                  <tr>
                    <th className="px-3 py-3">Ruolo</th>
                    <th className="px-3 py-3">Giocatore</th>
                    <th className="px-3 py-3">Squadra</th>
                    <th className="px-3 py-3 text-right">Quot</th>
                    <th className="px-3 py-3 text-right">Diff</th>
                    <th className="px-3 py-3 text-right">FMV</th>
                    <th className="px-3 py-3">Fascia</th>
                    <th className="px-3 py-3">Stato</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && players.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-12 text-center text-slate-400">
                        Carico dal listone…
                      </td>
                    </tr>
                  ) : filtered.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-12 text-center text-slate-400">
                        Nessun giocatore trovato
                      </td>
                    </tr>
                  ) : filtered.map((p) => (
                    <tr key={p.id}
                      className={`border-t border-slate-700 transition hover:bg-slate-800/50 ${
                        p.status !== "free" ? "opacity-60" : ""
                      }`}>
                      <td className="px-3 py-2.5">
                        <span className={`font-semibold ${ROLE_COLORS[p.ruolo]}`}>{p.ruolo}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <Link href={`/giocatori/${p.id}`}
                          className="flex items-center gap-2 font-medium text-white hover:text-emerald-300 hover:underline">
                          {p.nome}
                          {p.pupillo && <span title="Pupillo">⭐</span>}
                          {p.obiettivo && !p.pupillo && <span title="Obiettivo">🎯</span>}
                          {p.valorizzato && <span title="Valorizzato" className="text-emerald-400">▲</span>}
                          {p.penalizzato && <span title="Penalizzato" className="text-rose-400">▼</span>}
                          {p.ballottaggio && <span title="Ballottaggio" className="text-amber-400">?</span>}
                          {p.giovane && <span title="Giovane" className="text-blue-400">★</span>}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 text-slate-300">{p.squadra}</td>
                      <td className="px-3 py-2.5 text-right text-white">
                        {p.quotAttuale ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {p.diff != null ? (
                          <span className={p.diff > 0 ? "text-emerald-400" : p.diff < 0 ? "text-rose-400" : "text-slate-400"}>
                            {p.diff > 0 ? "+" : ""}{p.diff}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-300">
                        {p.fvm ?? "—"}
                      </td>
                      <td className="px-3 py-2.5 text-slate-300">{p.fascia ?? "—"}</td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-block rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[p.status]?.cls ?? ""}`}>
                          {STATUS_BADGE[p.status]?.label ?? p.status}
                        </span>
                        {p.ownerName && (
                          <div className="mt-0.5 text-xs text-slate-500">{p.ownerName}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Riepilogo stats */}
          {players.length > 0 && (
            <div className="mt-4 flex gap-4 text-xs text-slate-500">
              <span>Totali: {players.length}</span>
              <span>·</span>
              <span className="text-emerald-400">Liberi: {players.filter((p) => p.status === "free").length}</span>
              <span>·</span>
              <span className="text-rose-400">Venduti: {players.filter((p) => p.status === "sold").length}</span>
              <span>·</span>
              <span>⭐ Obiettivi: {players.filter((p) => p.obiettivo).length}</span>
            </div>
          )}
        </>
      )}
    </main>
  );
}

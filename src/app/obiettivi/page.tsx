"use client";

import { useEffect, useState } from "react";

type Status = "free" | "mine" | "taken" | "unresolved";

type Obiettivo = {
  raw: string;
  nome: string;
  squadra: string | null;
  ruolo: "P" | "D" | "C" | "A";
  playerId: number | null;
  status: Status;
  owner: string | null;
  quotAttuale: number | null;
  prezzoGuida: number | null;
  fascia: string | null;
  pupillo: boolean;
};

type Summary = {
  total: number;
  free: number;
  mine: number;
  taken: number;
  unresolved: number;
};

type ApiResponse = {
  ok: boolean;
  fetchedAt?: string;
  error?: string;
  sheetId?: string;
  obiettivi?: Obiettivo[];
  byRole?: { P: number; D: number; C: number; A: number };
  summary?: Summary;
};

type Filter = "ALL" | "P" | "D" | "C" | "A";

const STATUS_LABEL: Record<Status, string> = {
  free: "LIBERO",
  mine: "PRESO DA ME",
  taken: "SOFFIATO",
  unresolved: "NON RISOLTO",
};

const STATUS_COLOR: Record<Status, string> = {
  free: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  mine: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  taken: "bg-rose-500/20 text-rose-300 border-rose-500/40",
  unresolved: "bg-slate-600/40 text-slate-300 border-slate-500/40",
};

export default function ObiettiviPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [statusFilter, setStatusFilter] = useState<Status | "ALL">("ALL");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/obiettivi", { cache: "no-store" });
      const json = (await res.json()) as ApiResponse;
      if (!json.ok) {
        setError(json.error ?? "Errore sconosciuto");
        setData(json);
      } else {
        setData(json);
      }
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // Auto-refresh ogni 30 secondi durante l'asta
    const interval = setInterval(load, 30000);
    return () => clearInterval(interval);
  }, []);

  const obiettivi = data?.obiettivi ?? [];
  const summary = data?.summary;
  const byRole = data?.byRole ?? { P: 0, D: 0, C: 0, A: 0 };

  const filtered = obiettivi.filter((o) => {
    if (filter !== "ALL" && o.ruolo !== filter) return false;
    if (statusFilter !== "ALL" && o.status !== statusFilter) return false;
    return true;
  });

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <div className="flex items-baseline justify-between">
        <div>
          <h1 className="text-3xl text-white">Obiettivi</h1>
          <p className="mt-2 text-slate-300">
            Lista obiettivi dal tuo Google Sheet, con stato nell&apos;asta.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-lg border border-slate-600 bg-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700 disabled:opacity-50"
        >
          {loading ? "Aggiorno…" : "Aggiorna"}
        </button>
      </div>

      {/* Stato fetch */}
      {data?.fetchedAt ? (
        <p className="mt-2 text-xs text-slate-500">
          Aggiornato alle {new Date(data.fetchedAt).toLocaleTimeString("it-IT")}
          {data.sheetId ? ` · sheet ${data.sheetId.slice(0, 8)}…` : ""}
        </p>
      ) : null}

      {error ? (
        <div className="mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 p-4 text-rose-200">
          <p className="font-semibold">Errore</p>
          <p className="mt-1 text-sm">{error}</p>
          <p className="mt-2 text-xs text-rose-300/70">
            Verifica che il foglio Google sia condiviso come "Chiunque con il link".
          </p>
        </div>
      ) : null}

      {/* Riepilogo */}
      {summary ? (
        <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatBox label="Totali" value={summary.total} color="slate" />
          <StatBox label="Liberi" value={summary.free} color="emerald" />
          <StatBox label="Miei" value={summary.mine} color="amber" />
          <StatBox label="Soffiati" value={summary.taken} color="rose" />
          <StatBox label="Non risolti" value={summary.unresolved} color="slate" />
        </section>
      ) : null}

      {/* Filtri per ruolo */}
      <section className="mt-6 flex flex-wrap gap-2">
        <FilterPill active={filter === "ALL"} onClick={() => setFilter("ALL")}>
          Tutti ({obiettivi.length})
        </FilterPill>
        <FilterPill active={filter === "P"} onClick={() => setFilter("P")}>
          P ({byRole.P})
        </FilterPill>
        <FilterPill active={filter === "D"} onClick={() => setFilter("D")}>
          D ({byRole.D})
        </FilterPill>
        <FilterPill active={filter === "C"} onClick={() => setFilter("C")}>
          C ({byRole.C})
        </FilterPill>
        <FilterPill active={filter === "A"} onClick={() => setFilter("A")}>
          A ({byRole.A})
        </FilterPill>
      </section>

      {/* Filtri per stato */}
      <section className="mt-3 flex flex-wrap gap-2">
        <FilterPill
          small
          active={statusFilter === "ALL"}
          onClick={() => setStatusFilter("ALL")}
        >
          Qualsiasi stato
        </FilterPill>
        <FilterPill small active={statusFilter === "free"} onClick={() => setStatusFilter("free")}>
          Libero
        </FilterPill>
        <FilterPill small active={statusFilter === "mine"} onClick={() => setStatusFilter("mine")}>
          Mio
        </FilterPill>
        <FilterPill small active={statusFilter === "taken"} onClick={() => setStatusFilter("taken")}>
          Soffiato
        </FilterPill>
        <FilterPill small active={statusFilter === "unresolved"} onClick={() => setStatusFilter("unresolved")}>
          Non risolto
        </FilterPill>
      </section>

      {/* Tabella */}
      <section className="mt-6 overflow-hidden rounded-2xl border border-slate-600">
        <table className="w-full text-left">
          <thead className="bg-slate-800 text-sm text-slate-300">
            <tr>
              <th className="px-3 py-3">Ruolo</th>
              <th className="px-3 py-3">Calciatore</th>
              <th className="px-3 py-3">Squadra</th>
              <th className="px-3 py-3 text-right">Quot</th>
              <th className="px-3 py-3 text-right">Guida</th>
              <th className="px-3 py-3">Fascia</th>
              <th className="px-3 py-3">Stato</th>
              <th className="px-3 py-3">Da chi</th>
            </tr>
          </thead>
          <tbody>
            {loading && obiettivi.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-slate-400">
                  Carico dal Google Sheet…
                </td>
              </tr>
            ) : filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-slate-400">
                  Nessun obiettivo corrisponde ai filtri.
                </td>
              </tr>
            ) : (
              filtered.map((o, i) => (
                <tr
                  key={`${o.raw}-${i}`}
                  className={`border-t border-slate-700 ${o.status === "unresolved" ? "bg-slate-900/50" : ""}`}
                >
                  <td className="px-3 py-2 text-slate-400">{o.ruolo}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-white">{o.nome}</span>
                      {o.pupillo ? <span title="Pupillo">⭐</span> : null}
                    </div>
                    {o.status === "unresolved" ? (
                      <p className="mt-1 text-xs text-slate-500">
                        Originale: <code>{o.raw}</code>
                      </p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-slate-300">{o.squadra ?? "—"}</td>
                  <td className="px-3 py-2 text-right text-slate-200">
                    {o.quotAttuale ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-200">
                    {o.prezzoGuida ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-slate-300">{o.fascia ?? "—"}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-block rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_COLOR[o.status]}`}
                    >
                      {STATUS_LABEL[o.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-slate-300">{o.owner ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <p className="mt-6 text-xs text-slate-500">
        Auto-refresh ogni 30 secondi. Premi Aggiorna per refresh manuale.
      </p>
    </main>
  );
}

function StatBox({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "slate" | "emerald" | "amber" | "rose";
}) {
  const colorMap = {
    slate: "border-slate-600 bg-slate-800 text-slate-200",
    emerald: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
    amber: "border-amber-500/40 bg-amber-500/10 text-amber-200",
    rose: "border-rose-500/40 bg-rose-500/10 text-rose-200",
  } as const;
  return (
    <div className={`rounded-lg border p-3 ${colorMap[color]}`}>
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  children,
  small = false,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 ${small ? "py-0.5 text-xs" : "py-1 text-sm"} transition ${
        active
          ? "border-emerald-500 bg-emerald-500/20 text-emerald-200"
          : "border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700"
      }`}
    >
      {children}
    </button>
  );
}

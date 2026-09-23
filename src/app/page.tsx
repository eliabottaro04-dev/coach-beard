"use client";

import { useEffect, useState } from "react";
import {
  emptyManagers,
  LEAGUE_RULES,
  remainingCredits,
  ROSTER_SIZE,
  validateSetup,
  type ManagerDraft,
} from "@/lib/league-rules";

const STORAGE_KEY = "coach-beard-fase1-setup-classic";

export default function HomePage() {
  const [managers, setManagers] = useState<ManagerDraft[]>(emptyManagers);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<{ names?: string; owner?: string }>({});
  const [loaded, setLoaded] = useState(false);
  const [dbStatus, setDbStatus] = useState<string>("non verificato");
  const [datasetStatus, setDatasetStatus] = useState<string>("non verificato");

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as { managers: ManagerDraft[] };
        if (parsed.managers?.length === LEAGUE_RULES.managerCount) {
          setManagers(parsed.managers);
          setSaved(true);
        }
      } catch {
        /* ignore broken local data */
      }
    }
    // pinga il backend per materializzare il DB SQLite
    fetch("/api/health")
      .then((r) => r.json())
      .then((j) => setDbStatus(j.ok ? `DB ok · ${j.managers.length} manager · ${j.config.league_name}` : `DB errore: ${j.error}`))
      .catch((e) => setDbStatus(`DB non raggiungibile: ${e.message}`));
    fetch("/api/dataset")
      .then((r) => r.json())
      .then((j) => j.ok
        ? setDatasetStatus(`Dataset ${j.version} · ${j.stats.totalPlayers} calciatori · ${j.stats.teams} squadre`)
        : setDatasetStatus(`Dataset errore: ${j.error}`))
      .catch((e) => setDatasetStatus(`Dataset non raggiungibile: ${e.message}`));
    setLoaded(true);
  }, []);

  function updateName(id: number, name: string) {
    setSaved(false);
    setManagers((current) =>
      current.map((manager) => (manager.id === id ? { ...manager, name } : manager)),
    );
  }

  function chooseOwner(id: number) {
    setSaved(false);
    setManagers((current) =>
      current.map((manager) => ({ ...manager, isOwner: manager.id === id })),
    );
  }

  function onSave() {
    const nextErrors = validateSetup(managers);
    setErrors(nextErrors);
    if (nextErrors.names || nextErrors.owner) {
      setSaved(false);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ managers }));
    setSaved(true);
  }

  function onReset() {
    setManagers(emptyManagers());
    setSaved(false);
    setErrors({});
    window.localStorage.removeItem(STORAGE_KEY);
  }

  if (!loaded) {
    return (
      <main className="mx-auto max-w-5xl px-4 py-10">
        <p className="text-slate-400">Caricamento…</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mt-2 text-4xl text-white">Setup lega</h1>
      <p className="mt-3 max-w-2xl text-lg leading-relaxed text-slate-300">
        Questa è la base dell&apos;app sul tuo computer. Per ora non c&apos;è listone né asta:
        controlliamo che le <strong className="text-white">regole della tua lega</strong> siano
        giuste e che tu possa nominare i {LEAGUE_RULES.managerCount} partecipanti.
      </p>

      <section className="mt-8 rounded-2xl border border-slate-600 bg-slate-800 p-5">
        <h2 className="text-2xl text-white">Regole salvate nel codice</h2>
        <ul className="mt-4 grid gap-3 text-slate-200 sm:grid-cols-2">
          <li>
            Lega: <strong>{LEAGUE_RULES.leagueName}</strong> (ruoli P / D / C / A)
          </li>
          <li>
            Partecipanti: <strong>{LEAGUE_RULES.managerCount}</strong>
          </li>
          <li>
            Crediti a testa: <strong>{LEAGUE_RULES.initialCredits}</strong>
          </li>
          <li>
            Portieri: <strong>{LEAGUE_RULES.roster.P}</strong>
          </li>
          <li>
            Difensori: <strong>{LEAGUE_RULES.roster.D}</strong>
          </li>
          <li>
            Centrocampisti: <strong>{LEAGUE_RULES.roster.C}</strong>
          </li>
          <li>
            Attaccanti: <strong>{LEAGUE_RULES.roster.A}</strong>
          </li>
          <li>
            Rosa totale: <strong>{ROSTER_SIZE} giocatori</strong>
          </li>
        </ul>
        <p className="mt-4 text-sm text-slate-400">
          Ruoli: {LEAGUE_RULES.classicRoles.map((role) => `${role.code} (${role.label})`).join(", ")}.
        </p>
      </section>

      <section className="mt-8">
        <h2 className="text-2xl text-white">I {LEAGUE_RULES.managerCount} partecipanti</h2>
        <p className="mt-2 text-slate-300">
          Scrivi i nomi (o i nomi-squadra) e indica quale sei tu. Poi premi Salva: restano in
          questo browser, nessuno li carica su internet.
        </p>

        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-600">
          <table className="w-full text-left">
            <thead className="bg-slate-800 text-sm text-slate-300">
              <tr>
                <th className="px-3 py-3">#</th>
                <th className="px-3 py-3">Nome squadra / fantallenatore</th>
                <th className="px-3 py-3">Sei tu?</th>
                <th className="px-3 py-3">Crediti</th>
                <th className="px-3 py-3">Rosa ora</th>
              </tr>
            </thead>
            <tbody>
              {managers.map((manager) => (
                <tr key={manager.id} className="border-t border-slate-700">
                  <td className="px-3 py-2 text-slate-400">{manager.id}</td>
                  <td className="px-3 py-2">
                    <input
                      value={manager.name}
                      onChange={(event) => updateName(manager.id, event.target.value)}
                      placeholder={`Partecipante ${manager.id}`}
                      className="w-full rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-white"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
                      <input
                        type="radio"
                        name="owner"
                        checked={manager.isOwner}
                        onChange={() => chooseOwner(manager.id)}
                      />
                      La mia
                    </label>
                  </td>
                  <td className="px-3 py-2 font-semibold text-emerald-400">
                    {remainingCredits()}
                  </td>
                  <td className="px-3 py-2 text-sm text-slate-400">
                    0/{LEAGUE_RULES.roster.P} P · 0/{LEAGUE_RULES.roster.D} D · 0/
                    {LEAGUE_RULES.roster.C} C · 0/{LEAGUE_RULES.roster.A} A
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {errors.names ? <p className="mt-3 text-amber-300">{errors.names}</p> : null}
        {errors.owner ? <p className="mt-3 text-amber-300">{errors.owner}</p> : null}
        {saved ? (
          <p className="mt-3 text-emerald-400">
            Salvato. Collaudo Fase 1 ok: {LEAGUE_RULES.managerCount} nomi, una squadra tua,{" "}
            {LEAGUE_RULES.initialCredits} crediti ciascuno, rosa {LEAGUE_RULES.roster.P}P-
            {LEAGUE_RULES.roster.D}D-{LEAGUE_RULES.roster.C}C-{LEAGUE_RULES.roster.A}A ancora vuota.
          </p>
        ) : null}

      <section className="mt-8 rounded-2xl border border-slate-700 bg-slate-900 p-4 text-sm text-slate-300">
        <h3 className="text-base text-white">Stato tecnico</h3>
        <p className="mt-2">DB SQLite: <span className="text-slate-100">{dbStatus}</span></p>
        <p>Dataset: <span className="text-slate-100">{datasetStatus}</span></p>
        <p className="mt-2 text-xs text-slate-500">
          Test eseguiti: <code className="bg-slate-800 px-1">npm run test:data</code> e <code className="bg-slate-800 px-1">npm run test:engine</code>
        </p>
      </section>

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={onSave}
            className="rounded-xl bg-emerald-500 px-5 py-3 font-semibold text-slate-950"
          >
            Salva configurazione
          </button>
          <button
            type="button"
            onClick={onReset}
            className="rounded-xl border border-slate-500 px-5 py-3 text-slate-200"
          >
            Cancella e ricomincia
          </button>
        </div>
      </section>
    </main>
  );
}

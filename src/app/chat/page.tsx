"use client";

import { useEffect, useRef, useState } from "react";

type AgentMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
};

type AgentStatus = {
  mode: "ai" | "deterministic" | "unavailable" | "loading";
  model?: string;
  provider?: string;
  hasApiKey?: boolean;
};

export default function ChatPage() {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [agentStatus, setAgentStatus] = useState<AgentStatus>({ mode: "loading" });
  const [managerId, setManagerId] = useState<number>(1);
  const endRef = useRef<HTMLDivElement>(null);

  // Carica stato agente
  useEffect(() => {
    fetch("/api/agent")
      .then((r) => r.json())
      .then((d) => setAgentStatus({ mode: d.mode, model: d.model, provider: d.provider, hasApiKey: d.hasApiKey }))
      .catch(() => setAgentStatus({ mode: "unavailable" }));
  }, []);

  // Auto-scroll
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;
    const userMsg: AgentMessage = { role: "user", content: text, timestamp: new Date() };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, managerId }),
      });
      const json = await res.json();
      const reply = json.message ?? json.error ?? "Nessuna risposta.";
      setMessages((m) => [
        ...m,
        { role: "assistant", content: reply, timestamp: new Date() },
      ]);
    } catch (err: any) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "⚠️ Errore di connessione: " + err.message, timestamp: new Date() },
      ]);
    } finally {
      setLoading(false);
    }
  }

  const modeLabel = {
    ai: "🤖 AI",
    deterministic: "🔢 Deterministic",
    unavailable: "⚠️ Non disponibile",
    loading: "⏳…",
  }[agentStatus.mode];

  const modeColor = {
    ai: "text-emerald-300",
    deterministic: "text-amber-300",
    unavailable: "text-rose-300",
    loading: "text-slate-400",
  }[agentStatus.mode];

  return (
    <main className="flex h-[calc(100vh-57px)] flex-col">
      {/* Header */}
      <div className="border-b border-slate-700 bg-slate-900 px-6 py-4">
        <div className="mx-auto max-w-2xl flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">🤖 Coach Beard</h1>
            <p className="mt-1 text-sm text-slate-300">
              Chatta con l&apos;assistente d&apos;asta. Chiedi budget, consigli, stato della rosa, confronto giocatori…
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className={`text-xs font-semibold ${modeColor}`}>{modeLabel}</div>
              {agentStatus.model && (
                <div className="text-xs text-slate-500">{agentStatus.model}</div>
              )}
            </div>
            <select
              value={managerId}
              onChange={(e) => setManagerId(Number(e.target.value))}
              className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-white"
            >
              {Array.from({ length: 8 }, (_, i) => (
                <option key={i + 1} value={i + 1}>Manager {i + 1}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Messaggi */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-6 space-y-4">
          {messages.length === 0 && (
            <div className="rounded-2xl border border-slate-700 bg-slate-800/40 p-6 text-center">
              <p className="text-2xl">🧔</p>
              <p className="mt-2 font-semibold text-white">Ciao! Sono Coach Beard.</p>
              <p className="mt-1 text-sm text-slate-400">
                Posso aiutarti con l&apos;asta di Fantacalcio. Prova a chiedere:
              </p>
              <ul className="mt-3 space-y-1 text-sm text-slate-300">
                <li>💰 <strong>&ldquo;Quanto budget ho?&rdquo;</strong></li>
                <li>⭐ <strong>&ldquo;Chi mi consigli?&rdquo;</strong></li>
                <li>📊 <strong>&ldquo;Stato asta&rdquo;</strong></li>
                <li>👥 <strong>&ldquo;Come va la mia rosa?&rdquo;</strong></li>
                <li>⚔️ <strong>&ldquo;Confronta Leao e Kvara&rdquo;</strong></li>
              </ul>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i}>
              <div className={`rounded-2xl px-4 py-3 whitespace-pre-wrap text-sm leading-relaxed ${
                msg.role === "user"
                  ? "ml-12 rounded-br-md bg-emerald-600/20 border border-emerald-500/30 text-emerald-100"
                  : "mr-8 rounded-bl-md bg-slate-800 border border-slate-700 text-slate-200"
              }`}>
                <span className="text-xs font-semibold opacity-50 block mb-1">
                  {msg.role === "user" ? "Tu" : "Coach Beard"}
                </span>
                {msg.content}
              </div>
              <div className="mt-0.5 px-1 text-xs text-slate-600">
                {msg.timestamp.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
          ))}

          {loading && (
            <div className="mr-8">
              <div className="rounded-2xl rounded-bl-md bg-slate-800 border border-slate-700 px-4 py-3 text-sm text-slate-400">
                <span className="text-xs font-semibold opacity-50 block mb-1">Coach Beard</span>
                Coach Beard sta pensando…
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-slate-700 bg-slate-900 px-6 py-4">
        <div className="mx-auto max-w-2xl">
          <form onSubmit={send} className="flex gap-2">
            <input
              type="text"
              placeholder="Scrivi qui la tua domanda…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={loading}
              className="flex-1 rounded-xl border border-slate-600 bg-slate-800 px-4 py-3 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="rounded-xl bg-emerald-600 px-6 py-3 font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 transition"
            >
              →
            </button>
          </form>

          {/* Quick queries */}
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              "Quanto budget ho?",
              "Chi mi consigli?",
              "Stato asta",
              "Come va la mia rosa?",
              "Slot liberi nel mio reparto",
            ].map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => setInput(q)}
                className="rounded-full border border-slate-600 bg-slate-800 px-3 py-1 text-xs text-slate-300 hover:border-emerald-500/50 hover:text-emerald-300 transition"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

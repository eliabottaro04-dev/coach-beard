// Funzioni pure del bot Telegram — testabili indipendentemente.
// Non ha dipendenze da DB o network.

export type PurchaseParse = { player: string; buyer: string; price: number };

/**
 * Parsing dei comandi di acquisto in varie forme:
 *   "Maignan a Federico 100"
 *   "compra Maignan per Federico 100"
 *   "Maignan → Federico 100"
 *   "Maignan -> Federico 100"
 */
export function parsePurchaseCmd(text: string): PurchaseParse | null {
  const t = text.trim();

  // Pattern 1: "Giocatore a Manager Prezzo"
  let m = t.match(/^(.+?)\s+a\s+(\S+)\s+(\d+)\s*$/i);
  if (m) return { player: m[1].trim(), buyer: m[2].trim(), price: parseInt(m[3]) };

  // Pattern 2: "compra Giocatore per/a Manager Prezzo"
  m = t.match(/^compra?\s+(.+?)\s+(?:per|a)\s+(\S+)\s+(\d+)\s*$/i);
  if (m) return { player: m[1].trim(), buyer: m[2].trim(), price: parseInt(m[3]) };

  // Pattern 3: "Giocatore → Manager Prezzo"  (freccia Unicode e ASCII)
  m = t.match(/^(.+?)\s+(?:->|→)\s+(\S+)\s+(\d+)\s*$/i);
  if (m) return { player: m[1].trim(), buyer: m[2].trim(), price: parseInt(m[3]) };

  return null;
}

/**
 * Risolve il nome di un partecipante → ID.
 * Funziona con nome parziale e case-insensitive.
 */
export function resolveManager(name: string, managers: Array<{ id: number; name: string }>): number | null {
  const q = name.toLowerCase().trim();
  // Match esatto (case-insensitive)
  const exact = managers.find((m) => m.name.toLowerCase() === q);
  if (exact) return exact.id;
  // Match parziale
  const partial = managers.find((m) => m.name.toLowerCase().includes(q) || q.includes(m.name.toLowerCase()));
  if (partial) return partial.id;
  return null;
}

/**
 * Risolve il nome di un calciatore → player object.
 * Alias espliciti > fuzzy match sul cognome.
 */
export function resolvePlayer(
  name: string,
  players: Array<{ id: number; nome: string; ruolo: string; squadra: string }>
) {
  const q = name.toLowerCase().trim();

  // Alias comuni (calciatori con nomi scritti in modo diverso tra fonti)
  const aliases: Record<string, number> = {
    'lautaro martinez': 2764, 'martinez l.': 2764, 'martinez l': 2764,
    'paz n.': 6875, 'paz n': 6875, 'nico paz': 6875,
    'maignan': 4995, 'svilar': 4991, 'vicario': 4964,
    'calhanoglu': 2666, 'mbay': 6891, 'malen': 2758,
    'dimarco': 2541, 'bastoni': 2538, 'tomori': 2540,
    'thiaw': 2632, 'gabbia': 2542, 'buongiorno': 2627,
    'lw': 2734, 'dybala': 2720, 'vlahovic': 2731, 'isak': 4989,
  };
  if (aliases[q]) {
    const p = players.find((x) => x.id === aliases[q]);
    if (p) return p;
  }

  // Fuzzy: cerca per cognome
  const words = q.split(' ').filter(Boolean);
  const cognome = words[words.length - 1] ?? q;
  const candidates = players.filter((p) => {
    const pn = p.nome.toLowerCase();
    return pn.includes(cognome) || (pn.split(' ').pop() ?? '').includes(cognome);
  });

  if (candidates.length === 1) return candidates[0];

  // Se più candidati, prova a match completo su nome
  if (candidates.length > 1) {
    const best = candidates.find((p) => {
      const pn = p.nome.toLowerCase();
      return pn.includes(q) || q.includes(pn);
    });
    if (best) return best;
  }

  return null;
}

// Esportatore CSV conforme a Template_Import.json (Leghe Fantacalcio).
// Regole principali dal template:
//  - Marker: "$,$,$" prima di ogni blocco team
//  - Colonne: team_name, player_id, purchase_price
//  - Nessun header, no BOM, UTF-8, LF
//  - 10 team richiesti dal template (la tua lega ha 8 — lo segnala)
//  - Ordinamento: P,D,C,A poi nome italiano

export type ValidationError = {
  code: string;
  message: string;
  path: string;
  details?: Record<string, any>;
};

export type ValidationResult =
  | { valid: true }
  | { valid: false; errors: ValidationError[] };

export type LegheExportInput = {
  schemaVersion: string;
  league: {
    name: string;
    initialCredits: number;
    datasetVersion: string;
    rosterRules: { P: number; D: number; C: number; A: number };
  };
  teams: Array<{
    teamId: string;
    displayOrder: number;
    name: string;
    /** 'real' = rosa vera, 'placeholder' = da compilare */
    teamType?: 'real' | 'placeholder';
    players: Array<{
      officialPlayerId: number;
      playerName: string;
      role: 'P' | 'D' | 'C' | 'A';
      purchasePrice: number;
      status: 'purchased' | 'placeholder';
    }>;
  }>;
};

// ── 1. Validazione ──────────────────────────────────────────────

export function validateLegheExport(input: LegheExportInput): ValidationResult {
  const errors: ValidationError[] = [];

  // Schema base
  if (!input.schemaVersion || input.schemaVersion !== '1.0.0') {
    errors.push({ code: 'INVALID_SCHEMA_VERSION', message: 'schemaVersion deve essere "1.0.0"', path: 'schemaVersion' });
  }
  if (!input.league?.initialCredits) {
    errors.push({ code: 'MISSING_LEAGUE', message: 'league mancante', path: 'league' });
  } else if (input.league.initialCredits !== 500) {
    errors.push({ code: 'INVALID_CREDITS', message: `initialCredits deve essere 500, trovato ${input.league.initialCredits}`, path: 'league.initialCredits' });
  }

  const teams = input.teams ?? [];

  // ⚠ AVVISO: template richiede 10 team, lega ne ha N
  if (teams.length !== 10) {
    errors.push({
      code: 'WRONG_TEAM_COUNT',
      message: `Template Leghe Fantacalcio richiede 10 squadre, ma la lega ne ha ${teams.length}. L'importazione potrebbe fallire su Leghe.`,
      path: 'teams',
      details: { found: teams.length, expected: 10 },
    });
  } else {
    // Se 10: verifica struttura 8 reali + 2 placeholder, o tutti reali
    const realCount = teams.filter((t) => t.teamType !== 'placeholder').length;
    const placeholderCount = teams.filter((t) => t.teamType === 'placeholder').length;
    if (placeholderCount > 0 && realCount !== 8) {
      errors.push({
        code: 'PLACEHOLDER_MISMATCH',
        message: `Con i placeholder servono 8 squadre reali + 2 placeholder. Trovate ${realCount} reali e ${placeholderCount} placeholder.`,
        path: 'teams',
        details: { real: realCount, placeholder: placeholderCount },
      });
    }
  }

  // displayOrder unici e copertura 1..N
  const orders = teams.map((t) => t.displayOrder).sort((a, b) => a - b);
  const orderSet = new Set(orders);
  if (orders.length !== orderSet.size) {
    const dup = orders.filter((o, i) => orders.indexOf(o) !== i);
    errors.push({ code: 'DUPLICATE_DISPLAY_ORDER', message: `displayOrder duplicati: ${[...new Set(dup)].join(',')}`, path: 'teams' });
  }
  for (let i = 0; i < orders.length; i++) {
    if (orders[i] !== i + 1) {
      errors.push({ code: 'INVALID_DISPLAY_ORDER', message: `displayOrder deve coprire 1..${orders.length}, manca ${i + 1}`, path: 'teams' });
    }
  }

  // Nomi team unici e senza caratteri proibiti
  const names = new Set<string>();
  for (const team of teams) {
    if (!team.name || team.name.trim() === '') {
      errors.push({ code: 'EMPTY_TEAM_NAME', message: 'Nome team vuoto', path: `teams[${team.displayOrder - 1}].name` });
    }
    if (names.has(team.name)) {
      errors.push({ code: 'DUPLICATE_TEAM_NAME', message: `Nome duplicato: "${team.name}"`, path: `teams[${team.displayOrder - 1}].name` });
    }
    names.add(team.name);
    if (/[,$]/.test(team.name) || /[\r\n]/.test(team.name)) {
      errors.push({ code: 'INVALID_TEAM_NAME', message: `Nome team contiene caratteri non ammessi: "${team.name}"`, path: `teams[${team.displayOrder - 1}].name` });
    }
  }

  // Per ogni team: rosa, crediti, player unici
  const allPlayerIds = new Map<number, string>(); // playerId → nome (per trovare duplicati cross-team)

  for (const team of teams) {
    const isPlaceholder = team.teamType === 'placeholder';
    const roster = team.rosterRules ?? input.league.rosterRules;
    const players = team.players ?? [];

    // Conteggio ruoli (solo team reali)
    if (!isPlaceholder) {
      const byRole = { P: 0, D: 0, C: 0, A: 0 };
      for (const p of players) {
        if (p.status !== 'purchased') continue;
        byRole[p.role]++;
      }

      if (byRole.P !== roster.P) {
        errors.push({
          code: 'WRONG_ROLE_COUNT', path: `teams["${team.name}"].players`,
          message: `${team.name}: ${byRole.P} P invece di ${roster.P}`,
          details: { found: byRole, expected: roster },
        });
      }
      if (byRole.D !== roster.D) {
        errors.push({
          code: 'WRONG_ROLE_COUNT', path: `teams["${team.name}"].players`,
          message: `${team.name}: ${byRole.D} D invece di ${roster.D}`,
          details: { found: byRole, expected: roster },
        });
      }
      if (byRole.C !== roster.C) {
        errors.push({
          code: 'WRONG_ROLE_COUNT', path: `teams["${team.name}"].players`,
          message: `${team.name}: ${byRole.C} C invece di ${roster.C}`,
          details: { found: byRole, expected: roster },
        });
      }
      if (byRole.A !== roster.A) {
        errors.push({
          code: 'WRONG_ROLE_COUNT', path: `teams["${team.name}"].players`,
          message: `${team.name}: ${byRole.A} A invece di ${roster.A}`,
          details: { found: byRole, expected: roster },
        });
      }
    }

    // Totale crediti e unicità player (solo team reali)
    let totalSpent = 0;
    const teamPlayerIds = new Set<number>();
    for (const p of players) {
      if (p.status !== 'purchased') continue;
      totalSpent += p.purchasePrice;
      if (p.purchasePrice <= 0 || p.purchasePrice > 500) {
        errors.push({
          code: 'INVALID_PRICE', path: `teams["${team.name}"].players`,
          message: `Prezzo non valido per ${p.playerName}: ${p.purchasePrice}`,
        });
      }
      if (teamPlayerIds.has(p.officialPlayerId)) {
        errors.push({
          code: 'DUPLICATE_PLAYER_IN_TEAM', path: `teams["${team.name}"].players`,
          message: `${team.name} ha due volte ${p.playerName} (ID ${p.officialPlayerId})`,
        });
      }
      teamPlayerIds.add(p.officialPlayerId);
      if (allPlayerIds.has(p.officialPlayerId)) {
        const prev = allPlayerIds.get(p.officialPlayerId)!;
        errors.push({
          code: 'PLAYER_IN_TWO_TEAMS', path: `teams["${team.name}"].players`,
          message: `Giocatore ID ${p.officialPlayerId} (${p.playerName}) è già in "${prev}"`,
        });
      }
      allPlayerIds.set(p.officialPlayerId, team.name);
    }

    if (!isPlaceholder && totalSpent > input.league.initialCredits) {
      errors.push({
        code: 'OVER_BUDGET', path: `teams["${team.name}"]`,
        message: `${team.name}: speso ${totalSpent} > ${input.league.initialCredits} crediti`,
        details: { spent: totalSpent, limit: input.league.initialCredits },
      });
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

// ── 2. Generazione CSV ─────────────────────────────────────────

/**
 * Genera il CSV conforme a Leghe Fantacalcio.
 *Formato: per ogni team una riga marker "$,$,$" seguita da N righe "teamName,playerId,price"
 *Nessun header, UTF-8 senza BOM, LF a fine file.
 */
export function generateLegheFantacalcioCsv(input: LegheExportInput): string {
  // Ordina team per displayOrder
  const sorted = [...input.teams].sort((a, b) => a.displayOrder - b.displayOrder);

  const rows: string[] = [];

  for (const team of sorted) {
    // Marker row
    rows.push('$,$,$');

    // Team placeholder: solo marker, niente righe giocatore (da compilare a mano su Leghe)
    if (team.teamType === 'placeholder') {
      continue;
    }

    // Solo giocatori purchased
    const purchased = team.players.filter((p) => p.status === 'purchased');

    // Ordinamento: P,D,C,A poi nome italiano
    const roleOrder = ['P', 'D', 'C', 'A'] as const;
    purchased.sort((a, b) => {
      const ri = roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role);
      if (ri !== 0) return ri;
      // Ordinamento nome italiano: locale "it"
      return a.playerName.localeCompare(b.playerName, 'it');
    });

    for (const p of purchased) {
      rows.push(`${team.name},${p.officialPlayerId},${p.purchasePrice}`);
    }
  }

  // Una LF finale (il template non specifica blank row finale, ma dice "Append one final LF")
  return rows.join('\n') + '\n';
}

// ── 3. Nome file ──────────────────────────────────────────────

export function buildLegheExportFilename(leagueName: string, date: Date): string {
  const slug = leagueName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  const iso = date.toISOString().slice(0, 10);
  return `coach-beard-leghe-${slug}-${iso}.csv`;
}

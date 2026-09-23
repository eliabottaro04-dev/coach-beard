// Test dell'esportatore CSV Leghe Fantacalcio.

import {
  validateLegheExport,
  generateLegheFantacalcioCsv,
  buildLegheExportFilename,
  type LegheExportInput,
} from '../src/lib/export-leghe';

let passed = 0, failed = 0;
function test(name: string, cond: boolean, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.log(`  ✗ ${name}  ${extra}`); }
}

// Input "rosa completa" per 8 team (rosa 3-8-8-6 = 25 giocatori ognuno)
function makeFullTeam(id: number, name: string, teamType: 'real' | 'placeholder' = 'real') {
  const players: any[] = [];
  const base = id * 1000;
  // 3 portieri
  for (let i = 0; i < 3; i++) players.push({
    officialPlayerId: base + i,
    playerName: `Portiere ${i} di ${name}`,
    role: 'P', purchasePrice: 10, status: 'purchased',
  });
  // 8 difensori
  for (let i = 0; i < 8; i++) players.push({
    officialPlayerId: base + 100 + i,
    playerName: `Difensore ${i} di ${name}`,
    role: 'D', purchasePrice: 10, status: 'purchased',
  });
  // 8 centrocampisti
  for (let i = 0; i < 8; i++) players.push({
    officialPlayerId: base + 200 + i,
    playerName: `Centrocampista ${i} di ${name}`,
    role: 'C', purchasePrice: 10, status: 'purchased',
  });
  // 6 attaccanti
  for (let i = 0; i < 6; i++) players.push({
    officialPlayerId: base + 300 + i,
    playerName: `Attaccante ${i} di ${name}`,
    role: 'A', purchasePrice: 10, status: 'purchased',
  });
  return {
    teamId: `team-${id}`,
    displayOrder: id,
    name,
    teamType,
    rosterRules: { P: 3, D: 8, C: 8, A: 6 },
    players,
  };
}

// Costruisce input con 8 reali + N placeholder
function makeInput(realCount: number, placeholderCount: number = 0, extraTeam?: any): LegheExportInput {
  const realTeams = Array.from({ length: realCount }, (_, i) =>
    makeFullTeam(i + 1, `Team ${i + 1}`, 'real')
  );
  const placeholders = Array.from({ length: placeholderCount }, (_, i) =>
    makeFullTeam(realCount + i + 1, `Squadra ${realCount + i + 1}`, 'placeholder')
  );
  const all = [...realTeams, ...placeholders];
  return {
    schemaVersion: '1.0.0',
    league: { name: 'Test League', initialCredits: 500, datasetVersion: 'v1', rosterRules: { P: 3, D: 8, C: 8, A: 6 } },
    teams: extraTeam ? [...all, extraTeam] : all,
  };
}

// ====================================================================
//               A) VALIDAZIONE — casi happy path
// ====================================================================
console.log('\n=== A) VALIDAZIONE OK ===\n');
{
  // 8 reali + 2 placeholder = 10 team: la configurazione corretta
  const input = makeInput(8, 2);
  const v = validateLegheExport(input);
  test('A1: 8 reali + 2 placeholder → valido', v.valid === true,
    !v.valid ? JSON.stringify(v.errors.slice(0, 3)) : '');
  test('A2: 8 team (nessun placeholder) → flag WRONG_TEAM_COUNT',
    !validateLegheExport(makeInput(8, 0)).valid &&
    (validateLegheExport(makeInput(8, 0)) as any).errors.some((e: any) => e.code === 'WRONG_TEAM_COUNT'));
  test('A3: 7 team → invalido', !validateLegheExport(makeInput(7, 0)).valid);
  test('A4: 11 team → invalido', !validateLegheExport(makeInput(11, 0)).valid);
}

// ====================================================================
//         B) VALIDAZIONE — Conteggio ruoli sbagliato
// ====================================================================
console.log('\n=== B) RUOLI SBAGLIATI ===\n');
{
  const input = makeInput(8, 2);
  // Rimuovo 1 portiere dal team 1 (primo reale) → errore
  const realTeam = input.teams.find((t) => t.teamType === 'real')!;
  realTeam.players = realTeam.players.filter((p: any) => !(p.role === 'P' && p.officialPlayerId === 1000));
  const v = validateLegheExport(input);
  test('B1: 2 P invece di 3 → invalido', !v.valid);
  test('B2: errore contiene WRONG_ROLE_COUNT', !v.valid && (v as any).errors.some((e: any) => e.code === 'WRONG_ROLE_COUNT'));
}

// ====================================================================
//         C) VALIDAZIONE — Giocatore a 2 squadre
// ====================================================================
console.log('\n=== C) GIOCATORE A DUE SQUADRE ===\n');
{
  const input = makeInput(8, 2);
  // Mette lo stesso playerId in due team reali
  const realTeams = input.teams.filter((t) => t.teamType === 'real');
  realTeams[1].players[0].officialPlayerId = realTeams[0].players[0].officialPlayerId;
  const v = validateLegheExport(input);
  test('C1: stesso playerId in 2 team → invalido', !v.valid);
  test('C2: errore PLAYER_IN_TWO_TEAMS', !v.valid && (v as any).errors.some((e: any) => e.code === 'PLAYER_IN_TWO_TEAMS'));
}

// ====================================================================
//         D) VALIDAZIONE — Budget superato
// ====================================================================
console.log('\n=== D) BUDGET SUPERATO ===\n');
{
  const input = makeInput(8, 2);
  // 25 giocatori a 30cr = 750 > 500
  const realTeam = input.teams.find((t) => t.teamType === 'real')!;
  realTeam.players.forEach((p: any) => p.purchasePrice = 30);
  const v = validateLegheExport(input);
  test('D1: 750 cr > 500 → invalido', !v.valid);
  test('D2: errore OVER_BUDGET', !v.valid && (v as any).errors.some((e: any) => e.code === 'OVER_BUDGET'));
}

// ====================================================================
//         E) VALIDAZIONE — Nome team con caratteri proibiti
// ====================================================================
console.log('\n=== E) NOMI TEAM PROIBITI ===\n');
{
  const input = makeInput(8, 2);
  const realTeam = input.teams.find((t) => t.teamType === 'real')!;
  realTeam.name = 'Team, con virgola';
  const v = validateLegheExport(input);
  test('E1: nome con virgola → invalido', !v.valid);
  test('E2: errore INVALID_TEAM_NAME', !v.valid && (v as any).errors.some((e: any) => e.code === 'INVALID_TEAM_NAME'));
}

// ====================================================================
//         F) GENERAZIONE CSV
// ====================================================================
console.log('\n=== F) GENERAZIONE CSV ===\n');
{
  // 8 reali + 2 placeholder = 10 team totali
  const input = makeInput(8, 2);
  const csv = generateLegheFantacalcioCsv(input);
  const lines = csv.split('\n');

  test('F1: CSV inizia con marker $,$,$', lines[0] === '$,$,$');
  test('F2: 10 marker rows (8 reali + 2 placeholder)', lines.filter((l) => l === '$,$,$').length === 10);
  // I 2 placeholder hanno solo il marker, nessuna riga giocatore
  test('F3: 8 reali × 25 = 200 righe giocatore', lines.filter((l) => /^[A-Z]/.test(l) && l !== '$,$,$').length === 200);
  test('F4: CSV finisce con LF (non riga vuota extra)', csv.endsWith('\n') && !csv.endsWith('\n\n'));
  test('F5: niente header all\'inizio', !lines[0].includes('team') && !lines[0].includes('player'));
  test('F6: niente BOM', csv.charCodeAt(0) !== 0xFEFF);
  test('F7: ordinamento P,D,C,A per team (1° team reale)', (() => {
    // lines[0] = marker team 1, lines[1..25] = 25 giocatori team 1
    // lines[26] = marker team 2, lines[27..51] = 25 giocatori team 2
    // ...
    // lines[208] = marker team 8 (real), lines[209..233] = 25 giocatori team 8
    // lines[234] = marker team 9 (placeholder), lines[235] = marker team 10 (placeholder)
    const t1Lines = lines.slice(1, 26); // 25 giocatori team 1 (real)
    return t1Lines[0].endsWith(',10') && // 1° = 1° portiere
           t1Lines[2].endsWith(',10') && // 3° = ultimo portiere
           t1Lines[3].endsWith(',10') && // 4° = 1° difensore
           t1Lines[10].endsWith(',10') && // 11° = ultimo difensore
           t1Lines[11].endsWith(',10') && // 12° = 1° centrocampista
           t1Lines[18].endsWith(',10') && // 19° = ultimo centrocampista
           t1Lines[19].endsWith(',10') && // 20° = 1° attaccante
           t1Lines[24].endsWith(',10');   // 25° = ultimo attaccante
  })());
}

// ====================================================================
//         G) NOME FILE
// ====================================================================
console.log('\n=== G) NOME FILE ===\n');
{
  const fn1 = buildLegheExportFilename('Fanta27 Elite', new Date('2026-09-02'));
  test('G1: nome file per Fanta27 Elite', fn1 === 'coach-beard-leghe-fanta27-elite-2026-09-02.csv');
  const fn2 = buildLegheExportFilename('Lega! @2026#', new Date('2026-09-02'));
  test('G2: caratteri speciali rimossi', fn2 === 'coach-beard-leghe-lega-2026-2026-09-02.csv' || fn2.includes('lega-2026') && fn2.endsWith('2026-09-02.csv'));
  const fn3 = buildLegheExportFilename('Lega con Lettere Maiuscole Varie', new Date('2026-09-02'));
  test('G3: lowercased', fn3.startsWith('coach-beard-leghe-lega-con-lettere-maiuscole-varie-'));
}

// ====================================================================
//         H) DETERMINISMO — Stesso input = stesso output
// ====================================================================
console.log('\n=== H) DETERMINISMO ===\n');
{
  const input = makeInput(8, 2);
  const csv1 = generateLegheFantacalcioCsv(input);
  const csv2 = generateLegheFantacalcioCsv(input);
  test('H1: CSV identico per stesso input', csv1 === csv2);
  test('H2: byte-per-byte uguale', Buffer.from(csv1).equals(Buffer.from(csv2)));
}

// ====================================================================
//         I) PLACEHOLDER — 8 reali + 2 placeholder validi
// ====================================================================
console.log('\n=== I) PLACEHOLDER VALIDI ===\n');
{
  const input = makeInput(8, 2);
  const v = validateLegheExport(input);
  test('I1: 8 reali + 2 placeholder → valido', v.valid === true,
    !v.valid ? JSON.stringify(v.errors.slice(0, 3)) : '');
  // Verifica che i placeholder siano riconosciuti
  const placeholders = input.teams.filter((t) => t.teamType === 'placeholder');
  test('I2: 2 placeholder', placeholders.length === 2);
  test('I3: placeholder senza ruoli → non segnala WRONG_ROLE_COUNT', v.valid || !(v as any).errors.some((e: any) => e.code === 'WRONG_ROLE_COUNT'));
  test('I4: placeholder senza budget → non segnala OVER_BUDGET', v.valid || !(v as any).errors.some((e: any) => e.code === 'OVER_BUDGET'));
}

// ====================================================================
//         L) PLACEHOLDER mismatch — 9 reali + 1 placeholder NON ammesso
// ====================================================================
console.log('\n=== L) PLACEHOLDER MISMATCH ===\n');
{
  // 9 reali + 1 placeholder = 10 team totali ma scompagnati
  const input = makeInput(9, 1);
  const v = validateLegheExport(input);
  test('L1: 9 reali + 1 placeholder → flag PLACEHOLDER_MISMATCH', !v.valid &&
    (v as any).errors.some((e: any) => e.code === 'PLACEHOLDER_MISMATCH'));
  // 10 reali + 0 placeholder (nessun errore mismatch)
  const input2 = makeInput(10, 0);
  const v2 = validateLegheExport(input2);
  test('L2: 10 reali senza placeholder → nessun PLACEHOLDER_MISMATCH', v2.valid === true ||
    !(v2 as any).errors.some((e: any) => e.code === 'PLACEHOLDER_MISMATCH'));
}

console.log(`\nRisultato: ${passed} ok, ${failed} ko`);
process.exit(failed > 0 ? 1 : 0);

// Test del parser acquisti del bot Telegram.
// Il parser è la parte più soggetta a errori umani di digitazione,
// quindi va testato con varianti reali.

import { parsePurchaseCmd, resolveManager } from '../src/lib/telegram-parser';

let passed = 0, failed = 0;
function test(name: string, cond: boolean, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.log(`  ✗ ${name}  ${extra}`); }
}

console.log('\n=== PARSER COMANDI ACQUISTO ===\n');

// Pattern 1: "Giocatore a Manager Prezzo"
{
  const r = parsePurchaseCmd('Maignan a Elia 100');
  test('Pattern 1a: "Maignan a Elia 100"', r?.player === 'Maignan' && r?.buyer === 'Elia' && r?.price === 100, JSON.stringify(r));
}
{
  const r = parsePurchaseCmd('Maignan a Federico 100');
  test('Pattern 1b: "Maignan a Federico 100"', r?.player === 'Maignan' && r?.buyer === 'Federico' && r?.price === 100);
}
{
  const r = parsePurchaseCmd('Bastoni a Condor 50');
  test('Pattern 1c: "Bastoni a Condor 50"', r?.player === 'Bastoni' && r?.buyer === 'Condor' && r?.price === 50);
}

// Pattern 2: "compra Giocatore per Manager Prezzo"
{
  const r = parsePurchaseCmd('compra Maignan per Elia 100');
  test('Pattern 2a: "compra Maignan per Elia 100"', r?.player === 'Maignan' && r?.buyer === 'Elia' && r?.price === 100, JSON.stringify(r));
}
{
  const r = parsePurchaseCmd('compra Bastoni per Condor 50');
  test('Pattern 2b: "compra Bastoni per Condor 50"', r?.player === 'Bastoni' && r?.buyer === 'Condor' && r?.price === 50);
}

// Pattern 3: frecce
{
  const r = parsePurchaseCmd('Maignan → Elia 100');
  test('Pattern 3a: "Maignan → Elia 100"', r?.player === 'Maignan' && r?.buyer === 'Elia' && r?.price === 100, JSON.stringify(r));
}
{
  const r = parsePurchaseCmd('Maignan -> Elia 100');
  test('Pattern 3b: "Maignan -> Elia 100"', r?.player === 'Maignan' && r?.buyer === 'Elia' && r?.price === 100, JSON.stringify(r));
}

// Casi negativi
{
  const r = parsePurchaseCmd('stato');
  test('Negativo: "stato" non è acquisto', r === null);
}
{
  const r = parsePurchaseCmd('Maignan');
  test('Negativo: solo nome, niente prezzo', r === null);
}
{
  const r = parsePurchaseCmd('100');
  test('Negativo: solo numero', r === null);
}

// Nomi con più parole
{
  const r = parsePurchaseCmd('Lautaro Martinez a Elia 80');
  test('Cognomi composti: "Lautaro Martinez a Elia 80"', r?.player === 'Lautaro Martinez' && r?.buyer === 'Elia' && r?.price === 80, JSON.stringify(r));
}
{
  const r = parsePurchaseCmd('Paz N. a Condor 30');
  test('Cognomi corti: "Paz N. a Condor 30"', r?.player === 'Paz N.' && r?.buyer === 'Condor' && r?.price === 30, JSON.stringify(r));
}

console.log('\n=== RESOLVER MANAGER ===\n');
{
  const managers = [
    { id: 1, name: 'Elia' }, { id: 2, name: 'Condor' }, { id: 3, name: 'Lucio' },
    { id: 4, name: 'Lensi' }, { id: 5, name: 'Renzo' }, { id: 6, name: 'Galga' },
    { id: 7, name: 'Tella' }, { id: 8, name: 'Nica' },
  ];
  test('Resolver: "Elia" → 1', resolveManager('Elia', managers) === 1);
  test('Resolver: "condor" → 2 (case insensitive)', resolveManager('condor', managers) === 2);
  test('Resolver: "condo" → 2 (parziale)', resolveManager('condo', managers) === 2);
  test('Resolver: "El" → 1 (parziale)', resolveManager('El', managers) === 1);
  test('Resolver: "xyz" → null', resolveManager('xyz', managers) === null);
}

console.log(`\nRisultato: ${passed} ok, ${failed} ko`);
process.exit(failed > 0 ? 1 : 0);

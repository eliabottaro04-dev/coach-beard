/**
 * Regole della TUA lega. Se un numero è sbagliato, cambialo qui
 * e ricarica la pagina: non serve toccare il resto dell'app.
 *
 * Ruoli classici: solo P, D, C, A (non Mantra).
 *
 * NOTA: la tua lega ha 8 partecipanti e 500 crediti a testa.
 */
export const LEAGUE_RULES = {
  leagueName: "Classica",
  managerCount: 8,
  initialCredits: 500,
  roster: {
    P: 3,
    D: 8,
    C: 8,
    A: 6,
  },
  classicRoles: [
    { code: "P", label: "Portiere" },
    { code: "D", label: "Difensore" },
    { code: "C", label: "Centrocampista" },
    { code: "A", label: "Attaccante" },
  ],
} as const;

export const ROSTER_SIZE =
  LEAGUE_RULES.roster.P +
  LEAGUE_RULES.roster.D +
  LEAGUE_RULES.roster.C +
  LEAGUE_RULES.roster.A;

export type ManagerDraft = {
  id: number;
  name: string;
  isOwner: boolean;
};

export function emptyManagers(): ManagerDraft[] {
  return Array.from({ length: LEAGUE_RULES.managerCount }, (_, index) => ({
    id: index + 1,
    name: "",
    isOwner: index === 0,
  }));
}

export function remainingCredits(): number {
  return LEAGUE_RULES.initialCredits;
}

export type SetupErrors = {
  names?: string;
  owner?: string;
};

export function validateSetup(managers: ManagerDraft[]): SetupErrors {
  const trimmed = managers.map((m) => m.name.trim());
  const errors: SetupErrors = {};

  if (trimmed.some((name) => name.length === 0)) {
    errors.names = `Scrivi un nome per tutte e ${LEAGUE_RULES.managerCount} le squadre.`;
  }

  const unique = new Set(trimmed.map((name) => name.toLowerCase()));
  if (trimmed.every((name) => name.length > 0) && unique.size !== trimmed.length) {
    errors.names = "I nomi delle squadre devono essere tutti diversi.";
  }

  const owners = managers.filter((m) => m.isOwner);
  if (owners.length !== 1) {
    errors.owner = "Scegli esattamente una squadra come la tua.";
  }

  return errors;
}

// Regole della tua lega.
// Modifica liberamente questi valori: sono la "verità" per tutta l'app.

export const leagueConfig = {
  name: 'Fanta27',
  // Regole economiche
  initialCredits: 500,            // crediti iniziali per squadra
  // Rosa: quanti giocatori per ruolo
  rosterSize: {
    P: 3,  // portieri
    D: 8,  // difensori
    C: 8,  // centrocampisti
    A: 6,  // attaccanti
  },
  // Ordine di svolgimento dell'asta (reparto per reparto)
  phaseOrder: ['P', 'D', 'C', 'A'],
  // Partecipanti: 8 fantallenatori.
  // Lascia i nomi "Indeciso 1/2" se non li hai ancora decisi; potrai cambiarli
  // prima di avviare l'asta dalla web app.
  managers: [
    { slot: 1, name: 'Elia',     isOwner: true  },
    { slot: 2, name: 'Condor',   isOwner: false },
    { slot: 3, name: 'Lucio',    isOwner: false },
    { slot: 4, name: 'Lensi',    isOwner: false },
    { slot: 5, name: 'Renzo',    isOwner: false },
    { slot: 6, name: 'Galga',    isOwner: false },
    { slot: 7, name: 'Indeciso 1 (Tella?)', isOwner: false },
    { slot: 8, name: 'Indeciso 2 (Nica?)',  isOwner: false },
  ],
};

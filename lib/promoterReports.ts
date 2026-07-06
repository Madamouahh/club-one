// lib/promoterReports.ts — logique PURE du reporting de CONTRIBUTION PAR PROMOTEUR. 100% testable.
//
// Corrige le rapport de contribution promoteurs qui utilisait une LISTE EN DUR
// ["mathias","quentin","lawrence"] dans app/page.tsx (audit G1 PARTIAL) : un promoteur hors liste
// n'apparaissait JAMAIS. Ici le jeu de promoteurs est dérivé DYNAMIQUEMENT des données — UNION des
// promoteurs de tables (assignedTo / owner_promoter) et des promoter_username des entrées invités.
// EXPLICITEMENT AUCUNE liste de noms codée en dur.
//
// Attribution honnête : le CA d'un promoteur = somme des dépenses de SES tables (déduplication par id
// de dépense, aucune double-comptabilisation entre tables liées). Aucun CA fabriqué, aucun invité inventé.
//
// Discipline montants : entiers. L'unité est celle des ExpenseItem.amount fournis (centimes en cible
// produit ; page.tsx stocke aujourd'hui des euros entiers — voir note d'intégration).

// ————————————————————————————————————————————————————————————————
// Entrées (types mappés depuis ClubTable / promoter_guest_entries de page.tsx)
// ————————————————————————————————————————————————————————————————

export type PromoterReportExpense = {
  id?: string | null;
  amount?: number | string | null;
};

export type PromoterReportTable = {
  id: string;
  // Promoteur propriétaire de la table. Mapper depuis ClubTable.assignedTo (ou owner_promoter).
  // Vide/absent = table non attribuée (n'entre pas dans le jeu de promoteurs).
  promoter?: string | null;
  expenses?: PromoterReportExpense[] | null;
};

// Ligne promoter_guest_entries : un invité amené par un promoteur pour une soirée.
export type PromoterReportGuestEntry = {
  promoter_username?: string | null;
  checked_in?: boolean | null;
};

export type PromoterReportOptions = {
  // Réservé pour extensions futures (filtres de date, etc.). Aucun comportement obligatoire aujourd'hui.
};

// ————————————————————————————————————————————————————————————————
// Sortie
// ————————————————————————————————————————————————————————————————

export type PromoterReportRow = {
  promoter: string;
  caCents: number; // CA attribué = somme des dépenses de ses tables (déduplication par id)
  tablesAssigned: number; // nb de tables DISTINCTES qui lui sont assignées
  guestsBrought: number; // nb d'entrées invités enregistrées à son nom
  guestsCheckedIn: number; // sous-ensemble effectivement pointé (checked_in) — jamais > guestsBrought
};

function cleanId(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function amountToInt(amount: number | string | null | undefined): number {
  const n = Number(amount);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

type PromoterAccumulator = {
  promoter: string;
  tableIds: Set<string>;
  caCents: number;
  guestsBrought: number;
  guestsCheckedIn: number;
};

// Construit le rapport de contribution par promoteur. Jeu de promoteurs = UNION dynamique des
// promoteurs de tables et des promoter_username d'entrées. Trié par CA décroissant, départage par nom.
export function buildPromoterReport(
  tables: PromoterReportTable[],
  entries: PromoterReportGuestEntry[],
  _opts: PromoterReportOptions = {},
): PromoterReportRow[] {
  const acc = new Map<string, PromoterAccumulator>();
  const get = (promoter: string): PromoterAccumulator => {
    let a = acc.get(promoter);
    if (!a) {
      a = {
        promoter,
        tableIds: new Set<string>(),
        caCents: 0,
        guestsBrought: 0,
        guestsCheckedIn: 0,
      };
      acc.set(promoter, a);
    }
    return a;
  };

  const seenExpenseIds = new Set<string>();
  const seenTableKeys = new Set<string>();

  for (const table of tables || []) {
    const promoter = cleanId(table.promoter);
    if (!promoter) continue;
    const a = get(promoter);

    const tableId = cleanId(table.id) ?? table.id;
    const tableKey = `${promoter} ${tableId}`;
    if (!seenTableKeys.has(tableKey)) {
      seenTableKeys.add(tableKey);
      a.tableIds.add(tableId);
    }

    for (const expense of table.expenses || []) {
      const expId = cleanId(expense?.id);
      if (expId) {
        if (seenExpenseIds.has(expId)) continue;
        seenExpenseIds.add(expId);
      }
      a.caCents += amountToInt(expense?.amount);
    }
  }

  for (const entry of entries || []) {
    const promoter = cleanId(entry?.promoter_username);
    if (!promoter) continue;
    const a = get(promoter);
    a.guestsBrought += 1;
    if (entry.checked_in === true) a.guestsCheckedIn += 1;
  }

  const rows: PromoterReportRow[] = [...acc.values()].map((a) => ({
    promoter: a.promoter,
    caCents: a.caCents,
    tablesAssigned: a.tableIds.size,
    guestsBrought: a.guestsBrought,
    guestsCheckedIn: a.guestsCheckedIn,
  }));

  rows.sort((x, y) => {
    if (y.caCents !== x.caCents) return y.caCents - x.caCents;
    return x.promoter.localeCompare(y.promoter, "fr");
  });

  return rows;
}

// lib/promoterReports.ts — logique PURE du reporting de CONTRIBUTION PAR PROMOTEUR. 100% testable.
//
// Corrige le rapport de contribution promoteurs. Vague 1 avait déjà supprimé la LISTE EN DUR
// ["mathias","quentin","lawrence"] mais dérivait encore le jeu de promoteurs de `assignedTo` par
// HEURISTIQUE — fragile (audit fondateur Vague 2). CORRECTIF : le jeu de promoteurs est désormais
// role-authoritative — un promoteur = un username de rôle `promoter` au ROSTER (staff_users via
// staff_roster_v1, migration 0060). Conséquences :
//   · un promoteur identifié par RÔLE apparaît dès qu'il a une table ou un invité — même hors de toute
//     liste historique ;
//   · un assigné qui N'EST PAS promoteur au roster (ex. une table `assigned_to` un admin/serveur) N'entre
//     PAS dans le rapport de contribution promoteur — son CA n'est pas compté comme CA promoteur (honnête).
//
// Attribution honnête : le CA d'un promoteur = somme des dépenses de SES tables (déduplication par id de
// dépense, aucune double-comptabilisation entre tables liées). Aucun CA fabriqué, aucun invité inventé.
//
// Discipline montants : entiers. L'unité est celle des ExpenseItem.amount fournis (centimes en cible
// produit ; page.tsx stocke aujourd'hui des euros entiers — voir note d'intégration).

// ————————————————————————————————————————————————————————————————
// Entrées
// ————————————————————————————————————————————————————————————————

// Ligne de roster (username→role). Mapper depuis la RPC staff_roster_v1() (migration 0060).
export type StaffRosterEntry = {
  username?: string | null;
  role?: string | null;
};

export type PromoterReportExpense = {
  id?: string | null;
  amount?: number | string | null;
};

export type PromoterReportTable = {
  id: string;
  // Assigné de la table (mapper depuis ClubTable.assignedTo). N'est retenu comme promoteur QUE si son
  // rôle au roster est `promoter` ; sinon la table est ignorée du rapport promoteur. Vide/absent = ignorée.
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

// Ensemble des usernames ayant EXACTEMENT ce rôle au roster (autorité de rôle, fail-closed).
function usernamesWithRole(roster: StaffRosterEntry[] | null | undefined, role: string): Set<string> {
  const set = new Set<string>();
  for (const entry of roster || []) {
    const username = cleanId(entry?.username);
    if (username && entry?.role === role) set.add(username);
  }
  return set;
}

type PromoterAccumulator = {
  promoter: string;
  tableIds: Set<string>;
  caCents: number;
  guestsBrought: number;
  guestsCheckedIn: number;
};

// Construit le rapport de contribution par promoteur. Jeu de promoteurs = role-authoritative (usernames de
// rôle `promoter` au roster) ayant au moins une table attribuée OU un invité. Trié par CA décroissant,
// départage par nom (déterministe).
export function buildPromoterReport(
  roster: StaffRosterEntry[],
  tables: PromoterReportTable[],
  entries: PromoterReportGuestEntry[],
  _opts: PromoterReportOptions = {},
): PromoterReportRow[] {
  const promoterRoleSet = usernamesWithRole(roster, "promoter");

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
    if (!promoter || !promoterRoleSet.has(promoter)) continue; // role-authoritative : non-promoteur → ignoré
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
    if (!promoter || !promoterRoleSet.has(promoter)) continue; // role-authoritative
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

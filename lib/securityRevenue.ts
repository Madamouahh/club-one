export type SecurityRevenueTable = {
  id: string;
  linkedGroupId?: string | null;
  linkedTables?: string[] | null;
  expenses?: Array<{ amount?: number | string | null }> | null;
};

function tableRevenue(table: SecurityRevenueTable): number {
  return (table.expenses || []).reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0);
}

function revenueGroupKey(table: SecurityRevenueTable): string {
  if (table.linkedGroupId) return table.linkedGroupId;
  if (table.linkedTables?.length) {
    return [table.id, ...table.linkedTables].sort().join("+");
  }
  return table.id;
}

export function securityRevenueByCanonicalRow(tables: SecurityRevenueTable[]): Record<string, number> {
  const groups = new Map<string, SecurityRevenueTable[]>();
  for (const table of tables) {
    const key = revenueGroupKey(table);
    groups.set(key, [...(groups.get(key) || []), table]);
  }

  const revenueByTableId: Record<string, number> = {};
  for (const table of tables) {
    revenueByTableId[table.id] = 0;
  }

  for (const groupTables of groups.values()) {
    const canonical = [...groupTables].sort((a, b) => a.id.localeCompare(b.id, "fr", { numeric: true }))[0];
    revenueByTableId[canonical.id] = groupTables.reduce((sum, table) => sum + tableRevenue(table), 0);
  }

  return revenueByTableId;
}

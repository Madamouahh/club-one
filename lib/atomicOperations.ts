export type AtomicExpenseCode =
  | "ok"
  | "invalid_table_id"
  | "invalid_amount"
  | "amount_too_high"
  | "invalid_date"
  | "unauthorized"
  | "table_not_found_or_forbidden"
  | "network_error"
  | "unexpected_response";

export type AtomicExpenseResult = {
  ok: boolean;
  code: AtomicExpenseCode | string;
  message?: string | null;
  table_id?: string | null;
  expense?: unknown;
};

export type CheckInCode =
  | "checked_in"
  | "invalid_token"
  | "unknown_token"
  | "wrong_date"
  | "already_used"
  | "unauthorized"
  | "network_error"
  | "unexpected_response";

export type CheckInResult = {
  ok: boolean;
  code: CheckInCode | string;
  message?: string | null;
  guest_name?: string | null;
  promoter_username?: string | null;
  event_date?: string | null;
};

export type SupabaseRpcResponse<T> = {
  data: T | T[] | null;
  error: { message?: string | null } | null;
};

export function firstRpcRow<T>(data: T | T[] | null | undefined): T | null {
  if (Array.isArray(data)) return data[0] ?? null;
  return data ?? null;
}

export function normalizeExpenseAmount(value: string | number): number | null {
  const amount = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return amount;
}

export function buildAddExpenseArgs(input: {
  tableId: string;
  label: string;
  amount: string | number;
  dateKey: string;
}) {
  const amount = normalizeExpenseAmount(input.amount);
  if (!input.tableId.trim()) {
    return { ok: false as const, message: "Table invalide." };
  }
  if (amount === null) {
    return { ok: false as const, message: "Montant invalide." };
  }

  return {
    ok: true as const,
    args: {
      p_table_id: input.tableId.trim(),
      p_label: input.label.trim() || "Depense libre",
      p_amount: amount,
      p_date_key: input.dateKey,
    },
  };
}

export function normalizeAddExpenseResponse(
  response: SupabaseRpcResponse<AtomicExpenseResult>
): AtomicExpenseResult {
  if (response.error) {
    return {
      ok: false,
      code: "network_error",
      message: response.error.message || "Erreur reseau pendant l'ajout de depense.",
    };
  }

  const row = firstRpcRow(response.data);
  if (!row) {
    return {
      ok: false,
      code: "unexpected_response",
      message: "Reponse Supabase inattendue pendant l'ajout de depense.",
    };
  }

  return row;
}

export function addExpenseMessage(result: AtomicExpenseResult): string {
  if (result.message) return result.message;
  if (result.code === "invalid_amount") return "Montant invalide.";
  if (result.code === "amount_too_high") return "Montant trop eleve.";
  if (result.code === "invalid_date") return "Date de soiree invalide.";
  if (result.code === "unauthorized") return "Utilisateur non autorise.";
  if (result.code === "table_not_found_or_forbidden") return "Table introuvable ou action non autorisee.";
  if (result.code === "network_error") return "Erreur reseau pendant l'ajout de depense.";
  return "Impossible d'ajouter la depense.";
}

export function buildCheckInArgs(input: { token: string; eventDate: string }) {
  const token = input.token.trim();
  if (!token) {
    return { ok: false as const, message: "QR vide ou invalide." };
  }

  return {
    ok: true as const,
    args: {
      p_token: token,
      p_event_date: input.eventDate,
    },
  };
}

export function normalizeCheckInResponse(
  response: SupabaseRpcResponse<CheckInResult>
): CheckInResult {
  if (response.error) {
    return {
      ok: false,
      code: "network_error",
      message: response.error.message || "Erreur reseau pendant la validation QR.",
    };
  }

  const row = firstRpcRow(response.data);
  if (!row) {
    return {
      ok: false,
      code: "unexpected_response",
      message: "Reponse Supabase inattendue pendant la validation QR.",
    };
  }

  return row;
}

export function checkInMessage(result: CheckInResult): string {
  if (result.ok) {
    const guest = result.guest_name ? ` : ${result.guest_name}` : "";
    const promoter = result.promoter_username ? ` - ${result.promoter_username}` : "";
    return `Entree validee${guest}${promoter}`;
  }

  if (result.message) {
    if (result.code === "wrong_date" && result.event_date) {
      return `${result.message} (${result.event_date}).`;
    }
    if (result.code === "already_used" && result.guest_name) {
      return `${result.message} ${result.guest_name}.`;
    }
    return result.message;
  }

  if (result.code === "unknown_token") return "QR introuvable ou invalide.";
  if (result.code === "already_used") return "QR deja utilise.";
  if (result.code === "wrong_date") return "QR valide mais pas pour cette soiree.";
  if (result.code === "unauthorized") return "Utilisateur non autorise.";
  if (result.code === "network_error") return "Erreur reseau pendant la validation QR.";
  return "Impossible de valider le QR.";
}

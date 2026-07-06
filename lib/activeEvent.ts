export type ActiveEventContext = {
  eventId: string;
  eventDate: string;
  title: string | null;
  status: "active" | "missing";
  // Univers de la soirée (get_active_event_context, migration 0052 — ex-0032) : 'eden' | 'terminus' | 'cercle' | … — pilote le layout du plan.
  venueId: string | null;
  venueName: string | null;
};

export type ActiveEventRuntimeContext = {
  activeEvent: ActiveEventContext | null;
  bootstrapCompleted: boolean;
  bootstrapCompletedAt: string | null;
  lastClosedEventId: string | null;
};

export type ActiveEventCandidate = {
  id: string;
  title: string;
  eventDate: string;
  status: string;
  venueId: string | null;
  venueName: string | null;
};

export type ActiveEventActionResult = {
  ok: boolean;
  code: string;
  message: string;
  eventId: string | null;
  eventDate: string | null;
};

export type ActiveEventLifecycleAction = "bootstrap" | "activate" | "none";

export type SecurityTableSnapshot = {
  id: string;
  zone: string;
  status: string;
  client: string | null;
  phone: string | null;
  people: string | null;
  notes: string | null;
  event_date: string | null;
  event_id: string | null;
  revenue_total: number;
};

type RpcClient = {
  rpc: (name: string, args?: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: { message?: string | null } | null;
  }>;
};

function firstRow<T>(value: unknown): T | null {
  if (Array.isArray(value)) return (value[0] as T | undefined) ?? null;
  return (value as T | null) ?? null;
}

export async function loadActiveEventContext(client: RpcClient): Promise<ActiveEventContext | null> {
  const runtime = await loadActiveEventRuntimeContext(client);
  return runtime.activeEvent;
}

export async function loadActiveEventRuntimeContext(client: RpcClient): Promise<ActiveEventRuntimeContext> {
  const { data, error } = await client.rpc("get_active_event_context");
  if (error) throw new Error(error.message || "Evenement actif indisponible.");

  const row = firstRow<{
    event_id?: string | null;
    event_date?: string | null;
    title?: string | null;
    bootstrap_completed?: boolean | null;
    bootstrap_completed_at?: string | null;
    last_closed_event_id?: string | null;
    venue_id?: string | null;
    venue_name?: string | null;
  }>(data);

  if (!row?.event_id || !row.event_date) {
    return {
      activeEvent: null,
      bootstrapCompleted: row?.bootstrap_completed === true,
      bootstrapCompletedAt: row?.bootstrap_completed_at ?? null,
      lastClosedEventId: row?.last_closed_event_id ?? null,
    };
  }

  return {
    activeEvent: {
      eventId: row.event_id,
      eventDate: row.event_date,
      title: row.title ?? null,
      status: "active",
      venueId: row.venue_id ?? null,
      venueName: row.venue_name ?? null,
    },
    bootstrapCompleted: row.bootstrap_completed === true,
    bootstrapCompletedAt: row.bootstrap_completed_at ?? null,
    lastClosedEventId: row.last_closed_event_id ?? null,
  };
}

export async function loadSecurityTableSnapshot(client: RpcClient): Promise<SecurityTableSnapshot[]> {
  const { data, error } = await client.rpc("get_security_table_snapshot");
  if (error) throw new Error(error.message || "Projection securite indisponible.");
  return (Array.isArray(data) ? data : []) as SecurityTableSnapshot[];
}

export async function loadActivatableClubEvents(client: RpcClient): Promise<ActiveEventCandidate[]> {
  const { data, error } = await client.rpc("list_activatable_club_events");
  if (error) throw new Error(error.message || "Evenements activables indisponibles.");

  return (Array.isArray(data) ? data : []).map((row) => {
    const item = row as {
      id?: string | null;
      title?: string | null;
      event_date?: string | null;
      status?: string | null;
      venue_id?: string | null;
      venue_name?: string | null;
    };

    return {
      id: item.id || "",
      title: item.title || "Evenement sans titre",
      eventDate: item.event_date || "",
      status: item.status || "",
      venueId: item.venue_id ?? null,
      venueName: item.venue_name ?? null,
    };
  }).filter((event) => event.id && event.eventDate);
}

export async function bootstrapClubEvent(client: RpcClient, eventId: string): Promise<ActiveEventActionResult> {
  return runActiveEventAction(client, "bootstrap_club_event_v2", eventId);
}

export async function activateClubEvent(client: RpcClient, eventId: string): Promise<ActiveEventActionResult> {
  return runActiveEventAction(client, "activate_club_event_v2", eventId);
}

export async function closeClubEvent(client: RpcClient): Promise<ActiveEventActionResult> {
  const { data, error } = await client.rpc("close_club_event_v2");
  if (error) throw new Error(error.message || "Cloture de soiree indisponible.");
  return normalizeActiveEventAction(data);
}

export function requireActiveEvent(context: ActiveEventContext | null): ActiveEventContext {
  if (!context?.eventId || !context.eventDate) {
    throw new Error("Aucun evenement actif fiable n'est configure.");
  }

  return context;
}

export function chooseActiveEventLifecycleAction(input: {
  role: string;
  bootstrapCompleted: boolean;
}): ActiveEventLifecycleAction {
  if (input.role !== "admin" && input.role !== "manager") return "none";
  return input.bootstrapCompleted ? "activate" : "bootstrap";
}

async function runActiveEventAction(
  client: RpcClient,
  rpcName: "bootstrap_club_event_v2" | "activate_club_event_v2",
  eventId: string
): Promise<ActiveEventActionResult> {
  const { data, error } = await client.rpc(rpcName, { p_event_id: eventId });
  if (error) throw new Error(error.message || "Activation de soiree indisponible.");
  return normalizeActiveEventAction(data);
}

function normalizeActiveEventAction(value: unknown): ActiveEventActionResult {
  const row = firstRow<{
    ok?: boolean | null;
    code?: string | null;
    message?: string | null;
    event_id?: string | null;
    event_date?: string | null;
  }>(value);

  return {
    ok: row?.ok === true,
    code: row?.code || "invalid_response",
    message: row?.message || "Reponse Supabase invalide.",
    eventId: row?.event_id ?? null,
    eventDate: row?.event_date ?? null,
  };
}

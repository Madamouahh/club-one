"use client";

// app/_modules/crmboards/ReservationBoardTab.tsx — CONTENEUR autonome (intégrateur) pour le TRAITEMENT
// STAFF des DEMANDES DE RÉSA (D3/E4). Récupère les vraies demandes (table_reservation_requests, migration
// 0025, déjà cantonnées par la RLS : direction voit tout, promoteur voit SES clients), les passe au
// composant PRÉSENTATIONNEL existant <ReservationRequestQueue>, et branche la décision réelle sur la RPC
// SECURITY DEFINER decide_table_reservation_v1 (réservée admin/manager côté SQL).
//
// Même contrat d'appel que les autres conteneurs (StockView/TasksTab) : { supabase, role, username }.
// AUCUNE règle métier dupliquée ici : l'autorité reste la RLS 0025 + la RPC. La garde d'affichage
// (canViewResaRequests) est un confort d'UI qui reflète trr_read, jamais une sécurité.
//
// PÉRIMÈTRE : ce conteneur câble la FILE DE DÉCISION (pending → approved/declined), qui a un backend réel
// (table + RPC). Le « banc de soirée » A3 (components/ReservationBoard : pointage attendu/arrivé/no-show)
// n'a PAS de colonne d'arrivée en 0025 — son pointage resterait non persistant. Il n'est donc PAS monté
// ici : il faut d'abord une table/RPC d'arrivées (migration future) — voir le rapport de session.

import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

import { ReservationRequestQueue } from "@/components/ReservationRequestQueue";
import type { StaffRole } from "@/lib/permissions";
import type { ReservationRequestRow, ResaDecision } from "@/lib/resaRequest";
import {
  RESERVATION_REQUEST_SELECT,
  canViewResaRequests,
  firstDecideResult,
  mapReservationRequestRows,
  type RawReservationRequestRow,
} from "@/app/_modules/crmboards/reservationRequests";

export default function ReservationBoardTab({
  supabase,
  role,
}: {
  supabase: SupabaseClient;
  role: StaffRole;
  username: string;
}) {
  const [requests, setRequests] = useState<ReservationRequestRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { data, error: e } = await supabase
      .from("table_reservation_requests")
      .select(RESERVATION_REQUEST_SELECT)
      .order("created_at", { ascending: true });
    if (e) {
      setError(e.message);
      return;
    }
    setError("");
    setRequests(mapReservationRequestRows((data ?? []) as unknown as RawReservationRequestRow[]));
  }, [supabase]);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data, error: e } = await supabase
        .from("table_reservation_requests")
        .select(RESERVATION_REQUEST_SELECT)
        .order("created_at", { ascending: true });
      if (!active) return;
      if (e) setError(e.message);
      else
        setRequests(
          mapReservationRequestRows((data ?? []) as unknown as RawReservationRequestRow[]),
        );
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [supabase]);

  // Décision réelle : la RPC decide_table_reservation_v1 tranche (RLS admin/manager + garde not_pending).
  // On propage l'échec en lançant (le composant affiche le message) ; en cas de succès, on recharge.
  const onDecide = useCallback(
    async (id: string, decision: ResaDecision, reason: string | null) => {
      const { data, error: e } = await supabase.rpc("decide_table_reservation_v1", {
        p_request_id: id,
        p_decision: decision,
        p_decline_reason: reason,
      });
      if (e) throw new Error(e.message);
      const res = firstDecideResult(data);
      if (res && !res.ok) throw new Error(res.message || "Décision refusée.");
      await load();
    },
    [supabase, load],
  );

  // Garde d'affichage (confort UI, miroir de trr_read). Les rôles hors direction/promoteur n'ont de toute
  // façon aucune ligne via la RLS ; on l'affiche explicitement plutôt qu'une file vide trompeuse.
  if (!canViewResaRequests(role)) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm text-white/50">
        La file des demandes de réservation est réservée à la direction (et au promoteur pour ses propres
        clients). Ce rôle n’y a aucun accès (les demandes contiennent des coordonnées personnelles).
      </div>
    );
  }

  if (loading) {
    return (
      <div className="py-8 text-center text-sm text-white/40">
        Chargement des demandes de réservation…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs font-bold text-red-200">
          {error}
        </div>
      )}
      <ReservationRequestQueue requests={requests} role={role} onDecide={onDecide} />
    </div>
  );
}

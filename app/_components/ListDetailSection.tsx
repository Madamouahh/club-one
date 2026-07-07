"use client";

// ListDetailSection — brique RÉUTILISABLE des sections /dashboard : sous-navigation + liste/tableau +
// filtre + panneau de détail + actions métier réelles + états loading/error/empty. Aucune section
// KPI-only : chaque sous-module charge de vraies lignes (RLS), ouvre un détail et expose au moins une
// action là où une RPC/écriture existe. Composant présentational : les loaders/actions sont fournis.

import { useCallback, useEffect, useMemo, useState } from "react";

export type DetailPair = { label: string; value: string };
export type RowAction = { label: string; tone?: "primary" | "danger"; run: (row: Record<string, unknown>) => Promise<string> };
export type SectionModule = {
  key: string;
  label: string;
  load: () => Promise<Record<string, unknown>[]>;
  rowMain: (r: Record<string, unknown>) => string;
  rowSub?: (r: Record<string, unknown>) => string;
  rowBadge?: (r: Record<string, unknown>) => string | null;
  matches?: (r: Record<string, unknown>, q: string) => boolean;
  detail: (r: Record<string, unknown>) => DetailPair[] | Promise<DetailPair[]>;
  actions?: (r: Record<string, unknown>) => RowAction[];
};

export function ListDetailSection({ modules }: { modules: SectionModule[] }) {
  const [modKey, setModKey] = useState(modules[0]?.key);
  const mod = useMemo(() => modules.find((m) => m.key === modKey) ?? modules[0], [modules, modKey]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Record<string, unknown> | null>(null);
  const [detail, setDetail] = useState<DetailPair[]>([]);
  const [detailBusy, setDetailBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  // Rafraîchit UNIQUEMENT les lignes (préserve la sélection et le message d'action après une mutation).
  const refreshRows = useCallback(async () => {
    if (!mod) return;
    try { setRows(await mod.load()); setStatus("ready"); } catch { setStatus("error"); }
  }, [mod]);

  // Rechargement complet (changement de sous-module) : réinitialise sélection/filtre/message.
  const reload = useCallback(async () => {
    setStatus("loading");
    setSel(null);
    setActionMsg(null);
    await refreshRows();
  }, [refreshRows]);

  useEffect(() => { setQ(""); void reload(); }, [reload]);

  const selectRow = useCallback(async (r: Record<string, unknown>) => {
    if (!mod) return;
    setSel(r);
    setActionMsg(null);
    setDetailBusy(true);
    try { setDetail(await Promise.resolve(mod.detail(r))); } finally { setDetailBusy(false); }
  }, [mod]);

  async function runAction(a: RowAction) {
    if (!sel) return;
    setActionBusy(true);
    const msg = await a.run(sel);
    // Rafraîchit la liste sans perdre la sélection ni le message (la ligne reste ouverte, statut à jour).
    await refreshRows();
    setActionBusy(false);
    setActionMsg(msg);
  }

  if (!mod) return null;
  const filtered = q.trim() && mod.matches ? rows.filter((r) => mod.matches!(r, q.trim())) : rows;

  return (
    <div data-testid="dash-listdetail">
      {modules.length > 1 ? (
        <div className="mb-4 flex flex-wrap gap-1.5 border-b border-white/10 pb-3" data-testid="dash-subnav">
          {modules.map((m) => (
            <button key={m.key} data-testid={`dash-submod-${m.key}`} onClick={() => setModKey(m.key)}
              className={`rounded-lg px-3 py-1.5 text-[13px] font-semibold ${m.key === mod.key ? "bg-orange-600 text-white" : "bg-white/[0.04] text-white/60 hover:text-white/85"}`}>
              {m.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div>
          {mod.matches ? (
            <input data-testid="dash-filter" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Filtrer ${mod.label.toLowerCase()}…`}
              className="mb-3 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-orange-500/50" />
          ) : null}

          {status === "loading" ? (
            <p className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-6 text-sm text-white/50" data-testid="dash-loading">Chargement…</p>
          ) : status === "error" ? (
            <p className="rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-6 text-sm text-red-200" data-testid="dash-error">Erreur de chargement. Réessayez.</p>
          ) : filtered.length === 0 ? (
            <p className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-6 text-sm text-white/45" data-testid="dash-empty">Aucun élément.</p>
          ) : (
            <ul className="space-y-1.5" data-testid="dash-list">
              {filtered.map((r, i) => {
                const badge = mod.rowBadge?.(r);
                const on = sel === r;
                return (
                  <li key={(r.id as string) ?? i}>
                    <button data-testid="dash-row" onClick={() => void selectRow(r)}
                      className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left ${on ? "border-orange-500/50 bg-orange-500/10" : "border-white/10 bg-white/[0.02] hover:bg-white/[0.05]"}`}>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-white/85">{mod.rowMain(r)}</span>
                        {mod.rowSub ? <span className="block truncate text-xs text-white/45">{mod.rowSub(r)}</span> : null}
                      </span>
                      {badge ? <span className="shrink-0 rounded-full bg-white/[0.08] px-2.5 py-1 text-[11px] font-black text-white/70">{badge}</span> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4" data-testid="dash-detail">
          {!sel ? (
            <p className="text-sm text-white/40">Sélectionnez un élément pour voir le détail.</p>
          ) : detailBusy ? (
            <p className="text-sm text-white/50">Chargement du détail…</p>
          ) : (
            <>
              <p className="text-xs uppercase tracking-[0.18em] text-white/40">Détail</p>
              <dl className="mt-3 space-y-2 text-sm">
                {detail.map((d, i) => (
                  <div key={i} className="flex justify-between gap-3 border-b border-white/5 pb-2">
                    <dt className="text-white/40">{d.label}</dt>
                    <dd className="text-right font-semibold text-white/85">{d.value}</dd>
                  </div>
                ))}
              </dl>
              {mod.actions && mod.actions(sel).length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2" data-testid="dash-actions">
                  {mod.actions(sel).map((a, i) => (
                    <button key={i} data-testid={`dash-action-${i}`} disabled={actionBusy} onClick={() => void runAction(a)}
                      className={`rounded-xl px-4 py-2 text-sm font-black disabled:opacity-50 ${a.tone === "danger" ? "border border-red-400/40 text-red-200" : "bg-orange-500 text-black"}`}>
                      {a.label}
                    </button>
                  ))}
                </div>
              ) : null}
              {actionMsg ? <p className="mt-3 text-sm text-emerald-300" data-testid="dash-action-msg">{actionMsg}</p> : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

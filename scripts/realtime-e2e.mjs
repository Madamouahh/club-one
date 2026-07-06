// scripts/realtime-e2e.mjs — PREUVE NIVEAU 5 : Realtime WebSocket RÉEL + isolation RLS par rôle.
//
// 2 clients connectés (admin + promoter1), abonnés à postgres_changes sur club_tables. On provoque
// des UPDATE autorisés et on vérifie : (a) l'admin reçoit tout ; (b) le promoteur ne reçoit QUE les
// changements des lignes qu'il peut lire (sa table T03) — PAS d'une table étrangère (T05) → pas de
// fuite inter-rôle ; (c) reconnexion après re-subscribe. RLS SELECT = autorité Realtime (serveur).
//
// Usage : SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/realtime-e2e.mjs
import { createClient } from "@supabase/supabase-js";

const URL = process.env.SUPABASE_URL, ANON = process.env.SUPABASE_ANON_KEY, PW = process.env.E2E_PASSWORD || "Rehearsal!2026";
if (!URL || !ANON) { console.error("SUPABASE_URL / SUPABASE_ANON_KEY requis"); process.exit(2); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function mkClient(username) {
  const c = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await c.auth.signInWithPassword({ email: `${username}@clubone.local`, password: PW });
  if (error || !data?.session) throw new Error(`login ${username}: ${error?.message || "no session"}`);
  c.realtime.setAuth(data.session.access_token);
  return c;
}

function subscribe(client, label, sink) {
  return new Promise((resolve, reject) => {
    const ch = client.channel(`rt-${label}-${Math.floor(performance.now())}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "club_tables" }, (payload) => {
        sink.push({ label, id: payload.new?.id, notes: payload.new?.notes });
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") resolve(ch);
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error(`${label} sub: ${status}`));
      });
    setTimeout(() => reject(new Error(`${label} subscribe timeout`)), 12000);
  });
}

const result = { ok: false, steps: {}, received: [] };
try {
  const admin = await mkClient("admin");
  const promoter = await mkClient("promoter1");
  const adminSink = [], promoSink = [];
  await subscribe(admin, "admin", adminSink);
  await subscribe(promoter, "promoter1", promoSink);
  await sleep(2500); // warm-up : postgres_changes ne streame qu'après activation complète du canal
  result.steps.subscribed = "OK (admin + promoter1)";

  // UPDATE 1 : table étrangère au promoteur (T05, non assignée) — admin OUI, promoteur NON
  const u1 = await admin.from("club_tables").update({ notes: "rt-foreign-" + Math.floor(performance.now()) }).eq("id", "T05").select("id");
  // UPDATE 2 : table du promoteur (T03) — admin OUI, promoteur OUI
  const u2 = await admin.from("club_tables").update({ notes: "rt-own-" + Math.floor(performance.now()) }).eq("id", "T03").select("id");
  result.steps.updates = { T05: u1.error ? `ERR:${u1.error.message}` : (u1.data?.length||0), T03: u2.error ? `ERR:${u2.error.message}` : (u2.data?.length||0) };

  await sleep(4000); // fenêtre de réception

  result.received = { admin: adminSink, promoter: promoSink };
  const adminIds = new Set(adminSink.map((e) => e.id));
  const promoIds = new Set(promoSink.map((e) => e.id));

  const adminGotBoth = adminIds.has("T05") && adminIds.has("T03");
  const promoGotOwn = promoIds.has("T03");
  const promoLeakFree = !promoIds.has("T05"); // NE DOIT PAS voir la table étrangère

  result.steps.adminReceivesAll = adminGotBoth ? "OK" : `FAIL (a vu ${[...adminIds]})`;
  result.steps.promoterReceivesOwn = promoGotOwn ? "OK" : "FAIL (n'a pas reçu T03)";
  result.steps.promoterNoLeak = promoLeakFree ? "OK" : "FAIL (a reçu T05 étrangère — FUITE)";

  // Reconnexion : re-subscribe le promoteur et re-vérifier une réception autorisée
  await promoter.removeAllChannels();
  const promoSink2 = [];
  await subscribe(promoter, "promoter1-reconnect", promoSink2);
  const u3 = await admin.from("club_tables").update({ notes: "rt-reconn-" + Math.floor(performance.now()) }).eq("id", "T03").select("id");
  await sleep(4000);
  const reconnOk = promoSink2.some((e) => e.id === "T03");
  result.steps.reconnect = (u3.error ? `ERR:${u3.error.message}` : (reconnOk ? "OK (reçoit après re-subscribe)" : "FAIL"));

  await admin.removeAllChannels(); await promoter.removeAllChannels();
  await admin.auth.signOut(); await promoter.auth.signOut();

  result.ok = adminGotBoth && promoGotOwn && promoLeakFree && reconnOk;
} catch (e) {
  result.fatal = String(e?.message || e);
}
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);

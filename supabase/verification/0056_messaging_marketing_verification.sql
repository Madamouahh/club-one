-- 0056_messaging_marketing_verification.sql — PREUVE SQL STATIQUE (tx ROLLBACK) du module Messagerie/Marketing.
-- PUR SQL (aucune méta-commande psql) → exécutable via MCP execute_sql / psql -f / éditeur Supabase.
-- Chaque invariant = raise exception. Vérifie APRÈS 0056, sans dépendre de rôles réels (assertions de STRUCTURE) :
--   A. les 6 tables existent et ont la RLS activée ;
--   B. colonnes clés présentes (contrat de schéma des libs lib/messaging + lib/promoCodes) ;
--   C. contraintes CHECK d'énumération (statut file, canal, discount_type) présentes ;
--   D. index d'idempotence : unique(dedup_key), unique(campaign_id,guest_id), unique(promo_code_id,guest_id) ;
--   E. GRANTS : authenticated a les DML ; anon n'a AUCUN grant (invariant 0053) ;
--   F. policies RLS direction (select + write) présentes sur chaque table.

begin;

do $$
declare
  v_n   int;
  v_tbl text;
  v_tables text[] := array[
    'message_templates','message_queue','campaign_audiences',
    'campaign_recipients','promo_codes','promo_redemptions'
  ];
begin
  -- A. tables présentes + RLS activée
  foreach v_tbl in array v_tables loop
    if not exists (select 1 from pg_tables where schemaname='public' and tablename=v_tbl) then
      raise exception 'A: table public.% absente', v_tbl;
    end if;
    if not (select relrowsecurity from pg_class
             where relname=v_tbl and relnamespace='public'::regnamespace) then
      raise exception 'A: RLS désactivée sur public.%', v_tbl;
    end if;
  end loop;

  -- B. colonnes clés (contrat de schéma)
  -- message_templates
  perform 1 from information_schema.columns
   where table_schema='public' and table_name='message_templates' and column_name='key';
  if not found then raise exception 'B: message_templates.key manquante'; end if;
  perform 1 from information_schema.columns
   where table_schema='public' and table_name='message_templates' and column_name='active';
  if not found then raise exception 'B: message_templates.active manquante'; end if;

  -- message_queue : colonnes structurantes de la file
  foreach v_tbl in array array['channel','guest_id','to_address','template_key','payload',
                               'status','dedup_key','scheduled_at','attempts','max_attempts',
                               'last_error','sent_at'] loop
    perform 1 from information_schema.columns
     where table_schema='public' and table_name='message_queue' and column_name=v_tbl;
    if not found then raise exception 'B: message_queue.% manquante', v_tbl; end if;
  end loop;

  -- campaign_audiences
  foreach v_tbl in array array['campaign_id','segment_key','criteria'] loop
    perform 1 from information_schema.columns
     where table_schema='public' and table_name='campaign_audiences' and column_name=v_tbl;
    if not found then raise exception 'B: campaign_audiences.% manquante', v_tbl; end if;
  end loop;

  -- campaign_recipients
  foreach v_tbl in array array['campaign_id','guest_id','message_id','status'] loop
    perform 1 from information_schema.columns
     where table_schema='public' and table_name='campaign_recipients' and column_name=v_tbl;
    if not found then raise exception 'B: campaign_recipients.% manquante', v_tbl; end if;
  end loop;

  -- promo_codes
  foreach v_tbl in array array['code','campaign_id','discount_type','discount_value_cents',
                               'max_redemptions','redeemed_count','per_guest_limit',
                               'valid_from','valid_until','active'] loop
    perform 1 from information_schema.columns
     where table_schema='public' and table_name='promo_codes' and column_name=v_tbl;
    if not found then raise exception 'B: promo_codes.% manquante', v_tbl; end if;
  end loop;

  -- promo_redemptions
  foreach v_tbl in array array['promo_code_id','guest_id','reservation_id','redeemed_at'] loop
    perform 1 from information_schema.columns
     where table_schema='public' and table_name='promo_redemptions' and column_name=v_tbl;
    if not found then raise exception 'B: promo_redemptions.% manquante', v_tbl; end if;
  end loop;

  -- C. contraintes CHECK d'énumération (recherche textuelle du contrat sur pg_get_constraintdef)
  if not exists (
    select 1 from pg_constraint c
     where c.conrelid='public.message_queue'::regclass and c.contype='c'
       and pg_get_constraintdef(c.oid) like '%queued%'
       and pg_get_constraintdef(c.oid) like '%opted_out%'
  ) then raise exception 'C: message_queue.status check (queued..opted_out) manquant'; end if;

  if not exists (
    select 1 from pg_constraint c
     where c.conrelid='public.message_queue'::regclass and c.contype='c'
       and pg_get_constraintdef(c.oid) like '%whatsapp%'
       and pg_get_constraintdef(c.oid) like '%push%'
  ) then raise exception 'C: message_queue.channel check (sms/email/whatsapp/push) manquant'; end if;

  if not exists (
    select 1 from pg_constraint c
     where c.conrelid='public.promo_codes'::regclass and c.contype='c'
       and pg_get_constraintdef(c.oid) like '%percent%'
       and pg_get_constraintdef(c.oid) like '%amount%'
  ) then raise exception 'C: promo_codes.discount_type check (percent/amount) manquant'; end if;

  -- D. index d'idempotence uniques
  if not exists (select 1 from pg_indexes where schemaname='public'
                  and indexname='message_queue_dedup_key_uidx') then
    raise exception 'D: index unique message_queue_dedup_key_uidx manquant';
  end if;
  if not exists (
    select 1 from pg_constraint where conrelid='public.campaign_recipients'::regclass
      and contype='u' and pg_get_constraintdef(oid) like '%campaign_id%guest_id%'
  ) then raise exception 'D: unique(campaign_id,guest_id) sur campaign_recipients manquant'; end if;
  if not exists (select 1 from pg_indexes where schemaname='public'
                  and indexname='promo_redemptions_code_guest_uidx') then
    raise exception 'D: index unique promo_redemptions_code_guest_uidx manquant';
  end if;

  -- E. GRANTS : authenticated a les DML ; anon = zéro grant
  foreach v_tbl in array v_tables loop
    select count(*) into v_n from information_schema.role_table_grants
     where table_schema='public' and table_name=v_tbl and grantee='authenticated'
       and privilege_type in ('SELECT','INSERT','UPDATE','DELETE');
    if v_n < 4 then
      raise exception 'E: authenticated n''a pas les 4 DML sur public.% (trouvé %)', v_tbl, v_n;
    end if;

    select count(*) into v_n from information_schema.role_table_grants
     where table_schema='public' and table_name=v_tbl and grantee='anon';
    if v_n <> 0 then
      raise exception 'E: anon possède % grant(s) sur public.% (doit être 0)', v_n, v_tbl;
    end if;
  end loop;

  -- F. policies RLS direction (select + write) présentes sur chaque table
  foreach v_tbl in array v_tables loop
    select count(*) into v_n from pg_policies
     where schemaname='public' and tablename=v_tbl;
    if v_n < 2 then
      raise exception 'F: public.% a % policy(ies), attendu >= 2 (select + write direction)', v_tbl, v_n;
    end if;
  end loop;

  raise notice '0056 verification: A/B/C/D/E/F OK — 6 tables + RLS + colonnes + checks + index idempotence + grants (authenticated only, anon zéro) + policies direction.';
end;
$$;

rollback;

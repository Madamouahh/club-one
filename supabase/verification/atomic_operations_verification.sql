-- Verification manuelle - operations atomiques Club One
--
-- A executer uniquement sur un environnement Supabase de test, apres application
-- des migrations 0003, 0005, 0006 puis 0007. Ne pas executer en production
-- pendant une soiree.

-- 1) Pre-vol schema
select data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'club_tables'
  and column_name = 'expenses';

select proname, proargnames
from pg_proc
where proname in ('add_expense', 'add_expense_v2', 'check_in_invitation');

-- 2) QR - absence de doublons non vides avant/apres index unique
select btrim(qr_token) as token, count(*) as count
from public.promoter_guest_entries
where qr_token is not null
  and btrim(qr_token) <> ''
group by btrim(qr_token)
having count(*) > 1;

select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'promoter_guest_entries'
  and indexname = 'promoter_guest_entries_qr_token_unique_idx';

-- 3) QR - le duplicate token doit etre refuse par l'index unique.
-- A executer dans une transaction de test puis rollback.
begin;
  -- Remplacer les colonnes obligatoires selon le schema reel si necessaire.
  -- Le second insert doit echouer sur promoter_guest_entries_qr_token_unique_idx.
  insert into public.promoter_guest_entries (event_date, promoter_username, guest_name, qr_token)
  values (current_date, 'mathias', 'Duplicate A', '__DUPLICATE_TEST__');

  insert into public.promoter_guest_entries (event_date, promoter_username, guest_name, qr_token)
  values (current_date, 'mathias', 'Duplicate B', '__DUPLICATE_TEST__');
rollback;

-- 4) Depense atomique v2 - appel normal
-- Remplacer <TABLE_ID> par une table existante accessible au role teste.
select *
from public.add_expense_v2('<TABLE_ID>', 'Test verification', 10, current_date::text);

-- 5) Depense atomique v2 - montant invalide / trop eleve / table inconnue
select *
from public.add_expense_v2('<TABLE_ID>', 'Montant nul', 0, current_date::text);

select *
from public.add_expense_v2('<TABLE_ID>', 'Montant aberrant', 100001, current_date::text);

select *
from public.add_expense_v2('__TABLE_INCONNUE__', 'Test', 10, current_date::text);

-- 6) Depense atomique v2 - deux ajouts successifs sans perte
select *
from public.add_expense_v2('<TABLE_ID>', 'Concurrent A', 11, current_date::text);

select *
from public.add_expense_v2('<TABLE_ID>', 'Concurrent B', 22, current_date::text);

select id, expenses
from public.club_tables
where id = '<TABLE_ID>';

-- 7) QR atomique - invitation inconnue
select *
from public.check_in_invitation('__TOKEN_INCONNU__', current_date::text);

-- 8) QR atomique - checked_in NULL accepte une seule fois
-- Preparer une invitation de test non utilisee avec checked_in = null.
begin;
  insert into public.promoter_guest_entries (event_date, promoter_username, guest_name, qr_token, checked_in)
  values (current_date, 'mathias', 'Legacy Null', '__NULL_CHECKED_IN_TEST__', null);

  select *
  from public.check_in_invitation('__NULL_CHECKED_IN_TEST__', current_date::text);

  select *
  from public.check_in_invitation('__NULL_CHECKED_IN_TEST__', current_date::text);
rollback;

-- 9) QR atomique - mauvaise date
-- Remplacer <TOKEN_AUTRE_DATE> par un token existant dont event_date differe.
select *
from public.check_in_invitation('<TOKEN_AUTRE_DATE>', current_date::text);

-- 10) Roles
-- Tester avec JWT authentifie :
-- - admin : check_in_invitation doit pouvoir valider.
-- - manager : check_in_invitation doit pouvoir valider.
-- - security : check_in_invitation doit pouvoir valider.
-- - security_counter : check_in_invitation doit pouvoir valider.
-- - promoter : check_in_invitation doit retourner unauthorized.
-- - server : check_in_invitation doit retourner unauthorized.

-- 11) QR atomique - concurrence
-- Ouvrir deux sessions authentifiees autorisees et lancer simultanement sur le meme
-- <TOKEN_CONCURRENT>. Un seul appel doit retourner ok=true/code=checked_in ;
-- l'autre doit retourner ok=false/code=already_used.
select *
from public.check_in_invitation('<TOKEN_CONCURRENT>', current_date::text);

select qr_token, checked_in, checked_in_at, checked_in_by
from public.promoter_guest_entries
where qr_token = '<TOKEN_CONCURRENT>';

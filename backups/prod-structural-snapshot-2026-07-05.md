# Production structural snapshot — rollback reference

- **Project**: `xsotmjnaffaibgqgookt` (https://xsotmjnaffaibgqgookt.supabase.co)
- **Captured**: 2026-07-05 (read-only, MCP Supabase)
- **Purpose**: rollback / cutover-rehearsal reference. Schema code only — **no PII, no credentials, no data rows** (those are covered by the platform backup/PITR, see report).
- **Proof level**: 1 (static read of live catalog).

## Migration state (as observed live)

- `supabase_migrations.schema_migrations`: **empty** (0 tracked migrations — historically applied manually).
- Effective schema level: **~`0007`** (pre event-scope). Migrations `0008 → 0051` from branch `feat/club-one-launch-july-2026` are **NOT applied**.

## Tables (public) + row counts

| table | rls | rows |
|---|---|---|
| club_tables | on | 18 |
| staff_users | on | 10 |
| entry_logs | on | 22 |
| event_archives | on | 0 |
| promoter_contacts | on | 3 |
| promoter_guest_entries | on | 8 |
| venues | on | 3 |
| events | on | 0 |

`club_runtime_state` and all `0010+` vertical tables (stock, maintenance, RH, CRM, incidents, comms, checklists, captation, suppliers, commercial, marketing, budget…) **do not exist** in production.

## Functions (public)

| function | args | security | lang |
|---|---|---|---|
| add_expense | p_table_id text, p_label text, p_amount numeric, p_date_key text | INVOKER | sql |
| add_expense_v2 | p_table_id text, p_label text, p_amount numeric, p_date_key text | INVOKER | plpgsql |
| check_in_invitation | p_token text, p_event_date text | INVOKER | plpgsql |
| current_staff_role | () | DEFINER | sql |
| current_staff_username | () | DEFINER | sql |
| get_invite | p_token text | DEFINER | sql |
| get_my_profile | () | DEFINER | sql |
| public_events | () | DEFINER | sql |

None of the event-scoped versioned RPCs (`bootstrap_club_event_v2`, `activate_club_event_v2`, `close_club_event_v2`, `add_expense_v3`, `check_in_invitation_v2`, `add_entry_log_v2`, `create_promoter_invitation_v2`, `get_active_event_context`, `list_activatable_club_events`, `get_security_table_snapshot`) exist yet.

## RLS policies (public)

club_tables:
- anon INSERT `co_phase0b_anon_club_tables_insert` — WITH CHECK **true**
- auth INSERT `co_phase0b_auth_club_tables_insert` — WITH CHECK current_staff_role in (admin,manager,server,promoter)
- anon SELECT `co_phase0b_anon_club_tables_select` — USING true
- auth SELECT `co_phase0b_auth_club_tables_select` — USING current_staff_role() IS NOT NULL
- anon UPDATE `co_phase0b_anon_club_tables_update` — USING **true** / WITH CHECK **true**
- auth UPDATE `co_phase0b_auth_club_tables_update` — current_staff_role in (admin,manager,server,promoter)

entry_logs:
- anon INSERT `co_phase0b_anon_entry_logs_insert` — WITH CHECK **true**
- auth INSERT `co_phase0b_auth_entry_logs_insert` — WITH CHECK staff_username = current_staff_username()
- anon SELECT `co_phase0b_anon_entry_logs_select` — USING true
- auth SELECT `co_phase0b_auth_entry_logs_select` — USING current_staff_role() IS NOT NULL

event_archives:
- anon INSERT `co_phase0b_anon_event_archives_insert` — WITH CHECK **true**
- auth INSERT `co_phase0b_auth_event_archives_insert` — current_staff_role in (admin,manager)

events:
- auth ALL `events_write` — current_staff_role in (admin,manager,promoter)
- auth SELECT `events_read` — current_staff_role() IS NOT NULL

promoter_contacts:
- anon INSERT `co_phase0b_anon_promoter_contacts_insert` — WITH CHECK **true**
- auth INSERT `co_phase0b_auth_promoter_contacts_insert` — current_staff_role in (admin,manager,promoter)
- anon SELECT `co_phase0b_anon_promoter_contacts_select` — USING true
- auth SELECT `co_phase0b_auth_promoter_contacts_select` — USING current_staff_role() IS NOT NULL

promoter_guest_entries:
- anon INSERT `co_phase0b_anon_pge_insert` — WITH CHECK **true**
- auth INSERT `co_phase0b_auth_pge_insert` — current_staff_role in (admin,manager,promoter)
- anon SELECT `co_phase0b_anon_pge_select` — USING true
- auth SELECT `co_phase0b_auth_pge_select` — USING current_staff_role() IS NOT NULL
- anon UPDATE `co_phase0b_anon_pge_update` — USING **true** / WITH CHECK **true**
- auth UPDATE `co_phase0b_auth_pge_update` — current_staff_role in (admin,manager,promoter,security,security_counter)

venues:
- auth SELECT `venues_read` — current_staff_role() IS NOT NULL

staff_users: RLS enabled, **no policy** (locked to service_role only — advisor INFO).

## Table grants (anon / authenticated)

- club_tables, entry_logs, event_archives, promoter_contacts, promoter_guest_entries — **anon AND authenticated** have `DELETE,INSERT,REFERENCES,SELECT,TRIGGER,TRUNCATE,UPDATE` (constrained only by RLS above).
- events — authenticated only (full DML).
- venues — authenticated: `REFERENCES,SELECT,TRIGGER,TRUNCATE`.

## Function grants (EXECUTE)

- anon: `get_invite`, `public_events`.
- authenticated: `add_expense`, `add_expense_v2`, `check_in_invitation`, `current_staff_role`, `current_staff_username`, `get_invite`, `get_my_profile`, `public_events`.

## Realtime

- Publication `supabase_realtime`: **no tables** (pre-`0042`).

## Auth

- `auth.users`: 10.
- `staff_users`: 10 rows, distinct roles: admin, manager, promoter, security, security_counter, server.

## Security advisors (production, current state)

- WARN `rls_policy_always_true` ×6 — permissive anon INSERT/UPDATE on club_tables, entry_logs, event_archives, promoter_contacts, promoter_guest_entries (the `0009` cutover targets these).
- WARN `anon_security_definer_function_executable` — `get_invite`, `public_events` callable by anon (intentional: public invite/event lookup).
- WARN `authenticated_security_definer_function_executable` — current_staff_role, current_staff_username, get_invite, get_my_profile, public_events.
- WARN `auth_leaked_password_protection` — HaveIBeenPwned check disabled.
- INFO `rls_enabled_no_policy` — staff_users (intentional: no anon/auth access).

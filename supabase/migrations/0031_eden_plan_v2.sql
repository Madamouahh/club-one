-- 0031_eden_plan_v2.sql — PLAN EDEN V2 « PROPREMENT » (corrections fondateur 2026-07-03 soir).
--
-- Le fondateur a jugé le plan OctoTable « fait à l'arrache » et a donné les corrections définitives :
--   · mêmes zones, mêmes numéros, alignements réguliers ;
--   · TYPES et CAPACITÉS réels : 100-105 = canapés 6 pers · 200-205 = tables oliviers 6 pers ·
--     106/107/400-406/500 = tables hautes debout (groupe, sans capacité assise → capacity NULL par
--     NATURE, pas « à confirmer ») · tout le reste = tables 2 pers modulables ;
--   · la cabine DJ (entre 304 et 406) et les banquettes murales (rangées 300/500/700) sont des
--     éléments FIXES rendus par la vue (lib/floorPlanView EDEN_FIXTURES_V2), pas des lignes de table.
-- Additif : ajoute la colonne kind + met à jour les 44 lignes Eden. Ne touche à rien d'autre.
-- Miroir code : lib/venueTables.ts EDEN_SEED_V2 (mêmes pixels, même repère 952×506, mêmes maths
-- round((px/952)*100, 3) que le seed 0024).

begin;

alter table public.venue_tables add column if not exists kind text
  check (kind is null or kind in ('canape','olivier','modulable','haute'));

-- Rangée 700 (2 pers modulables, y=150)
update public.venue_tables set x_pct = round((50::numeric/952)*100,3),  y_pct = round((150::numeric/506)*100,3), shape='round', standing=false, capacity=2, kind='modulable' where venue='eden' and label='704';
update public.venue_tables set x_pct = round((94::numeric/952)*100,3),  y_pct = round((150::numeric/506)*100,3), shape='round', standing=false, capacity=2, kind='modulable' where venue='eden' and label='703';
update public.venue_tables set x_pct = round((138::numeric/952)*100,3), y_pct = round((150::numeric/506)*100,3), shape='round', standing=false, capacity=2, kind='modulable' where venue='eden' and label='702';
update public.venue_tables set x_pct = round((182::numeric/952)*100,3), y_pct = round((150::numeric/506)*100,3), shape='round', standing=false, capacity=2, kind='modulable' where venue='eden' and label='701';
update public.venue_tables set x_pct = round((226::numeric/952)*100,3), y_pct = round((150::numeric/506)*100,3), shape='round', standing=false, capacity=2, kind='modulable' where venue='eden' and label='700';

-- Tables hautes debout (groupe, sans capacité assise)
update public.venue_tables set x_pct = round((270::numeric/952)*100,3), y_pct = round((150::numeric/506)*100,3), shape='round', standing=true, capacity=null, kind='haute' where venue='eden' and label='405';
update public.venue_tables set x_pct = round((270::numeric/952)*100,3), y_pct = round((196::numeric/506)*100,3), shape='round', standing=true, capacity=null, kind='haute' where venue='eden' and label='406';
update public.venue_tables set x_pct = round((315::numeric/952)*100,3), y_pct = round((150::numeric/506)*100,3), shape='round', standing=true, capacity=null, kind='haute' where venue='eden' and label='404';
update public.venue_tables set x_pct = round((360::numeric/952)*100,3), y_pct = round((150::numeric/506)*100,3), shape='round', standing=true, capacity=null, kind='haute' where venue='eden' and label='403';
update public.venue_tables set x_pct = round((420::numeric/952)*100,3), y_pct = round((150::numeric/506)*100,3), shape='round', standing=true, capacity=null, kind='haute' where venue='eden' and label='402';
update public.venue_tables set x_pct = round((465::numeric/952)*100,3), y_pct = round((150::numeric/506)*100,3), shape='round', standing=true, capacity=null, kind='haute' where venue='eden' and label='401';
update public.venue_tables set x_pct = round((510::numeric/952)*100,3), y_pct = round((150::numeric/506)*100,3), shape='round', standing=true, capacity=null, kind='haute' where venue='eden' and label='400';

-- Solitaire bord gauche + rangée 600 (2 pers modulables, y=268)
update public.venue_tables set x_pct = round((26::numeric/952)*100,3),  y_pct = round((228::numeric/506)*100,3), shape='round', standing=false, capacity=2, kind='modulable' where venue='eden' and label='606';
update public.venue_tables set x_pct = round((55::numeric/952)*100,3),  y_pct = round((268::numeric/506)*100,3), shape='round', standing=false, capacity=2, kind='modulable' where venue='eden' and label='605';
update public.venue_tables set x_pct = round((91::numeric/952)*100,3),  y_pct = round((268::numeric/506)*100,3), shape='round', standing=false, capacity=2, kind='modulable' where venue='eden' and label='604';
update public.venue_tables set x_pct = round((127::numeric/952)*100,3), y_pct = round((268::numeric/506)*100,3), shape='round', standing=false, capacity=2, kind='modulable' where venue='eden' and label='603';
update public.venue_tables set x_pct = round((163::numeric/952)*100,3), y_pct = round((268::numeric/506)*100,3), shape='round', standing=false, capacity=2, kind='modulable' where venue='eden' and label='602';
update public.venue_tables set x_pct = round((199::numeric/952)*100,3), y_pct = round((268::numeric/506)*100,3), shape='round', standing=false, capacity=2, kind='modulable' where venue='eden' and label='601';
update public.venue_tables set x_pct = round((235::numeric/952)*100,3), y_pct = round((268::numeric/506)*100,3), shape='round', standing=false, capacity=2, kind='modulable' where venue='eden' and label='600';

-- Rangée 500 (2 pers modulables, y=362) + 500 haute debout
update public.venue_tables set x_pct = round((55::numeric/952)*100,3),  y_pct = round((362::numeric/506)*100,3), shape='round', standing=false, capacity=2, kind='modulable' where venue='eden' and label='505';
update public.venue_tables set x_pct = round((93::numeric/952)*100,3),  y_pct = round((362::numeric/506)*100,3), shape='round', standing=false, capacity=2, kind='modulable' where venue='eden' and label='504';
update public.venue_tables set x_pct = round((131::numeric/952)*100,3), y_pct = round((362::numeric/506)*100,3), shape='round', standing=false, capacity=2, kind='modulable' where venue='eden' and label='503';
update public.venue_tables set x_pct = round((169::numeric/952)*100,3), y_pct = round((362::numeric/506)*100,3), shape='round', standing=false, capacity=2, kind='modulable' where venue='eden' and label='502';
update public.venue_tables set x_pct = round((207::numeric/952)*100,3), y_pct = round((362::numeric/506)*100,3), shape='round', standing=false, capacity=2, kind='modulable' where venue='eden' and label='501';
update public.venue_tables set x_pct = round((285::numeric/952)*100,3), y_pct = round((362::numeric/506)*100,3), shape='round', standing=true, capacity=null, kind='haute' where venue='eden' and label='500';

-- Rangée 300 (2 pers modulables, y=362)
update public.venue_tables set x_pct = round((330::numeric/952)*100,3), y_pct = round((362::numeric/506)*100,3), shape='round', standing=false, capacity=2, kind='modulable' where venue='eden' and label='304';
update public.venue_tables set x_pct = round((372::numeric/952)*100,3), y_pct = round((362::numeric/506)*100,3), shape='round', standing=false, capacity=2, kind='modulable' where venue='eden' and label='303';
update public.venue_tables set x_pct = round((414::numeric/952)*100,3), y_pct = round((362::numeric/506)*100,3), shape='round', standing=false, capacity=2, kind='modulable' where venue='eden' and label='302';
update public.venue_tables set x_pct = round((456::numeric/952)*100,3), y_pct = round((362::numeric/506)*100,3), shape='round', standing=false, capacity=2, kind='modulable' where venue='eden' and label='301';
update public.venue_tables set x_pct = round((498::numeric/952)*100,3), y_pct = round((362::numeric/506)*100,3), shape='round', standing=false, capacity=2, kind='modulable' where venue='eden' and label='300';

-- Tables oliviers (6 pers)
update public.venue_tables set x_pct = round((560::numeric/952)*100,3), y_pct = round((300::numeric/506)*100,3), shape='round', standing=false, capacity=6, kind='olivier' where venue='eden' and label='205';
update public.venue_tables set x_pct = round((632::numeric/952)*100,3), y_pct = round((300::numeric/506)*100,3), shape='round', standing=false, capacity=6, kind='olivier' where venue='eden' and label='203';
update public.venue_tables set x_pct = round((704::numeric/952)*100,3), y_pct = round((300::numeric/506)*100,3), shape='round', standing=false, capacity=6, kind='olivier' where venue='eden' and label='201';
update public.venue_tables set x_pct = round((596::numeric/952)*100,3), y_pct = round((352::numeric/506)*100,3), shape='round', standing=false, capacity=6, kind='olivier' where venue='eden' and label='204';
update public.venue_tables set x_pct = round((668::numeric/952)*100,3), y_pct = round((352::numeric/506)*100,3), shape='round', standing=false, capacity=6, kind='olivier' where venue='eden' and label='202';
update public.venue_tables set x_pct = round((740::numeric/952)*100,3), y_pct = round((352::numeric/506)*100,3), shape='round', standing=false, capacity=6, kind='olivier' where venue='eden' and label='200';

-- Hautes debout côté droit
update public.venue_tables set x_pct = round((760::numeric/952)*100,3), y_pct = round((296::numeric/506)*100,3), shape='round', standing=true, capacity=null, kind='haute' where venue='eden' and label='107';
update public.venue_tables set x_pct = round((802::numeric/952)*100,3), y_pct = round((296::numeric/506)*100,3), shape='round', standing=true, capacity=null, kind='haute' where venue='eden' and label='106';

-- Canapés (6 pers chacun, mur droit + retour)
update public.venue_tables set x_pct = round((884::numeric/952)*100,3), y_pct = round((160::numeric/506)*100,3), shape='square', standing=false, capacity=6, kind='canape' where venue='eden' and label='100';
update public.venue_tables set x_pct = round((884::numeric/952)*100,3), y_pct = round((232::numeric/506)*100,3), shape='square', standing=false, capacity=6, kind='canape' where venue='eden' and label='101';
update public.venue_tables set x_pct = round((884::numeric/952)*100,3), y_pct = round((304::numeric/506)*100,3), shape='square', standing=false, capacity=6, kind='canape' where venue='eden' and label='102';
update public.venue_tables set x_pct = round((884::numeric/952)*100,3), y_pct = round((376::numeric/506)*100,3), shape='square', standing=false, capacity=6, kind='canape' where venue='eden' and label='103';
update public.venue_tables set x_pct = round((884::numeric/952)*100,3), y_pct = round((448::numeric/506)*100,3), shape='square', standing=false, capacity=6, kind='canape' where venue='eden' and label='104';
update public.venue_tables set x_pct = round((824::numeric/952)*100,3), y_pct = round((400::numeric/506)*100,3), shape='square', standing=false, capacity=6, kind='canape' where venue='eden' and label='105';

commit;

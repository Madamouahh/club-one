-- 0032_produits_bar_multi_venue_carte_eden.sql
-- CARTE EDEN ROOFTOP 2026 + multi-univers du catalogue bar (demande fondateur 2026-07-03).
--
-- Contexte fondateur : le rooftop Eden a une carte DIFFÉRENTE des 36 produits « club » seedés en 0010
-- (prix plus hauts côté club : Belvedere 150/350, Moët 120/230/600). Les deux cartes COEXISTENT ;
-- des prix différents par univers = NORMAL. On ne touche donc PAS aux prix club existants.
--
-- Additif (ne casse rien) :
--   1) colonne `venue` sur produits_bar (eden/terminus/commun), défaut 'terminus' → BACKFILL des 36
--      lignes 0010 en 'terminus' (= la carte « club » telle quelle) ;
--   2) colonne `disponible` bool default true → toggle rupture EN SOIRÉE (distinct de actif = retiré de
--      la carte), pour l'écran de gestion mobile-first admin/manager ;
--   3) colonne `a_verifier` bool default false → 3 mappings prix/format extraits du PDF à confirmer
--      par le fondateur (seedés au prix indiqué + flaggés, cf. « Points à confirmer » ci-dessous) ;
--   4) unicité élargie (venue, nom, format) au lieu de (nom, format) → Eden peut porter le même produit
--      que le club à un prix différent ;
--   5) SEED de la carte EDEN réelle (transcription du PDF fondateur → CARTE_EDEN_2026.md, prix réels).
--
-- ⛔ Le « Mont d'Or rôti » du PDF est RETIRÉ par le fondateur (2026-07-03 : cuisine Eden = exactement
--    3 planches + 3 paninis). NON seedé.
-- ⚠️ 3 mappings à confirmer (flaggés a_verifier = true, prix seedé = prix indiqué au PDF) :
--    · Tequila Volcan Blanco 40° 4cl = 13,00 € (le verre 4cl ?) ;
--    · Tequila Don Julio 1942 70cl = 390,00 € (bien la bouteille 70cl ?) ;
--    · Gin Bombay Sapphire 70cl = 130,00 € (uniquement à la bouteille, pas au verre ?).
--
-- Idempotence : colonnes en `if not exists`, contraintes drop/recreate, seed gardé par un
-- `where not exists (… venue='eden')` (rejoue sans doublon, y compris pour les formats NULL).
-- RLS/grants : inchangés (0010 accorde déjà select à authenticated + insert/update admin/manager).

begin;

-- ============================================================
-- 1) SCHÉMA — venue / disponible / a_verifier + unicité par univers
-- ============================================================
alter table public.produits_bar add column if not exists venue text not null default 'terminus';
alter table public.produits_bar drop constraint if exists produits_bar_venue_chk;
alter table public.produits_bar add constraint produits_bar_venue_chk
  check (venue in ('eden', 'terminus', 'commun'));

alter table public.produits_bar add column if not exists disponible boolean not null default true;
alter table public.produits_bar add column if not exists a_verifier boolean not null default false;

-- Unicité par univers : le même produit/format peut exister côté eden ET terminus à un prix différent.
alter table public.produits_bar drop constraint if exists produits_bar_nom_format_key;
drop index if exists produits_bar_venue_nom_format_key;
create unique index produits_bar_venue_nom_format_key
  on public.produits_bar (venue, nom, format);

-- ============================================================
-- 2) SEED CARTE EDEN (venue='eden') — prix réels transcrits du PDF fondateur (CARTE_EDEN_2026.md)
--    Gardé par NOT EXISTS pour rester idempotent malgré les formats NULL.
-- ============================================================
insert into public.produits_bar (venue, categorie, nom, format, prix_vente, a_verifier)
select 'eden', v.categorie, v.nom, v.format, v.prix_vente, v.a_verifier
from (values
  -- Cuisine (CONFIRMÉ fondateur : 3 planches + 3 paninis, RIEN d'autre)
  ('Cuisine','Planche de fromages',                      null::text, 22.00, false),
  ('Cuisine','Planche de charcuterie',                   null,       22.00, false),
  ('Cuisine','Planche de fritures',                      null,       23.00, false),
  ('Cuisine','Panini jambon fromage',                    null,        7.00, false),
  ('Cuisine','Panini jambon halal fromages',             null,        7.00, false),
  ('Cuisine','Panini trois fromages',                    null,        7.00, false),

  -- Apéritifs
  ('Apéritifs','Ricard 45°',                             '2cl',       4.00, false),
  ('Apéritifs','Martini Rouge 14.4°',                    '8cl',       8.00, false),
  ('Apéritifs','Martini Blanco 14.4°',                   '8cl',       8.00, false),
  ('Apéritifs','Kir (pêche/mûre/cassis)',                '10cl',      7.00, false),
  ('Apéritifs','Kir Royal',                              '10cl',     10.00, false),
  ('Apéritifs','Gin Tonic',                              '15cl',     10.00, false),
  ('Apéritifs','Américano / Négroni',                    '10cl',     10.00, false),
  ('Apéritifs','Ti-Punch',                               '6cl',      10.00, false),
  ('Apéritifs','Spritz Apérol',                          '12cl',      9.00, false),
  ('Apéritifs','Spritz St Germain',                      '12cl',      9.00, false),
  ('Apéritifs','Italian Spritz (limoncello)',            '12cl',      9.00, false),

  -- Whisky / Bourbon
  ('Whisky / Bourbon','Whisky William Lawson',                              '4cl',   8.00, false),
  ('Whisky / Bourbon','Whisky William Lawson',                              '70cl', 80.00, false),
  ('Whisky / Bourbon','Whisky Jack Daniel''s 40° (Classic, Honey, Apple)',  '4cl',  10.00, false),
  ('Whisky / Bourbon','Whisky Jack Daniel''s 40° (Classic, Honey, Apple)',  '70cl',110.00, false),
  ('Whisky / Bourbon','Cardhu',                                             '4cl',  12.00, false),
  ('Whisky / Bourbon','Lagavulin 16 ans 43°',                               '4cl',  14.00, false),

  -- Vodka & Tequila (⚠️ 2 mappings à confirmer)
  ('Vodka & Tequila','Vodka Smirnoff 37.5°',                  '4cl',    8.00, false),
  ('Vodka & Tequila','Vodka Smirnoff 37.5°',                  '70cl',  80.00, false),
  ('Vodka & Tequila','Vodka Cîroc (Red Berry / Pêche) 40°',   '70cl', 130.00, false),
  ('Vodka & Tequila','Vodka Belvedere 40°',                   '70cl', 130.00, false),
  ('Vodka & Tequila','Vodka Belvedere 40°',                   '175cl',320.00, false),
  ('Vodka & Tequila','Tequila Volcan Blanco 40°',             '4cl',   13.00, true),
  ('Vodka & Tequila','Tequila Don Julio 1942',                '70cl', 390.00, true),
  ('Vodka & Tequila','Au Vodka (Bubble gum, Pêche)',          '4cl',   10.00, false),
  ('Vodka & Tequila','Au Vodka (Bubble gum, Pêche)',          '70cl', 130.00, false),

  -- Rhum & Gin (⚠️ 1 mapping à confirmer)
  ('Rhum & Gin','Rhum blanc/ambré Bacardi',                    '4cl',   8.00, false),
  ('Rhum & Gin','Rhum blanc/ambré Bacardi',                    '70cl', 80.00, false),
  ('Rhum & Gin','Rhum Zacapa XO 40°',                          '4cl',  17.00, false),
  ('Rhum & Gin','Rhum Zacapa XO Solera 40°',                   '4cl',  13.00, false),
  ('Rhum & Gin','Rhum Diplomatico 12 ans',                     '4cl',  10.00, false),
  ('Rhum & Gin','Rhum Eminente Reserva 41.3°',                 '4cl',  12.00, false),
  ('Rhum & Gin','Rhum Eminente Gran Reserva 10 ans 43.5°',     '4cl',  13.00, false),
  ('Rhum & Gin','Gin Bombay Sapphire',                         '70cl',130.00, true),

  -- Digestifs
  ('Digestifs','Get 27 / Get 31',        '5cl',  8.00, false),
  ('Digestifs','Cognac Hennessy VS',     '4cl', 12.00, false),
  ('Digestifs','Cognac Hennessy XO',     '4cl', 19.00, false),
  ('Digestifs','Bailey''s 17°',          '4cl',  8.00, false),
  ('Digestifs','Calvados 40°',           '4cl',  8.00, false),

  -- Cocktails
  ('Cocktails','Mojito (fraise/passion/framboise)',        null, 13.00, false),
  ('Cocktails','Pina Colada',                              null, 13.00, false),
  ('Cocktails','Caïpirinha / Caïpiroska',                  null, 13.00, false),
  ('Cocktails','Mule (Hennessy/London/Jamaican)',          null, 13.00, false),
  ('Cocktails','Pornstar Martini',                         null, 13.00, false),
  ('Cocktails','Mango Star',                               null, 13.00, false),
  ('Cocktails','Long Island',                              null, 15.00, false),
  ('Cocktails','Ajout de soft aux alcools (diluant)',      null,  1.00, false),

  -- Sans alcool
  ('Sans alcool','Virgin Colada',                                     null, 9.00, false),
  ('Sans alcool','Bali Bali',                                         null, 9.00, false),
  ('Sans alcool','Virgin Mojito (fraise/passion/framboise/mangue)',   null, 8.00, false),

  -- Vins — Blancs
  ('Vins — Blancs','Chardonnay',                             '15cl',  6.00, false),
  ('Vins — Blancs','Chardonnay',                             '75cl', 25.00, false),
  ('Vins — Blancs','Côtes de Gascogne moelleux IGP',         '15cl',  6.50, false),
  ('Vins — Blancs','Côtes de Gascogne moelleux IGP',         '75cl', 26.00, false),
  ('Vins — Blancs','M de Minuty Côtes de Provence AOP',      '15cl',  6.50, false),
  ('Vins — Blancs','M de Minuty Côtes de Provence AOP',      '75cl', 26.00, false),

  -- Vins — Rouges
  ('Vins — Rouges','Côte Rôtie',                                  '15cl',  9.00, false),
  ('Vins — Rouges','Côte Rôtie',                                  '75cl', 60.00, false),
  ('Vins — Rouges','Saint Nicolas de Bourgueil',                 '15cl',  7.00, false),
  ('Vins — Rouges','Saint Nicolas de Bourgueil',                 '75cl', 28.00, false),
  ('Vins — Rouges','Château de Pommard « Cuvée Emilie »',        '75cl',130.00, false),
  ('Vins — Rouges','Château de Pommard « Cuvée 75 rangs »',      '75cl',150.00, false),
  ('Vins — Rouges','Château de Pommard « Cuvée Nicolas Joseph »','75cl',150.00, false),

  -- Vins — Rosés
  ('Vins — Rosés','Gérard Bertrand Gris Blanc IGP',              '15cl',  6.00, false),
  ('Vins — Rosés','Gérard Bertrand Gris Blanc IGP',              '75cl', 26.00, false),
  ('Vins — Rosés','Gérard Bertrand Gris Blanc IGP',              '150cl',50.00, false),
  ('Vins — Rosés','Le « M » de Minuty Côtes de Provence AOP',    '15cl',  7.00, false),
  ('Vins — Rosés','Le « M » de Minuty Côtes de Provence AOP',    '75cl', 29.00, false),
  ('Vins — Rosés','Le « M » de Minuty Côtes de Provence AOP',    '150cl',65.00, false),
  ('Vins — Rosés','La Cuvée Prestige de Minuty AOP',             '75cl', 35.00, false),

  -- Sélection Prestige de l'Arche
  ('Prestige de l''Arche','Chardonnay « Cloudy Bay » Nouvelle-Zélande (blanc)',        '75cl', 65.00, false),
  ('Prestige de l''Arche','Sancerre Les Rochettes 2023 (blanc)',                       '75cl', 65.00, false),
  ('Prestige de l''Arche','Pinot Noir « Cloudy Bay » Nouvelle-Zélande (rouge)',        '75cl', 65.00, false),
  ('Prestige de l''Arche','Châteauneuf-du-Pape millésimé 2023 maison Castel (rouge)',  '75cl', 75.00, false),
  ('Prestige de l''Arche','Côte Rôtie E. Guigal brune et blonde AOP (rouge)',          '75cl',120.00, false),

  -- Champagnes & Grands Crus
  ('Champagnes & Grands Crus','Champagne à la coupe',                '10cl',  13.00, false),
  ('Champagnes & Grands Crus','Champagne Moët & Chandon',            '70cl',  80.00, false),
  ('Champagnes & Grands Crus','Champagne Moët & Chandon',            '150cl',175.00, false),
  ('Champagnes & Grands Crus','Champagne Moët & Chandon',            '300cl',450.00, false),
  ('Champagnes & Grands Crus','Champagne Moët & Chandon',            '600cl',900.00, false),
  ('Champagnes & Grands Crus','Champagne Moët & Chandon rosé',       '70cl', 110.00, false),
  ('Champagnes & Grands Crus','Champagne Veuve Clicquot',            '70cl',  90.00, false),
  ('Champagnes & Grands Crus','Champagne Ruinart Brut',              '70cl', 140.00, false),
  ('Champagnes & Grands Crus','Champagne Ruinart Blanc de Blancs',   '70cl', 220.00, false),
  ('Champagnes & Grands Crus','Champagne Krug Grande Cuvée brut',    '70cl', 430.00, false),
  ('Champagnes & Grands Crus','Champagne Dom Pérignon brut',         '70cl', 390.00, false),

  -- Bières
  ('Bières','Bière blonde 5° (pression)',            '25cl', 5.00, false),
  ('Bières','Bière blonde 5° (pression)',            '50cl', 8.50, false),
  ('Bières','Bière rouge 5° (pression)',             '25cl', 5.00, false),
  ('Bières','Bière rouge 5° (pression)',             '50cl', 8.50, false),
  ('Bières','Triple Karmeliet 8° (pression)',        '25cl', 6.00, false),
  ('Bières','Triple Karmeliet 8° (pression)',        '50cl', 9.00, false),
  ('Bières','Goose Island IPA 5.9° (pression)',      '25cl', 6.00, false),
  ('Bières','Goose Island IPA 5.9° (pression)',      '50cl', 9.00, false),
  ('Bières','Corona 0 (bouteille)',                  '33cl', 7.00, false),
  ('Bières','Bud (bouteille)',                       '33cl', 7.00, false),

  -- Eaux, Softs, Jus, Sirops
  ('Eaux, Softs, Jus','Vittel',                     '50cl',  4.50, false),
  ('Eaux, Softs, Jus','Vittel',                     '100cl', 6.00, false),
  ('Eaux, Softs, Jus','San Pellegrino',             '50cl',  4.50, false),
  ('Eaux, Softs, Jus','San Pellegrino',             '100cl', 6.00, false),
  ('Eaux, Softs, Jus','Coca-Cola / Zéro',           '33cl',  5.00, false),
  ('Eaux, Softs, Jus','Fuzetea pêche',              '25cl',  5.00, false),
  ('Eaux, Softs, Jus','Perrier',                    '33cl',  5.00, false),
  ('Eaux, Softs, Jus','Schweppes Tonic',            '25cl',  5.00, false),
  ('Eaux, Softs, Jus','Schweppes Agrum',            '25cl',  5.00, false),
  ('Eaux, Softs, Jus','Orangina',                   '25cl',  5.00, false),
  ('Eaux, Softs, Jus','Oasis Tropical',             '25cl',  5.00, false),
  ('Eaux, Softs, Jus','Limonade',                   '25cl',  3.50, false),
  ('Eaux, Softs, Jus','Diabolo',                    '25cl',  4.00, false),
  ('Eaux, Softs, Jus','Sirop à l''eau (violette, grenadine, menthe, fraise, citron, pêche, cerise, orgeat, kiwi)','25cl',2.50, false),
  ('Eaux, Softs, Jus','Jus (abricot, orange, ananas, pomme, fraise)','25cl',4.00, false),

  -- Boissons chaudes (midi uniquement)
  ('Boissons chaudes','Espresso',          null, 2.20, false),
  ('Boissons chaudes','Allongé',           null, 2.40, false),
  ('Boissons chaudes','Double espresso',   null, 4.00, false),
  ('Boissons chaudes','Noisette',          null, 2.50, false),
  ('Boissons chaudes','Grand crème',       null, 4.50, false),
  ('Boissons chaudes','Thé',               null, 4.00, false),
  ('Boissons chaudes','Café viennois',     null, 4.80, false)
) as v(categorie, nom, format, prix_vente, a_verifier)
where not exists (select 1 from public.produits_bar where venue = 'eden');

commit;

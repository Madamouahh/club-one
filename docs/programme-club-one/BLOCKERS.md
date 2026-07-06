# Club One — Registre des blocages (portes humaines regroupées)

*Un blocage n'arrête pas le programme : on l'enregistre, on isole la fonctionnalité derrière un feature
flag, on poursuit les autres chantiers, et on regroupe les portes humaines ici pour une demande unique.*

## Portes FONDATEUR (regroupées — ne pas redemander une par une)

| # | Porte | Bloque quoi | Contournement en attendant |
|---|---|---|---|
| G-1 | **Rendre le dépôt GitHub privé** (Settings → Danger Zone → Private) | le push de la branche (dépôt public + mdp dans l'historique) | on garde tout en LOCAL (jamais poussé) |
| G-2 | **Rotation des mots de passe staff** (nouveaux dans `staff-passwords.local.json` → seed) | cutover sécurisé | anciens = compromis, documenté |
| G-3 | **Fenêtre + GO cutover** `0008 → 0045` (hors-soirée, front+DB coordonnés) | la mise en prod de la version neuve | la soirée tourne sur la prod actuelle |
| G-4 | **Credentials smoke navigateur** (7 rôles dont promoteur A/B) — saisis par le fondateur | preuve navigateur end-to-end | preuve SERVEUR (RLS/RPC) faite ; preview local OK |
| G-5 | **Décision anti-abus résa publique** (captcha/OTP/rate-limit) | exposition de `/invite` public | ne pas exposer la résa publique au lancement |
| G-6 | **Vraie liste staff + taux horaires** (RH) | données réelles RH/paie | modèle prêt, données = placeholder honnête |
| G-7 | **Activation adaptateurs externes** (SMS/email/WhatsApp/caisse-JDC/paiements) + clés + budget | envois/paiements RÉELS | adaptateurs construits, `NON ACTIVÉ`, aucun envoi |
| G-8 | **Données réelles** : prix d'achat/quantités stock, fournisseurs, équipements, budgets pub, avis Google/Meta | remplir les modules avec du réel | schéma + écrans prêts, vides honnêtes |

## Blocages TECHNIQUES connus (non bloquants pour le programme)

- Vérifs labo en dérive (0020/0024/atomic) = fixtures vs 0031/0041 → à réconcilier (P2, équipe 14).
- ~~Collision de préfixe `0032`~~ **RÉSOLUE** (2026-07-06) : active_event_venue → 0052 ; produits_bar garde 0032 (dépendu par 0010/0034/0035). cf. MIGRATIONS_REGISTRY §3.
- `app/page.tsx` monolithe 8000 l. → extraction progressive en `app/_modules/*` (dette, non bloquant).

*(Aucune dépense engagée. Aucune écriture prod. Aucun envoi réel.)*

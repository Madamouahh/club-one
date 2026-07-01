---
name: incident-review
description: Revue d'incident Club One — arreter les ecritures, preserver les preuves, analyser, limiter le perimetre, proposer un rollback, rapporter. Use when something has gone wrong (data issue, security exposure, failed migration, broken auth) on Club One, in any environment.
---

# Revue d'incident (Club One)

## Quand l'utiliser
Des qu'un probleme reel est constate (donnee corrompue, exposition inter-roles, migration echouee, panne Auth) — quel que soit l'environnement (dev, non-production, production).

## Etapes

1. **Arreter les ecritures** — identifier et signaler tout chemin d'ecriture actif qui aggraverait l'incident (mutation front, migration en cours, script en cours). Ne pas executer d'action destructive supplementaire pour "reparer vite".
2. **Preserver les preuves** — capturer l'etat observe (messages d'erreur, requetes en cause, fichiers concernes) sans modifier quoi que ce soit tant que l'analyse n'est pas faite.
3. **Analyser** — cause racine, pas seulement le symptome. Distinguer bug applicatif / probleme RLS / probleme de migration / erreur operateur.
4. **Limiter le perimetre** — quels roles, quelles tables, quelle periode sont reellement affectes ? Eviter de supposer un impact plus large ou plus etroit que ce qui est prouve.
5. **Rollback** — proposer un chemin de retour arriere concret ; si aucun n'existe, le dire explicitement plutot que d'improviser une action irreversible.
6. **Rapport** — chronologie, cause, impact reel (avec preuve), correctif applique ou propose, mesure pour eviter la recurrence.

## Contraintes
- Toute action correctrice sur une base reelle (non-production ou production) necessite un GO explicite, meme en urgence — sauf instruction contraire deja donnee par l'utilisateur pour ce type precis d'incident.
- Aucun secret affiche pendant l'analyse, meme pour deboguer.

## Sortie attendue
Chronologie → cause racine → perimetre reel affecte (preuve) → action prise/proposee → risque residuel → prevention.

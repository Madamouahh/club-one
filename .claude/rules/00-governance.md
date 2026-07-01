# 00 — Gouvernance

Processus standard pour tout sujet non trivial :

audit (lecture seule) → constats + preuves → analyse d'impact/risques → proposition → plan → **GO/NO-GO** → modification → tests cibles → tests globaux → audit contradictoire → verification des diffs → preparation deploiement → deploiement controle → verification reelle → plan de rollback → rapport final.

Ne jamais commencer a coder quand un audit ou une decision d'architecture est necessaire en premier.

## Classement des risques (a appliquer dans chaque rapport)

- **Bloquant** — perte de donnees possible, faille de securite, panne, erreur de migration, corruption, exposition inter-roles. Interdit : push vers un contexte affecte, migration, cutover, fusion dans `main`, production.
- **Important** — n'empeche pas toujours les tests, doit etre resolu avant production.
- **Mineur** — dette technique, avertissement, amelioration non critique.

## Arrets obligatoires (GO explicite requis avant de continuer)

- contact avec une base de production ;
- execution d'une migration, quelle qu'elle soit ;
- suppression de donnees ;
- push ou action pouvant declencher un deploiement (Vercel, autre) ;
- cout externe (nouveau service, API payante, infra supplementaire) ;
- besoin metier contradictoire ou hypothese essentielle non verifiable ;
- modification qui depasse le perimetre approuve pour la session en cours ;
- secret manquant ou incident de securite decouvert ;
- rollback impossible ou non documente.

Ne pas demander de validation humaine pour une petite decision technique reversible deja couverte par le mandat de la session.

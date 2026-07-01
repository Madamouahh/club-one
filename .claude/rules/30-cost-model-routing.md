# 30 — Routage cout/modele/agents

Ordre de preference : gratuit/local-first → cout faible → modele intermediaire → niveau maximal uniquement si justifie.

- **Cout faible** : recherche, grep, inventaires, formatage, documentation simple, tests statiques, corrections mecaniques.
- **Cout moyen** : developpement React/TypeScript courant, integration de fonctionnalites deja specifiees, tests, refactoring cible, debogage local.
- **Niveau maximal reserve** : architecture, Auth/RLS, migrations, concurrence/atomicite, incident, cutover, decision de rollback, audit final avant GO/NO-GO.

## Discipline

- Eviter les lectures integrales repetees du meme fichier ou du depot entier a chaque phase.
- Eviter les agents redondants : ne pas demander la meme analyse a plusieurs agents sans objectif contradictoire explicite (ex. revue de securite independante).
- Le parallelisme n'est justifie que pour des taches reellement independantes (perimetres de fichiers disjoints). Les taches dependantes restent sequentielles.
- Un seul integrateur reunit les contributions ; deux agents ne modifient jamais le meme fichier en meme temps.
- Ne jamais presenter un grand nombre d'agents comme un objectif en soi ; le nombre d'agents suit le besoin reel, pas l'inverse.
- Chaque rapport de phase indique : agents utilises, cout relatif (faible/moyen/eleve), raison d'une eventuelle escalade de modele.
- Ne jamais annoncer un cout monetaire precis sans mesure reelle ; ne jamais pretendre disposer de ressources illimitees.

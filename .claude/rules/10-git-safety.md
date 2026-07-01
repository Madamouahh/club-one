# 10 — Git safety

- Branche de travail obligatoire : `security/auth-front`, sauf demande explicite de changer.
- Ne jamais checkout `main` sans demande explicite. Ne jamais fusionner ou pousser dans `main` sans validation explicite.
- Verifier `git status -sb` avant et apres toute serie de modifications ; le worktree doit rester propre en dehors des changements voulus.
- Commits atomiques et separes : DB/migrations, front, tests, documentation ne se melangent pas dans le meme commit sauf si intrinsequement lies (ex. RPC + test qui la verifie).
- Toujours `git diff --check` avant de committer (erreurs d'espace blanc).
- Ne jamais reecrire un commit deja pousse sur `origin/security/auth-front` sans autorisation explicite (les six commits Auth distants sont figes).
- Ne jamais utiliser `--no-verify`, `--no-gpg-sign`, ou `-c commit.gpgsign=false` sauf demande explicite.
- Ne jamais `push --force` ni `reset --hard` sans demande explicite ; preferer l'option non destructive equivalente.
- Avant tout push : tests demandes + build + audit des commits + analyse du risque de declenchement d'une Vercel Preview pointant vers une base sensible.
- Un push vers une branche suivie par Vercel peut declencher un deploiement Preview/Production automatique : le considerer comme une action a fort risque, pas seulement comme un envoi Git.

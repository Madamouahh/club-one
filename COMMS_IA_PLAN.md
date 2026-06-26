# Communication assistée par IA — plan (Priorité 2)

Principe (cahier des charges) : l'IA **prépare**, un humain **valide**, rien n'est publié ou envoyé
automatiquement. **Aucune intégration simulée** : Runway / Midjourney / Adobe Express restent des
outils manuels — l'IA produit des **briefs / prompts / scripts / textes**, l'export reste humain.

## Architecture (Back Office, séparé du temps réel)
Déclencheur = un `event` publié dans Club One (voir `EVENTS_ET_BOUCLE.md`).
À partir d'un événement, le back office génère un **paquet de contenu** mis en file pour validation :
- légende Instagram/Facebook + hashtags par univers,
- script de reel/TikTok (hook + plan + CTA),
- prompt **Midjourney** (visuel/fond, selon la DA de l'univers),
- prompt **Runway** (animation/teaser à partir d'un visuel),
- gabarit **Adobe Express** (affiche/story : textes + hiérarchie),
- proposition de **calendrier** (J-10 teaser, J-3 line-up, J-1 rappel, J-0 live, J+1 aftermovie).

## Identité éditoriale par univers (à respecter dans tout contenu)
- **Éden** — lifestyle, solaire, sensoriel ; sunset/cocktails/afterwork ; doux. Hashtags : #rooftop #sunset #afterwork #amiens.
- **Le Cercle** — chic, feutré, adulte ; house/disco/funk, rétro chic ; sobre. (⚠️ rebrand à valider avant publication.)
- **Le Terminus** — urbain, punchy, viral ; afro/amapiano/shatta/rap/classics ; énergie. Hashtags : #afro #amapiano #shatta #amiens #club.

## Gabarits de prompts (exemples, à affiner)
- Midjourney (Terminus) : `nightclub crowd, neon magenta and cyan lights, energetic, cinematic haze, urban, dynamic motion blur, premium poster background --ar 4:5 --style raw`
- Midjourney (Éden) : `rooftop terrace at golden hour, mediterranean lounge, lanterns and greenery, warm terracotta light, elegant, cinematic --ar 4:5`
- Runway : « anime ce visuel : léger mouvement de caméra avant, particules de lumière, 4s, boucle ».
- Légende (gabarit) : `{accroche courte} · {line-up} · {date} · {lieu} · {CTA réserver} {hashtags univers}`.

## Détection de leads / avis / messages (cadre)
- Centraliser les messages entrants (DM Insta/FB, formulaire site) dans une file à traiter — **réponses suggérées**, validées par un humain.
- Avis Google : suivi + brouillons de réponse ; jamais de faux avis.

## Garde-fous (non négociables)
- Aucun envoi/post autonome (RGPD : nurturing sur opt-in uniquement).
- Aucune donnée inventée (chiffres, témoignages, partenaires, line-ups) — placeholders explicites.
- L'IA lourde (génération) ne touche jamais le chemin temps réel de la soirée.

## État
Document de cadrage (cette nuit). La mécanique (file de contenu + UI de validation) est à construire
après la sécurité et le site ; elle s'appuiera sur le modèle `events`.

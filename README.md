# La Nuit du Bout du Monde

> Jeu de rôle textuel génératif, conçu par Jordan Quiqueret.

Une nuit dans une mégapole battue par la pluie, écrite pour un seul joueur. On
commence par remplir un formulaire au bureau des admissions ; la ville, ses
habitants et la quête en naissent. On joue ensuite en tapant ce qu'on veut
faire. Chaque scène, chaque réplique et chaque illustration est générée à la
volée à partir du dossier d'admission et des gestes précédents. Le jeu se joue
en douze langues.

Le parcours suit trois actes et un épilogue :
`auberge → a1s1 → a1s2 → a2s1 → a2s2 → a3s1 → a3s2 → fin`. La suite de
l'auberge passe par un paywall (12 €, via Square).

---

## Sommaire

- [Stack](#stack)
- [Démarrage rapide](#démarrage-rapide)
- [Variables d'environnement](#variables-denvironnement)
- [Architecture](#architecture)
- [Mécaniques serveur](#mécaniques-serveur)
- [Outils de mise au point](#outils-de-mise-au-point)
- [Tests et contrôles](#tests-et-contrôles)
- [Déploiement](#déploiement)
- [Documents annexes](#documents-annexes)

## Stack

| Domaine     | Outil                                                                  |
|-------------|------------------------------------------------------------------------|
| Framework   | [Nuxt 3](https://nuxt.com) (Vue 3, Nitro), TypeScript                  |
| État        | Pinia                                                                  |
| Style       | Tailwind CSS (`@nuxtjs/tailwindcss`)                                   |
| Texte       | OpenAI `gpt-4o` : génération de scène, tours de narration en SSE       |
| Images      | OpenAI `gpt-image-2`, avec repli sur `gpt-image-1`                     |
| Paiement    | Square (Web Payments SDK côté client, API côté serveur)                |
| Audio       | Tone.js                                                                |
| Hébergement | Vercel (preset Nitro `vercel`), ou n'importe quel hôte Node (`Procfile`) |

Les modèles, les prompts et les tarifs ne sont pas codés en dur : ils sont
déclarés dans `game/script.json`.

## Démarrage rapide

Prérequis : **Node 22+** (les tests exécutent du TypeScript directement avec
`node --test`).

```bash
npm install          # lance aussi `nuxt prepare`
touch .env           # puis renseigner les variables ci-dessous
npm run dev          # http://localhost:3000
```

Un `.env` minimal pour le développement :

```dotenv
APP_ENV=local
OPENAI_API_KEY=sk-...
NUXT_SECRET=une-longue-chaine-aleatoire
```

Autres scripts :

```bash
npm run build      # build de production (.output/)
npm run preview    # sert le build localement
npm run generate   # génération statique
```

## Variables d'environnement

| Variable                 | Rôle                                                                                                                                   | Par défaut     |
|--------------------------|----------------------------------------------------------------------------------------------------------------------------------------|----------------|
| `APP_ENV`                | `local` ou `production`. C'est le **seul** interrupteur des fonctions de mise au point (admin, inventaire de test, mocks, verrou levable). | `production`   |
| `OPENAI_API_KEY`         | Clé OpenAI (texte et images).                                                                                                          | —              |
| `NUXT_SECRET`            | Clé HMAC qui signe les cookies de quota, d'accès, de fermeture et de position.                                                         | —              |
| `IMAGES`                 | `1` active la génération d'images. Sans cette valeur, un aplat remplace chaque appel, en local comme en production.                   | désactivé      |
| `DEV_MOCKS`              | `1` enregistre les générations dans `.mocks/` puis les rejoue (uniquement avec `APP_ENV=local`).                                      | désactivé      |
| `LOCK_OVERRIDE`          | `0` retire le bouton « lever la limite » de l'écran de fermeture et ferme `/admin/route` en production.                               | activé         |
| `SQUARE_ACCESS_TOKEN`    | Jeton serveur Square.                                                                                                                  | —              |
| `SQUARE_APPLICATION_ID`  | Identifiant d'application Square (public).                                                                                             | —              |
| `SQUARE_LOCATION_ID`     | Identifiant de location Square (public).                                                                                               | —              |
| `SQUARE_ENVIRONMENT`     | `sandbox` ou `production`.                                                                                                             | `sandbox`      |

> **Lu au build ou à l'exécution ?** Les secrets serveur (`OPENAI_API_KEY`,
> `NUXT_SECRET`, `SQUARE_ACCESS_TOKEN`) sont relus à l'exécution par
> `server/utils/runtime-secrets.ts`. Toutes les autres valeurs sont figées au
> build. Sur Vercel, il faut donc **redéployer** après les avoir modifiées.

`.env*` et `.mocks/` sont ignorés par git.

## Architecture

```
game/                 Contenu du jeu, la source de vérité
  script.json         Scènes, actes, prompts, modèles, paywall, limites, palette, économie
  admission.json      Formulaire d'admission
  lang/*.json         Packs d'interface (12 langues ; fr fait référence)
server/
  api/scene/          Génération du texte et de l'image d'une scène
  api/narrative/      Tour de jeu en streaming SSE
  api/image/          Génération d'image
  api/payment/        Intent et confirmation de paiement Square
  api/access, paywall, lockout, user/demo   État d'accès du joueur
  api/admin/          Données des pages d'admin (local uniquement)
  api/dev/            Outils de développement
  middleware/         admin-guard : 404 sur /admin hors local
  utils/              Quota signé, Square, image-gen, mocks, langue, empreinte du script
  routes/             robots.txt, sitemap.xml
pages/                index.vue (le jeu) + admin/{story,route,marge}.vue
components/
  screens/            Écrans plein cadre : login, admission, chargement, paywall, fin…
  game/               Coquille de jeu : saisie, PNJ, énigmes, inventaire, réglages…
  ui/                 Primitives (GlowButton, TypewriterText, SlideToConfirm)
composables/          Logique côté client (useScene, useNarrative, usePaywall, useLang…)
stores/               Stores Pinia : game, player, payment
utils/                Logique pure et testée (puzzles, palette, prompt-builder, script-runtime…)
plugins/              Plugins client : audio, palette d'interface, mémoire de partie
types/                Types partagés (script, scène, jeu, utilisateur, i18n)
scripts/              Contrôles hors-ligne du contenu
tests/                Tests de non-régression
communication/        Visuels réseaux sociaux et leurs sources
```

### Le script comme configuration

`nuxt.config.ts` lit `game/script.json` au chargement pour en tirer la palette
de l'interface, l'index des scènes, le prix et l'empreinte du script. Seules ces
valeurs partent au client : le contenu du script reste côté serveur. En dev, le
fichier est surveillé (`watch`), donc une modification est prise en compte sans
redémarrage.

L'**empreinte du script** (SHA-256 tronqué) est attachée à chaque scène servie.
Quand le script change, le client jette les scènes qu'il avait gardées en
session, et les mocks de développement sont invalidés.

## Mécaniques serveur

- **Quota par session.** Un cookie signé HMAC (`server/utils/session-quota.ts`)
  compte les scènes, les tours et les images. Il borne la dépense sans base de
  données. Les limites `free` (avant paiement) et `paid` (après, sur une fenêtre
  de 8 jours) sont définies dans `script.json → limits`. Elles sont **désactivées
  pendant la phase de test** (`limits.enabled: false`) et doivent être réactivées
  avant toute ouverture publique.
- **Fermeture.** Indépendante du quota et toujours active : au-delà de 10 tours
  dans une même scène, la ville se « recharge » pendant 24 h. Une histoire
  terminée ne se rejoue pas.
- **Paywall.** `server/api/payment/*` + `server/utils/square.ts`. Le paiement
  confirmé ouvre un cookie d'accès signé.
- **Coûts.** Un cache d'images en mémoire évite de payer deux fois le même
  prompt. La page `/admin/marge` détaille l'économie du jeu.
- **Durée.** Une scène et sa reprise peuvent prendre ~160 s, d'où le
  `maxDuration: 300` déclaré pour les fonctions Vercel.

## Outils de mise au point

Ils ne sont disponibles qu'avec `APP_ENV=local`. Ailleurs, ils répondent 404
(pas 403 : une page d'admin ne signale pas sa propre existence). Le garde est
double : `server/middleware/admin-guard.ts` côté serveur, `middleware/admin.ts`
pour la navigation client.

| Page            | Rôle                                                                   |
|-----------------|------------------------------------------------------------------------|
| `/admin/story`  | Lecture de l'histoire et du script                                     |
| `/admin/route`  | Plan des scènes (reste ouvert en production tant que `LOCK_OVERRIDE` n'est pas à `0`) |
| `/admin/marge`  | Tableau de bord économique : mesuré, facturé, hypothèses               |

En jeu, la commande `#scene<n>` (par exemple `#scene3`) saute directement à une
scène. `#scene` sans numéro affiche la liste.

## Tests et contrôles

```bash
npm test                                   # tests unitaires (node:test) des utils/*.test.ts
node --test tests/scene-regeneration.test.mjs
node scripts/check-script.mjs              # structure du script : ids, ordre, renvois
node scripts/check-lang.mjs                # clés manquantes ou orphelines dans les 12 packs
node scripts/check-palette.mjs             # main.css ↔ palette déclarée dans le script
```

Aucun de ces contrôles n'appelle OpenAI : on les lance sans risque de payer une
génération.

## Déploiement

**Vercel** (cible actuelle) : le preset Nitro est choisi automatiquement grâce à
la variable `VERCEL`. Renseigner les variables d'environnement dans le
dashboard, puis redéployer à chaque modification d'une valeur lue au build.

**Hôte Node générique** : `npm run build`, puis `Procfile`
(`node .output/server/index.mjs`).

## Documents annexes

- `roadmap.md` : suivi des chantiers
- `Dossier-de-presentation-La-Nuit-du-Bout-du-Monde.pdf` : présentation du projet
- `Mecanique-La-Nuit-du-Bout-du-Monde.pdf` : guide « Mécaniques de la nuit »
- `Kit-graphique-La-Nuit-du-Bout-du-Monde.pdf` : identité visuelle

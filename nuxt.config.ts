import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

/**
 * La palette qui teint les premiers écrans.
 *
 * Lue dans le script au build et exposée telle quelle : l'accueil et la scène 1
 * n'ont pas de scène chargée d'où tirer leurs couleurs, mais leur rose doit
 * quand même venir d'un `palette.accent` — le même chemin que les scènes
 * générées, une seule source de vérité. Seules ces trois couleurs partent au
 * client : le script entier n'a rien à y faire.
 */
const script = JSON.parse(readFileSync(
  new URL('./game/script.json', import.meta.url), 'utf-8',
))
const uiPalette = script.defaults.interface_palette.palette

/**
 * L'empreinte du script, telle que le client peut la comparer.
 *
 * Le serveur en tamponnait déjà chaque scène (`script_fingerprint`) en
 * annonçant qu'elle servirait « à jeter une scène gardée en session dès que le
 * script a changé ». Personne ne la lisait : le client ne comparait que le
 * `build_id`, qui ne bouge pas d'un rechargement à l'autre. Résultat, modifier
 * un prompt ne changeait rien pour qui avait déjà une scène dans son onglet —
 * on croyait livrer sans effet.
 *
 * Même calcul que `server/utils/script-fingerprint.ts`, sur le même objet
 * reparsé : les deux empreintes coïncident.
 */
const scriptFingerprint = createHash('sha256')
  .update(JSON.stringify(script)).digest('hex').slice(0, 12)

/**
 * L'ordre des scènes, pour que `#scene<n>` sache où aller.
 *
 * Des identifiants et des titres, rien d'autre : le contenu du script reste
 * côté serveur. C'est ce qui permet au raccourci de désigner une scène par son
 * numéro sans que le client connaisse l'histoire.
 */
/**
 * `local` ou `production`, posé par `APP_ENV`. Absent : `production`, pour
 * qu'un oubli n'ouvre jamais rien. Lu au build. Voir utils/app-env.ts.
 */
const appEnv = process.env.APP_ENV === 'local' ? 'local' : 'production'

/**
 * L'inventaire de développement, exposé en local uniquement.
 *
 * En production il vaut `null` : aucun joueur ne doit recevoir un jeu complet
 * de cartes, et la liste n'a même pas à figurer dans le bundle.
 */
const devInventory = appEnv === 'local' ? script.dev_inventory : null

/**
 * Combien de jours le navigateur du joueur retient sa partie.
 *
 * Même valeur que la fenêtre payante, et pour la même raison que le cookie de
 * position : la mémoire ne doit pas survivre au droit qui permet de s'en
 * servir. Une seule source, le script.
 */
const memoryDays = script.limits.paid.window_days

const sceneIndex = script.progression.order.map((id: string) => {
  const scene = script.scenes.find((s: { id: string }) => s.id === id)
  // `scene.act` est un IDENTIFIANT — « route », « hauteurs ». L'accueil
  // l'affichait tel quel sous le bouton « Continuer » : on résout ici le titre
  // qui va avec, et on garde l'identifiant pour que le pack de langue puisse
  // le traduire à la lecture. L'auberge porte l'acte « ouverture », qui n'a pas
  // d'entrée : elle ne montre alors aucun acte, ce qui vaut mieux qu'un mot nu.
  const act = script.acts.find((a: { id: string }) => a.id === scene?.act)
  return {
    id,
    title: scene?.title ?? id,
    actId: scene?.act ?? null,
    act: act?.title ?? null,
    kind: scene?.kind ?? 'scene',
  }
})

/**
 * Ce que le jeu dit de lui, hors du jeu.
 *
 * Un seul écran, une seule URL : tout le référencement tient ici et dans
 * `app.vue`, qui y ajoute les adresses absolues (canonique, image sociale) et
 * les données structurées. Le texte est en français ; le jeu, lui, se joue
 * en douze langues, et la description ne le restreint plus à une seule.
 */
const SITE_NAME = 'La Nuit du Bout du Monde'
const CREATOR = 'Jordan Quiqueret'
const SEO_TITLE = `${SITE_NAME} — jeu de rôle textuel`

/** 150 caractères : au-delà, les moteurs coupent. */
const SEO_DESCRIPTION
  = "Jeu de rôle textuel. Vos réponses au formulaire "
  + `d'admission bâtissent une ville et une quête qui n'appartiennent qu'à vous. Par ${CREATOR}.`

/** Les réseaux tolèrent plus long : on y ajoute ce que le jeu fait vraiment. */
const SOCIAL_DESCRIPTION
  = "Une nuit dans une mégapole battue par la pluie, écrite pour vous seul. Vous déclarez "
  + "qui vous êtes au bureau des admissions ; la ville, ses habitants et sa quête "
  + "en naissent, illustrés scène après scène. On y joue en tapant ce qu'on veut "
  + `faire. Conçu par ${CREATOR}.`

export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  devtools: { enabled: true },

  modules: [
    '@nuxtjs/tailwindcss',
    '@pinia/nuxt',
    '@vercel/analytics/nuxt',
  ],

  components: [
    { path: '~/components', pathPrefix: false },
  ],

  css: ['~/assets/css/main.css'],

  app: {
    head: {
      title: SEO_TITLE,
      htmlAttrs: { lang: 'fr' },
      meta: [
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
        { name: 'theme-color', content: '#080b12' },

        { name: 'description', content: SEO_DESCRIPTION },
        { name: 'author', content: CREATOR },
        { name: 'robots', content: 'index, follow, max-image-preview:large' },

        // Partage : l'image et l'adresse absolues sont posées dans app.vue,
        // qui seul connaît le domaine servi.
        { property: 'og:type', content: 'website' },
        { property: 'og:site_name', content: SITE_NAME },
        { property: 'og:locale', content: 'fr_FR' },
        { property: 'og:title', content: SEO_TITLE },
        { property: 'og:description', content: SOCIAL_DESCRIPTION },
        { property: 'og:image:width', content: '1200' },
        { property: 'og:image:height', content: '630' },
        {
          property: 'og:image:alt',
          content: `${SITE_NAME} — skyline à gradins au néon rose sur fond de nuit`,
        },

        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:title', content: SEO_TITLE },
        { name: 'twitter:description', content: SOCIAL_DESCRIPTION },
      ],
      link: [
        // Le .ico d'abord, pour les vieux navigateurs ; le SVG le remplace
        // partout où il est compris, et reste net à toutes les tailles.
        { rel: 'icon', href: '/favicon.ico', sizes: '48x48' },
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
        { rel: 'manifest', href: '/site.webmanifest' },
      ],
    },
  },

  runtimeConfig: {
    openaiApiKey: process.env.OPENAI_API_KEY,
    squareAccessToken: process.env.SQUARE_ACCESS_TOKEN,
    nuxtSecret: process.env.NUXT_SECRET,
    /**
     * Images coupées par défaut, en local comme en production : un aplat
     * remplace chaque appel OpenAI. `IMAGES=1` les rétablit (sur Vercel, puis
     * redéployer). Voir server/utils/image-gen.ts.
     */
    imagesOff: process.env.IMAGES !== '1',

    public: {
      /** `local` ou `production`. Voir utils/app-env.ts. */
      appEnv,
      /** Dominante, secondaire et accent de l'auberge. Voir plus haut. */
      uiPalette,
      /** Les dix scènes, dans l'ordre. Identifiants et titres seulement. */
      sceneIndex,
      /** Inventaire complet de test. `null` en production. */
      devInventory,
      /** Empreinte du script : une scène née d'une autre version est jetée. */
      scriptFingerprint,
      /** Durée de vie de la partie gardée par le navigateur, en jours. */
      memoryDays,
      /**
       * Le prix du droit d'accès, tel que le script le fixe.
       *
       * Exposé pour les données structurées d'`app.vue` : une offre annoncée
       * aux moteurs qui ne serait pas celle du paywall serait un mensonge, et
       * la recopier à la main garantissait qu'elles finiraient par diverger.
       */
      paywallPrice: {
        amount: script.paywall.amount_cents / 100,
        currency: script.paywall.currency,
      },
      /**
       * Bouton « lever la limite » sur l'écran de fermeture, en production.
       *
       * Temporaire, le temps des phases de test : sans lui un testeur qui fait
       * patiner une scène perd sa journée. Ouvert par défaut ; `LOCK_OVERRIDE=0`
       * le retire — à poser sur Vercel, puis redéployer (valeur lue au build).
       * En local le bouton est toujours là.
       */
      lockOverride: process.env.LOCK_OVERRIDE !== '0',
      squareApplicationId: process.env.SQUARE_APPLICATION_ID,
      squareLocationId: process.env.SQUARE_LOCATION_ID,
      squareEnvironment: process.env.SQUARE_ENVIRONMENT || 'sandbox',
    },
  },

  /**
   * Le script fait partie de la configuration.
   *
   * Il est lu ici, au chargement de nuxt.config, pour en tirer la palette, la
   * liste des scènes et l'empreinte. Sans ce watch, le modifier en dev laissait
   * ces trois valeurs périmées jusqu'au prochain redémarrage — et l'empreinte
   * périmée aurait fait jeter la scène de session à CHAQUE rechargement.
   */
  watch: ['game/script.json'],

  nitro: {
    preset: process.env.VERCEL ? 'vercel' : undefined,
    // Une scène et sa reprise tiennent jusqu'à ~160 s. Sans plafond déclaré,
    // Vercel coupe la fonction à sa durée par défaut, avant la réponse, et la
    // génération est payée pour rien. Le client attend 240 s.
    vercel: { functions: { maxDuration: 300 } },
  },
})

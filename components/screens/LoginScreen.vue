<script setup lang="ts">
import { useGameStore } from '~/stores/game'
import { usePlayerStore } from '~/stores/player'
import { useProgression } from '~/composables/useProgression'
import { forgetRun, rememberedAdmission, rememberedProfile } from '~/composables/useScene'
import { profileFromAdmission } from '~/utils/admission'
import type { UserProfile } from '~/types/user'
import type { LangCode } from '~/types/i18n'

const gameStore = useGameStore()
const playerStore = usePlayerStore()
const progression = useProgression()
const { lang, setLang, t, languages } = useLang()

/**
 * Le selecteur de langue est ICI AUSSI, et pas seulement dans le formulaire.
 *
 * L'accueil est la premiere chose que quiconque voit : y arriver en francais
 * sans pouvoir en sortir, c'est perdre le joueur avant la premiere ligne. Le
 * choix fait ici est ecrit dans le cookie, que le formulaire reprendra comme
 * valeur de depart.
 */

/**
 * La nuit en cours, s'il y en a une.
 *
 * Le joueur retombait ici à chaque rechargement, sans autre choix que de tout
 * recommencer à l'auberge — y compris avec un droit d'accès payé et sept scènes
 * derrière lui. `/api/access` dit maintenant où il en était ; il ne reste qu'à
 * le lui proposer.
 *
 * Sans dossier dans ce navigateur, pas de reprise : le cookie de position
 * survit à la mémoire locale, et « Continuer » menait alors à une nuit sans
 * joueur. C'est l'entrée par le formulaire qui reste.
 */
const resumeScene = computed(() => knownDossier.value ? progression.resumeTarget() : null)

/**
 * Le dossier que ce navigateur a retenu.
 *
 * C'est la promesse tenue de la mémoire locale : quelqu'un qui a déjà rempli
 * le formulaire ne le remplit pas deux fois — le bureau a ses données, il n'a
 * plus qu'à sortir. Et il doit le VOIR : une mémoire silencieuse serait la
 * mauvaise façon de tenir cette promesse-là.
 *
 * Lu après le montage : la mémoire du navigateur n'existe pas au rendu serveur,
 * et l'y toucher ferait diverger l'hydratation.
 */
const knownDossier = ref<UserProfile | null>(null)
onMounted(() => { knownDossier.value = rememberedProfile() ?? admittedProfile() })

/**
 * À défaut de partie gardée, le dossier rempli — prénom et date — suffit.
 *
 * La partie (`tg_carry`) ne s'écrit qu'une fois la première scène née : un
 * dossier déposé dont la génération n'a pas abouti — serveur redémarré, build,
 * onglet fermé pendant le chargement — renvoyait au formulaire.
 */
function admittedProfile(): UserProfile | null {
  const kept = rememberedAdmission()
  if (!kept || kept.form.birthday?.length !== 10 || !kept.form.firstName?.trim()) return null
  return profileFromAdmission({ ...kept.form, language: lang.value })
}

/** Le nom inscrit au dossier. Complet : c'est une pièce administrative. */
const rememberedName = computed(() => knownDossier.value?.identity.name ?? null)

/** Le prénom, pour lui parler. On n'interpelle personne par son état civil. */
const rememberedFirstName = computed(() =>
  knownDossier.value?.identity.first_name || rememberedName.value)

/**
 * « Sortir de chez vous », pour tout joueur déjà venu : il retourne là où il
 * en était, ou repart de l'auberge s'il n'y a rien à reprendre.
 */
function goOut() {
  if (!resumeScene.value) return goOutAgain()
  if (!playerStore.profile && knownDossier.value) playerStore.setProfile(knownDossier.value)
  progression.resume()
}

/**
 * Repartir de zéro.
 *
 * Efface la partie gardée par le navigateur, mais PAS les réponses au
 * formulaire : on y entre justement pour les retrouver. Les effacer est le
 * geste du bouton dédié, dans le formulaire.
 *
 * Sans ça, « commencer » servait la scène gardée — celle d'où l'on venait — au
 * lieu de l'auberge, et le journal des scènes précédentes suivait dans la
 * nouvelle partie.
 */
function startFresh() {
  forgetRun()
  knownDossier.value = null
  playerStore.journal = []
  playerStore.profile = null
  playerStore.reset()
  // Remet aussi `resumeSceneId` à null : la reprise proposée n'a plus d'objet.
  gameStore.resetGame()
}

/** Combien de jours le navigateur retient la partie. Dit tel quel au joueur. */
const memoryDays = useRuntimeConfig().public.memoryDays as number

/**
 * Le nombre d'etapes du formulaire, annonce avant d'y entrer. Une seule depuis
 * le 2026-10-13 : l'identite.
 */
const ADMISSION_STEPS = 1

/** Les quatre points de l'avertissement, dans la langue courante. */
const disclaimerPoints = computed(() => [
  t('login.disclaimer_1'),
  t('login.disclaimer_2'),
  t('login.disclaimer_3', { days: memoryDays }),
  t('login.disclaimer_4'),
])

const showDisclaimer = ref(false)

/**
 * Averse de mégapole. Les valeurs sont dérivées de l'index, jamais tirées au
 * hasard : un Math.random() donnerait un rendu serveur différent du rendu
 * client et Vue signalerait une incohérence d'hydratation.
 */
const raindrops = Array.from({ length: 44 }, (_, i) => ({
  left: (i * 37) % 100,
  height: 30 + (i * 11) % 70,
  delay: ((i * 13) % 22) / 10,
  duration: 0.7 + ((i * 7) % 7) / 10,
  opacity: 0.18 + ((i * 5) % 5) / 20,
}))

/**
 * Repartir pour une nuit avec le dossier déjà connu.
 *
 * On efface la partie précédente — journal, inventaire, scène gardée — mais on
 * REMET le profil aussitôt : c'est tout l'intérêt, le formulaire ne se remplit
 * qu'une fois. Le prochain enregistrement le réinscrira dans la mémoire du
 * navigateur.
 */
function goOutAgain() {
  const dossier = knownDossier.value
  if (!dossier) return
  startFresh()
  /**
   * Le dossier garde tout, SAUF la langue.
   *
   * Elle est le seul champ qu'on puisse changer sans rouvrir le formulaire —
   * le sélecteur est juste en dessous. Reprendre celle du dossier ferait donc
   * repartir dans l'ancienne langue quelqu'un qui vient d'en choisir une
   * autre, et le choix qu'il vient de faire n'aurait servi qu'à l'habillage.
   */
  playerStore.setProfile({ ...dossier, language: lang.value })
  gameStore.setScreen('scene_build_loading')
}

/**
 * Partager l'adresse du jeu, par la feuille de partage du système.
 *
 * Sans elle (Firefox de bureau, notamment), l'adresse part dans le
 * presse-papiers et l'icône le confirme d'une coche : aucune chaîne à traduire.
 * Le domaine est celui servi, comme l'adresse canonique d'app.vue.
 */
const { origin, host } = useRequestURL({ xForwardedHost: true })
const copied = ref(false)

async function shareSite() {
  const data = { title: t('seo.title'), url: `${origin}/` }
  if (navigator.share) {
    // Refermer la feuille sans rien partager rejette la promesse : pas une erreur.
    await navigator.share(data).catch(() => {})
    return
  }
  try {
    await navigator.clipboard.writeText(data.url)
    copied.value = true
    setTimeout(() => { copied.value = false }, 1800)
  } catch {
    // Ni partage ni presse-papiers : le domaine reste affiché, il se recopie.
  }
}

function openDisclaimer() {
  showDisclaimer.value = true
}

/** L'avertissement lu, on passe au formulaire — aucun compte, aucun tiers. */
function acceptAndEnroll() {
  showDisclaimer.value = false
  startFresh()
  gameStore.setScreen('admission')
}

/**
 * Les boutons d'entrée du bas de page font le même geste que celui du haut :
 * reprendre la nuit si le dossier est connu, sinon l'avertissement.
 */
function enter() {
  if (knownDossier.value) goOut()
  else openDisclaimer()
}
const ctaLabel = computed(() => knownDossier.value ? t('login.dossier_cta') : t('login.enroll_cta'))
const ctaNote = computed(() => knownDossier.value ? null : t('login.enroll_note', { steps: ADMISSION_STEPS }))

/** Le titre, sur une ligne : barre du haut, pied de page, message de partage. */
const gameTitle = computed(() => `${t('login.title_line1')} ${t('login.title_line2')}`)

/**
 * Les réseaux, par de simples liens : aucun script tiers, rien ne part tant
 * qu'on ne clique pas. Le message est la promesse du jeu, dans la langue
 * affichée.
 */
const shareLinks = computed(() => {
  const url = encodeURIComponent(`${origin}/`)
  const text = encodeURIComponent(`${gameTitle.value} — ${t('home.hero_promise')}`)
  return [
    { name: 'WhatsApp', href: `https://wa.me/?text=${text}%20${url}` },
    { name: 'Telegram', href: `https://t.me/share/url?url=${url}&text=${text}` },
    { name: 'X', href: `https://x.com/intent/post?text=${text}&url=${url}` },
    { name: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${url}` },
  ]
})

/**
 * LE DÉFILEMENT.
 *
 * Deux mécanismes, rien de plus. Chaque `[data-scrub]` reçoit `--p`, sa
 * progression de 0 à 1 dans l'écran, et le CSS en tire ses mouvements :
 *   - par défaut, de son entrée par le bas à sa sortie par le haut (0,5 =
 *     centré) ;
 *   - `pin` : section plus haute que l'écran dont le contenu reste collé, de
 *     son arrivée en haut à sa fin ;
 *   - `exit` : du haut de la page jusqu'à ce que l'élément soit sorti.
 * Chaque `[data-reveal]` reçoit `is-in` la première fois qu'il paraît.
 *
 * Si le système demande moins d'animation, `is-motion` n'est jamais posée :
 * tout est visible d'emblée et rien ne suit la molette.
 */
const root = ref<HTMLElement | null>(null)
const motion = ref(false)
const scrolled = ref(false)
let frame = 0
let observer: IntersectionObserver | null = null

function progressOf(el: HTMLElement, vh: number): number {
  const r = el.getBoundingClientRect()
  const p = el.dataset.scrub === 'pin' ? -r.top / Math.max(1, r.height - vh)
    : el.dataset.scrub === 'exit' ? -r.top / Math.max(1, r.height)
      : (vh - r.top) / (vh + r.height)
  return Math.min(1, Math.max(0, p))
}

function paint() {
  frame = 0
  const vh = window.innerHeight
  scrolled.value = window.scrollY > vh * 0.5
  if (!motion.value) return
  root.value?.querySelectorAll<HTMLElement>('[data-scrub]').forEach((el) => {
    el.style.setProperty('--p', progressOf(el, vh).toFixed(4))
  })
}

function onScroll() {
  if (!frame) frame = requestAnimationFrame(paint)
}

function toTop() {
  window.scrollTo({ top: 0, behavior: motion.value ? 'smooth' : 'auto' })
}

/** Le chevron du premier écran : on descend jusqu'au pied de la couverture, là où commence le pitch. */
function toNext(e: MouseEvent) {
  const hero = (e.currentTarget as HTMLElement).closest('section')
  const top = hero ? hero.offsetTop + hero.offsetHeight : window.innerHeight
  window.scrollTo({ top, behavior: motion.value ? 'smooth' : 'auto' })
}

onMounted(() => {
  motion.value = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      entry.target.classList.add('is-in')
      observer?.unobserve(entry.target)
    }
  }, { rootMargin: '0px 0px -10% 0px' })
  root.value?.querySelectorAll('[data-reveal]').forEach(el => observer?.observe(el))
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onScroll, { passive: true })
  paint()
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onScroll)
  if (frame) cancelAnimationFrame(frame)
  observer?.disconnect()
})

/**
 * L'écran suivant (formulaire, scène) tient dans la hauteur de la fenêtre : il
 * ne doit pas hériter du défilement de l'accueil. Après le fondu de sortie,
 * avant l'entrée du suivant.
 */
onUnmounted(() => window.scrollTo(0, 0))
</script>

<template>
  <div ref="root" class="home relative overflow-x-clip" :class="{ 'is-motion': motion }">
    <!--
      LA BARRE DU HAUT : la langue et le partage, à portée de pouce partout
      dans la page. Transparente sur le premier écran, elle prend un fond dès
      qu'on descend, et le titre du jeu y apparaît.
    -->
    <header class="topbar fixed inset-x-0 top-0 z-40" :class="{ 'is-solid': scrolled }">
      <div class="max-w-6xl mx-auto h-14 px-4 sm:px-6 flex items-center justify-between gap-4">
        <button class="flex items-center gap-3 min-w-0" :aria-label="gameTitle" @click="toTop">
          <svg viewBox="0 0 52 22" class="w-8 h-3.5 shrink-0 fill-neon-500" aria-hidden="true"
               style="filter: drop-shadow(0 0 4px rgb(var(--neon-500) / 0.8))">
            <rect x="0" y="16" width="4" height="6" /><rect x="6" y="12" width="4" height="10" />
            <rect x="12" y="8" width="4" height="14" /><rect x="18" y="4" width="4" height="18" />
            <rect x="24" y="0" width="4" height="22" /><rect x="30" y="4" width="4" height="18" />
            <rect x="36" y="8" width="4" height="14" /><rect x="42" y="12" width="4" height="10" />
            <rect x="48" y="16" width="4" height="6" />
          </svg>
          <span class="topbar-title hidden sm:block font-display uppercase text-[11px] tracking-[0.3em] text-ink-100 truncate">
            {{ gameTitle }}
          </span>
        </button>

        <div class="flex items-center gap-2">
          <!--
            LA LANGUE, sur le tout premier écran.
            Quelqu'un qui ne lit pas le français doit pouvoir en sortir avant
            d'avoir à remplir quoi que ce soit. Le menu affiche le nom de la
            langue DANS cette langue — « Deutsch », « Русский » — parce que
            c'est le seul libellé qu'un visiteur reconnaîtra à coup sûr. Le
            choix part dans le cookie, et le formulaire s'ouvrira dessus.
          -->
          <label class="lang-pill">
            <span class="sr-only">{{ t('lang.label') }}</span>
            <svg viewBox="0 0 20 20" class="w-3.5 h-3.5 shrink-0" fill="none"
                 stroke="currentColor" stroke-width="1.2" aria-hidden="true">
              <circle cx="10" cy="10" r="8" />
              <path d="M2 10h16M10 2c2.5 2.6 2.5 12.8 0 16M10 2C7.5 4.6 7.5 14.8 10 18" />
            </svg>
            <select
              class="lang-select"
              :value="lang"
              @change="setLang(($event.target as HTMLSelectElement).value as LangCode)"
            >
              <option v-for="l in languages" :key="l.code" :value="l.code">{{ l.endonym }}</option>
            </select>
          </label>

          <button class="icon-pill" :aria-label="t('home.share')" @click="shareSite">
            <svg viewBox="0 0 20 20" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
              <path v-if="copied" d="M4.5 10.5l3.5 3.5 7.5-8" />
              <path v-else d="M10 2.5v10M6.5 6 10 2.5 13.5 6M7 8.5H4.5v9h11v-9H13" />
            </svg>
          </button>
        </div>
      </div>
    </header>

    <!--
      LE PREMIER ÉCRAN : la couverture du Creator kit. Les tours sous la pluie,
      qui s'enfoncent à mesure qu'on descend ; le texte s'efface en remontant.
      (L'image du Comptoir reste dans public/home, gardée pour plus tard.)
    -->
    <section data-scrub="exit" class="hero relative min-h-[100svh] overflow-hidden flex flex-col items-center justify-center px-6 pt-24 pb-32 text-center">
      <!-- Lueur de la ville, sous l'horizon -->
      <div
        class="absolute inset-x-0 bottom-0 h-[55vh] pointer-events-none"
        style="background: radial-gradient(90% 100% at 50% 100%, rgb(var(--neon-500) / 0.22) 0%, rgb(var(--neon-500) / 0.06) 38%, transparent 70%)"
      />
      <div class="hero-city absolute inset-x-0 bottom-0 pointer-events-none opacity-90">
        <HomeSkyline />
      </div>

      <!-- Pluie -->
      <div class="absolute inset-0 overflow-hidden pointer-events-none">
        <span
          v-for="(drop, i) in raindrops"
          :key="i"
          class="rain-drop animate-rain-fall"
          :style="{
            left: `${drop.left}%`,
            height: `${drop.height}px`,
            animationDelay: `${drop.delay}s`,
            animationDuration: `${drop.duration}s`,
            opacity: drop.opacity,
          }"
        />
      </div>

      <!-- Voile : le texte doit rester lisible par-dessus les tours -->
      <div class="hero-veil absolute inset-0 pointer-events-none" />

      <div class="hero-content relative z-10 flex flex-col items-center gap-7 max-w-4xl w-full">
        <p class="text-steel-400 text-[10px] uppercase tracking-[0.45em] font-display">
          {{ t('login.eyebrow') }}
        </p>

        <h1 class="neon-text animate-neon-buzz font-display uppercase leading-[0.92] tracking-[0.04em] text-[clamp(2.6rem,10vw,6.2rem)]">
          {{ t('login.title_line1') }}<br>{{ t('login.title_line2') }}
        </h1>

        <p class="font-serif italic text-ink-50 text-xl sm:text-2xl">{{ t('home.hero_promise') }}</p>

        <div class="neon-rule w-32" />

        <!-- Les deux lignes de la couverture : ce qu'on donne, ce qu'on reçoit -->
        <p class="font-display uppercase text-[11px] sm:text-xs tracking-[0.3em] leading-[2.2] max-w-2xl">
          <span class="block text-ink-100">{{ t('home.hero_line1') }}</span>
          <span class="block text-neon-400">{{ t('home.hero_line2') }}</span>
        </p>

        <!--
          Le dossier est déjà au bureau. Personne ne remplit deux fois le même
          formulaire : un seul geste, « Sortir de chez vous », qui ramène à la
          scène où l'on en était — ou à l'auberge s'il n'y a rien à reprendre.
          Le formulaire reste accessible dessous, pour qui veut repartir sous une
          autre identité.
        -->
        <div v-if="knownDossier" class="w-full max-w-sm space-y-4 flex flex-col items-center pt-2">
          <p class="text-neon-400/80 text-[10px] uppercase tracking-[0.35em] font-display">
            <template v-if="resumeScene && rememberedFirstName">{{ t('login.resume_named', { name: rememberedFirstName }) }}</template>
            <template v-else-if="resumeScene">{{ t('login.resume_anon') }}</template>
            <template v-else>{{ t('login.dossier_known') }}</template>
          </p>
          <GlowButton class="w-full" @click="goOut">{{ t('login.dossier_cta') }}</GlowButton>
          <p v-if="resumeScene" class="text-ink-200/70 text-[11px] leading-relaxed">
            {{ resumeScene.title }}
            <span v-if="resumeScene.act" class="text-steel-400"> — {{ resumeScene.act }}</span>
          </p>
          <button
            class="font-display text-[10px] uppercase tracking-[0.28em] text-steel-400
                   hover:text-ink-200 transition-colors pt-1"
            @click="openDisclaimer"
          >
            {{ t('login.dossier_new') }}
          </button>
        </div>

        <!--
          L'entrée dans le jeu. Plus aucun compte tiers : le joueur DÉCLARE ce
          que le monde utilisera de lui, et la commission lui répond avant la
          première scène.
        -->
        <div v-else class="w-full max-w-sm space-y-4 flex flex-col items-center pt-2">
          <GlowButton class="w-full leading-relaxed" @click="openDisclaimer">
            {{ t('login.enroll_cta') }}
          </GlowButton>
          <p class="text-steel-400 text-[10px] uppercase tracking-[0.2em] font-display">
            {{ t('login.enroll_note', { steps: ADMISSION_STEPS }) }}
          </p>
        </div>
      </div>

      <!-- Il y a une suite : un chevron qui descend, et qui y mène d'un clic -->
      <button class="scroll-cue absolute bottom-6 left-1/2 -translate-x-1/2 z-10 p-3 text-neon-400"
              tabindex="-1" aria-hidden="true" @click="toNext">
        <svg viewBox="0 0 24 14" class="scroll-cue-chevron w-7 h-4" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="square">
          <path d="M2 2l10 10L22 2" />
        </svg>
      </button>
    </section>

    <LoginPitch :cta-label="ctaLabel" :cta-note="ctaNote" @enter="enter" />

    <!--
      L'horizon qui monte au-dessus du pied de page. Skyline à gradins,
      silhouette plate sur deux plans, tubes néon sur les façades. C'est le
      décor polygonal de Flashback, pas un dégradé.
    -->
    <div data-scrub class="horizon relative pointer-events-none" aria-hidden="true">
      <div
        class="absolute inset-x-0 bottom-0 h-[160%]"
        style="background: radial-gradient(90% 100% at 50% 100%, rgb(var(--neon-500) / 0.22) 0%, rgb(var(--neon-500) / 0.06) 38%, transparent 70%)"
      />
      <div class="horizon-city relative opacity-90">
        <HomeSkyline />
      </div>
    </div>

    <!-- LE PIED DE PAGE : toutes les langues du site, et de quoi faire passer l'adresse -->
    <footer class="relative bg-ink-900 border-t border-neon-600/25">
      <div class="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-20 grid gap-14 lg:grid-cols-[1.4fr_1fr] lg:gap-20">
        <div data-reveal>
          <p class="foot-eyebrow">{{ t('lang.label') }}</p>
          <ul class="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-x-6">
            <li v-for="l in languages" :key="l.code">
              <button
                class="lang-cell"
                :class="{ 'is-current': l.code === lang }"
                :aria-pressed="l.code === lang"
                :lang="l.code"
                @click="setLang(l.code)"
              >
                {{ l.endonym }}
              </button>
            </li>
          </ul>
          <p class="mt-5 text-ink-300 text-[13px] leading-relaxed max-w-lg">{{ t('lang.hint') }}</p>
        </div>

        <div data-reveal style="--d: 1">
          <p class="foot-eyebrow">{{ t('home.share') }}</p>
          <!-- L'adresse elle-même : la feuille de partage du système, ou le presse-papiers -->
          <button class="share-main group mt-5" @click="shareSite">
            <span class="truncate" dir="ltr">{{ copied ? t('home.copied') : host }}</span>
            <svg viewBox="0 0 20 20" class="w-4 h-4 shrink-0" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true">
              <path v-if="copied" d="M4.5 10.5l3.5 3.5 7.5-8" />
              <path v-else d="M10 2.5v10M6.5 6 10 2.5 13.5 6M7 8.5H4.5v9h11v-9H13" />
            </svg>
          </button>
          <ul class="mt-6 flex flex-wrap gap-x-6 gap-y-3">
            <li v-for="link in shareLinks" :key="link.name">
              <a :href="link.href" target="_blank" rel="noopener noreferrer" class="share-link">{{ link.name }}</a>
            </li>
            <!-- Le compte Instagram du jeu, sans le suivi du QR code d'où vient le lien -->
            <li>
              <a href="https://instagram.com/farnight_game" target="_blank" rel="noopener" class="share-link">Instagram</a>
            </li>
          </ul>
        </div>
      </div>

      <!-- Licence et mentions légales -->
      <div class="border-t border-steel-700/50">
        <div class="max-w-6xl mx-auto px-4 sm:px-6 py-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <span class="font-display text-[10px] uppercase tracking-[0.3em] text-steel-500">{{ gameTitle }}</span>
          <NuxtLink
            to="/mentions-legales"
            class="font-display text-[9px] uppercase tracking-[0.2em] text-steel-500/80 hover:text-steel-400 transition-colors"
          >
            © 2026 · CC BY-NC-ND 4.0 · {{ t('legal.link') }}
          </NuxtLink>
        </div>
      </div>
    </footer>

    <!-- Balayage cathodique, sur toute la page, sous la barre du haut -->
    <div class="crt-scanlines fixed inset-0 z-30 pointer-events-none opacity-30" />

    <!--
      Avertissement données. Plus haut que l'écran d'un téléphone : plafonné à
      la hauteur VISIBLE (dvh, encoches déduites), le titre en tête, les boutons
      au pied, et seuls les quatre points défilent, dans le cadre.
    -->
    <Transition name="modal">
      <div
        v-if="showDisclaimer"
        class="disclaimer-frame fixed inset-0 z-50 flex items-center justify-center px-4 sm:px-6"
        @click.self="showDisclaimer = false"
      >
        <div class="absolute inset-0 bg-ink-900/92" />

        <div class="disclaimer-card relative z-10 w-full max-w-sm flex flex-col bg-ink-900 border border-neon-600/50"
             style="box-shadow: 0 0 0 1px rgb(var(--neon-500) / 0.12), 0 24px 60px rgba(0,0,0,0.8), 0 0 40px rgb(var(--neon-500) / 0.12)">
          <span class="absolute inset-[5px] border border-neon-500/15 pointer-events-none" />

          <div class="shrink-0 space-y-3 text-center px-5 pt-5 pb-5 sm:px-7 sm:pt-7 sm:pb-7">
            <p class="text-neon-400/80 text-[10px] uppercase tracking-[0.35em] font-display">
              {{ t('login.disclaimer_eyebrow') }}
            </p>
            <h2 class="font-display uppercase text-ink-100 text-lg tracking-[0.08em]">
              {{ t('login.disclaimer_title') }}
            </h2>
            <div class="neon-rule w-24 mx-auto" />
          </div>

          <div class="relative flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 sm:px-7">
            <ul class="space-y-5 text-left">
              <li
                v-for="(point, i) in disclaimerPoints"
                :key="i"
                class="flex items-start gap-3.5"
              >
                <!-- Chevron angulaire, pas un losange de grimoire -->
                <svg viewBox="0 0 8 10" class="w-2 h-2.5 mt-1 shrink-0 fill-neon-500" aria-hidden="true">
                  <path d="M0 0 L5 5 L0 10 L3 10 L8 5 L3 0 Z" />
                </svg>
                <span class="text-ink-200/80 text-[13px] leading-relaxed">{{ point }}</span>
              </li>
            </ul>
            <!-- Le texte continue : un fondu au pied le dit. -->
            <div class="sticky bottom-0 h-6 sm:h-7 bg-gradient-to-t from-ink-900 to-transparent pointer-events-none" />
          </div>

          <div class="shrink-0 h-px mx-5 sm:mx-7 bg-neon-600/30" />

          <div class="shrink-0 space-y-4 flex flex-col items-center px-5 pt-5 pb-5 sm:px-7 sm:pt-7 sm:pb-7">
            <GlowButton class="w-full" @click="acceptAndEnroll">{{ t('common.continue') }}</GlowButton>
            <button
              class="font-display text-[10px] uppercase tracking-[0.28em] text-steel-400 hover:text-ink-200 transition-colors"
              @click="showDisclaimer = false"
            >
              {{ t('common.cancel') }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.disclaimer-frame {
  padding-top: max(1rem, env(safe-area-inset-top));
  padding-bottom: max(1rem, env(safe-area-inset-bottom));
}
.disclaimer-card {
  max-height: calc(100vh - 2rem);
  max-height: calc(100dvh - 2rem - env(safe-area-inset-top) - env(safe-area-inset-bottom));
}

/* La barre du haut : rien sur la couverture, un fond dès qu'on descend. */
.topbar {
  padding-top: env(safe-area-inset-top);
  transition: background-color 0.35s ease, border-color 0.35s ease;
  border-bottom: 1px solid transparent;
}
.topbar.is-solid {
  background: rgb(var(--ink-900) / 0.86);
  border-bottom-color: rgb(var(--neon-600) / 0.22);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
}
.topbar-title { opacity: 0; transition: opacity 0.35s ease; }
.topbar.is-solid .topbar-title { opacity: 1; }

/*
  Le menu de langue et le bouton de partage : deux pastilles biseautées de
  même hauteur. Le menu reste un <select> du système — au doigt, c'est la
  roue native, la seule qui marche partout —, seul son habit change.
*/
.lang-pill,
.icon-pill {
  --cut: 6px;
  display: inline-flex;
  align-items: center;
  height: 2.25rem;
  color: rgb(var(--ink-200));
  background: rgb(var(--ink-900) / 0.55);
  box-shadow: inset 0 0 0 1px rgb(var(--steel-500) / 0.7);
  clip-path: polygon(var(--cut) 0, 100% 0, 100% calc(100% - var(--cut)), calc(100% - var(--cut)) 100%, 0 100%, 0 var(--cut));
  transition: color 0.2s ease, box-shadow 0.2s ease;
}
.lang-pill { gap: 0.5rem; padding-inline: 0.75rem 0.5rem; cursor: pointer; }
.icon-pill { justify-content: center; width: 2.25rem; }
.lang-pill:hover,
.lang-pill:focus-within,
.icon-pill:hover,
.icon-pill:focus-visible {
  color: rgb(var(--neon-300));
  box-shadow: inset 0 0 0 1px rgb(var(--neon-500) / 0.8);
}

.lang-select {
  appearance: none;
  background: transparent;
  border: 0;
  color: inherit;
  font-family: Futura, 'Avenir Next', 'Century Gothic', 'Trebuchet MS', system-ui, sans-serif;
  font-size: 11px;
  letter-spacing: 0.12em;
  padding: 0.25rem 1.1rem 0.25rem 0;
  max-width: 9.5rem;
  text-overflow: ellipsis;
  cursor: pointer;
  outline: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M0 0 L5 6 L10 0 Z' fill='%23718096'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.1rem center;
  background-size: 8px;
}

/* Le menu déroulé est rendu par le système : il lui faut un fond opaque. */
.lang-select option {
  background: rgb(var(--ink-900));
  color: rgb(var(--ink-100));
}

/*
  LE PREMIER ÉCRAN. Les tours s'enfoncent moins vite que la page ; le texte
  remonte en s'effaçant. --p vaut 0 en haut de page.
*/
.hero-city {
  transform: translateY(calc(var(--p, 0) * 28%));
  will-change: transform;
}
.hero-veil {
  background: radial-gradient(70% 58% at 50% 45%, rgb(var(--ink-900) / 0.94) 0%, rgb(var(--ink-900) / 0.78) 48%, transparent 80%);
}
.hero-content {
  opacity: calc(1 - var(--p, 0) * 1.7);
  transform: translateY(calc(var(--p, 0) * -70px));
}
.scroll-cue { opacity: calc(1 - var(--p, 0) * 4); }
.scroll-cue-chevron {
  filter: drop-shadow(0 0 6px rgb(var(--neon-500) / 0.8));
  animation: cue 1.8s ease-in-out infinite;
}
@keyframes cue {
  0%, 100% { transform: translateY(0); opacity: 0.55; }
  50% { transform: translateY(8px); opacity: 1; }
}

/* La skyline monte derrière le dernier écran, et se pose avant le pied de page. */
.horizon-city { transform: translateY(calc(max(0, 0.55 - var(--p, 0.55)) * 70%)); }

.foot-eyebrow {
  font-family: Futura, 'Avenir Next', 'Century Gothic', 'Trebuchet MS', system-ui, sans-serif;
  font-size: 10px;
  letter-spacing: 0.42em;
  text-transform: uppercase;
  color: rgb(var(--neon-400));
}

/* Les quinze langues, chacune écrite dans sa propre langue. */
.lang-cell {
  position: relative;
  display: block;
  width: 100%;
  text-align: start;
  padding: 0.8rem 0 0.8rem 0.9rem;
  border-bottom: 1px solid rgb(var(--steel-700) / 0.7);
  color: rgb(var(--ink-300));
  font-family: Futura, 'Avenir Next', 'Century Gothic', 'Trebuchet MS', system-ui, sans-serif;
  font-size: 13px;
  letter-spacing: 0.06em;
  transition: color 0.2s ease;
}
.lang-cell::before {
  content: '';
  position: absolute;
  inset-inline-start: 0;
  top: 50%;
  width: 3px;
  height: 0;
  background: rgb(var(--neon-500));
  box-shadow: 0 0 8px rgb(var(--neon-500) / 0.8);
  transform: translateY(-50%);
  transition: height 0.25s ease;
}
.lang-cell:hover,
.lang-cell:focus-visible { color: rgb(var(--ink-50)); }
.lang-cell.is-current { color: rgb(var(--neon-300)); }
.lang-cell.is-current::before { height: 1.1rem; }

/* L'adresse du jeu, en grand : c'est elle qu'on fait passer. */
.share-main {
  --cut: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  width: 100%;
  max-width: 24rem;
  padding: 1rem 1.25rem;
  color: rgb(var(--neon-200));
  background: rgb(var(--ink-800) / 0.7);
  box-shadow: inset 0 0 0 1px rgb(var(--neon-500) / 0.55);
  clip-path: polygon(var(--cut) 0, 100% 0, 100% calc(100% - var(--cut)), calc(100% - var(--cut)) 100%, 0 100%, 0 var(--cut));
  font-family: Futura, 'Avenir Next', 'Century Gothic', 'Trebuchet MS', system-ui, sans-serif;
  font-size: 15px;
  letter-spacing: 0.1em;
  transition: background-color 0.2s ease, color 0.2s ease;
}
.share-main:hover,
.share-main:focus-visible {
  background: rgb(var(--neon-500));
  color: rgb(var(--ink-900));
}

.share-link {
  color: rgb(var(--ink-300));
  font-family: Futura, 'Avenir Next', 'Century Gothic', 'Trebuchet MS', system-ui, sans-serif;
  font-size: 11px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  padding: 0.25rem 0;
  border-bottom: 1px solid rgb(var(--steel-600) / 0.7);
  transition: color 0.2s ease, border-color 0.2s ease;
}
.share-link:hover,
.share-link:focus-visible {
  color: rgb(var(--neon-300));
  border-bottom-color: rgb(var(--neon-500));
}

/* L'arabe se lie : l'interlettrage y casse les mots. */
.home:lang(ar) * { letter-spacing: normal !important; }

@media (prefers-reduced-motion: reduce) {
  .hero-city, .hero-content, .horizon-city { transform: none; opacity: 1; }
  .scroll-cue-chevron { animation: none; }
}

.modal-enter-active, .modal-leave-active { transition: opacity 0.25s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
</style>

<!--
  Les apparitions, pour toute la page — `LoginPitch` compris, d'où l'absence de
  `scoped`. Bornées à `.home.is-motion` : sans JavaScript ou avec moins
  d'animation demandée, rien n'est jamais caché.
-->
<style>
.home.is-motion [data-reveal] {
  transition:
    opacity 0.9s cubic-bezier(0.2, 0.7, 0.2, 1),
    transform 0.9s cubic-bezier(0.2, 0.7, 0.2, 1),
    clip-path 1.1s cubic-bezier(0.2, 0.7, 0.2, 1);
  transition-delay: calc(var(--d, 0) * 110ms);
}
.home.is-motion [data-reveal]:not(.is-in) {
  opacity: 0;
  transform: translateY(28px);
}
.home.is-motion [data-reveal='wipe']:not(.is-in) {
  transform: none;
  clip-path: inset(0 100% 0 0);
}
.home.is-motion [data-reveal='wipe'].is-in { clip-path: inset(0 0 0 0); }
</style>

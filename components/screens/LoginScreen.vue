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
</script>

<template>
  <div class="relative min-h-[100dvh] overflow-hidden flex flex-col items-center justify-center px-6 text-center">
    <!-- Lueur de la ville, sous l'horizon -->
    <div
      class="absolute inset-x-0 bottom-0 h-[55vh] pointer-events-none"
      style="background: radial-gradient(90% 100% at 50% 100%, rgb(var(--neon-500) / 0.22) 0%, rgb(var(--neon-500) / 0.06) 38%, transparent 70%)"
    />

    <!--
      Skyline à gradins, silhouette plate sur deux plans, tubes néon
      sur les façades. C'est le décor polygonal de Flashback, pas un dégradé.
    -->
    <div class="absolute inset-x-0 bottom-0 pointer-events-none opacity-90">
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
    <div
      class="absolute inset-0 pointer-events-none"
      style="background: radial-gradient(58% 54% at 50% 45%, rgba(8,11,18,0.94) 0%, rgba(8,11,18,0.78) 48%, transparent 80%)"
    />

    <!-- Contenu -->
    <div class="relative z-10 flex flex-col items-center gap-8 max-w-md w-full">
      <!-- Ziggourat néon : gradins symétriques, la signature Deco -->
      <svg viewBox="0 0 52 22" class="w-14 h-6 fill-neon-500 animate-neon-buzz" aria-hidden="true"
           style="filter: drop-shadow(0 0 6px rgb(var(--neon-500) / 0.85))">
        <rect x="0" y="16" width="4" height="6" />
        <rect x="6" y="12" width="4" height="10" />
        <rect x="12" y="8" width="4" height="14" />
        <rect x="18" y="4" width="4" height="18" />
        <rect x="24" y="0" width="4" height="22" />
        <rect x="30" y="4" width="4" height="18" />
        <rect x="36" y="8" width="4" height="14" />
        <rect x="42" y="12" width="4" height="10" />
        <rect x="48" y="16" width="4" height="6" />
      </svg>

      <div class="w-full space-y-5">
        <p class="text-steel-400 text-[10px] uppercase tracking-[0.45em] font-display">
          {{ t('login.eyebrow') }}
        </p>

        <h1 class="neon-text animate-neon-buzz font-display uppercase leading-[0.95] tracking-[0.05em] text-[2.1rem] sm:text-[2.9rem]">
          {{ t('login.title_line1') }}<br>{{ t('login.title_line2') }}
        </h1>

        <div class="neon-rule w-40 mx-auto" />
      </div>

      <!--
        L'accroche tient en une phrase et pose les deux promesses du jeu : le
        monde est bâti sur ce joueur-là, et ce qu'il y dénoue lui revient. La
        coupure tombe avant « vers » : ce que c'est d'un côté, où ça mène de
        l'autre.
      -->
      <p class="text-ink-200/75 text-sm leading-relaxed max-w-xs">
        {{ t('login.tagline_line1') }}<br>
        {{ t('login.tagline_line2') }}
      </p>

      <!--
        Le dossier est déjà au bureau. Personne ne remplit deux fois le même
        formulaire : un seul geste, « Sortir de chez vous », qui ramène à la
        scène où l'on en était — ou à l'auberge s'il n'y a rien à reprendre.
        Le formulaire reste accessible dessous, pour qui veut repartir sous une
        autre identité.
      -->
      <div v-if="knownDossier" class="w-full space-y-4 flex flex-col items-center">
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
      <div v-else class="w-full space-y-4 flex flex-col items-center">
        <GlowButton class="w-full leading-relaxed" @click="openDisclaimer">
          {{ t('login.enroll_cta') }}
        </GlowButton>
        <p class="text-steel-400 text-[10px] uppercase tracking-[0.2em] font-display">
          {{ t('login.enroll_note', { steps: ADMISSION_STEPS }) }}
        </p>
      </div>

      <!--
        LA LANGUE, sur le tout premier écran.
        Elle ne peut pas attendre le formulaire : quelqu'un qui ne lit pas le
        français doit pouvoir sortir du français avant d'avoir à remplir quoi
        que ce soit. Le menu affiche le nom de la langue DANS cette langue —
        « Deutsch », « Русский » — parce que c'est le seul libellé qu'un
        visiteur reconnaîtra à coup sûr, quelle que soit la langue affichée.
        Le choix part dans le cookie, et le formulaire s'ouvrira dessus.
      -->
      <div class="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 pt-1">
        <label class="flex items-center gap-2">
          <span class="sr-only">{{ t('lang.label') }}</span>
          <svg viewBox="0 0 20 20" class="w-3.5 h-3.5 shrink-0 text-steel-500" fill="none"
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

        <!-- Partager l'adresse : le domaine sert de libellé, il se lit dans toutes les langues -->
        <button class="share-link group flex items-center gap-2" @click="shareSite">
          <svg viewBox="0 0 20 20" class="w-3.5 h-3.5 shrink-0 text-steel-500 group-hover:text-neon-400 transition-colors"
               fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">
            <path v-if="copied" d="M4.5 10.5l3.5 3.5 7.5-8" />
            <path v-else d="M10 2.5v10M6.5 6 10 2.5 13.5 6M7 8.5H4.5v9h11v-9H13" />
          </svg>
          {{ host }}
        </button>

        <!-- Le compte Instagram du jeu, sans le suivi du QR code d'où vient le lien -->
        <a
          href="https://instagram.com/farnight_game"
          target="_blank"
          rel="noopener"
          aria-label="Instagram"
          class="p-1 text-steel-500 hover:text-neon-400 transition-colors"
        >
          <svg viewBox="0 0 20 20" class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">
            <rect x="2.5" y="2.5" width="15" height="15" rx="4.5" />
            <circle cx="10" cy="10" r="3.6" />
            <circle cx="14.6" cy="5.4" r="0.7" fill="currentColor" stroke="none" />
          </svg>
        </a>
      </div>

      <!-- Licence et mentions légales : dans la colonne, rien ne peut les recouvrir -->
      <NuxtLink
        to="/mentions-legales"
        class="font-display text-[9px] uppercase tracking-[0.2em] text-steel-500/70 hover:text-steel-400 transition-colors"
      >
        © 2026 · CC BY-NC-ND 4.0 · {{ t('legal.link') }}
      </NuxtLink>
    </div>

    <!-- Balayage cathodique, tout au-dessus -->
    <div class="crt-scanlines absolute inset-0 z-20 pointer-events-none opacity-45" />

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

/*
  Le menu de langue : la même sobriété que le reste de l'accueil — pas de
  cadre, un filet sous le mot, et le chevron dessiné plutôt que celui du
  système, qui casserait la ligne.
*/
.lang-select {
  appearance: none;
  background: transparent;
  border: 0;
  border-bottom: 1px solid rgb(var(--steel-600) / 0.7);
  color: rgb(var(--ink-300));
  font-family: Futura, 'Avenir Next', 'Century Gothic', 'Trebuchet MS', system-ui, sans-serif;
  font-size: 11px;
  letter-spacing: 0.12em;
  padding: 0.25rem 1.25rem 0.3rem 0.1rem;
  cursor: pointer;
  outline: none;
  transition: color 0.2s ease, border-color 0.2s ease;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M0 0 L5 6 L10 0 Z' fill='%23718096'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.1rem center;
  background-size: 8px;
}

.lang-select:hover,
.lang-select:focus {
  color: rgb(var(--neon-300));
  border-bottom-color: rgb(var(--neon-600) / 0.7);
}

/* Le partage, à la même voix que le menu de langue qu'il accompagne. */
.share-link {
  color: rgb(var(--ink-300));
  font-family: Futura, 'Avenir Next', 'Century Gothic', 'Trebuchet MS', system-ui, sans-serif;
  font-size: 11px;
  letter-spacing: 0.12em;
  padding: 0.25rem 0 0.3rem;
  transition: color 0.2s ease;
}

.share-link:hover,
.share-link:focus-visible {
  color: rgb(var(--neon-300));
}

/* Le menu déroulé est rendu par le système : il lui faut un fond opaque. */
.lang-select option {
  background: rgb(var(--ink-900));
  color: rgb(var(--ink-100));
}

.modal-enter-active, .modal-leave-active { transition: opacity 0.25s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
</style>

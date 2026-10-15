<script setup lang="ts">
import { pack } from '~/utils/languages'

/**
 * Ce que l'accueil raconte sous le premier écran : le Creator kit, mis en page
 * pour un joueur.
 *
 * Aucune logique de jeu ici. Les effets de défilement sont pilotés par
 * `LoginScreen`, qui pose `--p` (0 → 1) sur chaque `[data-scrub]` et la classe
 * `is-in` sur chaque `[data-reveal]` ; ce composant ne fait que s'en servir.
 * Le bouton d'entrée remonte par `enter` : c'est l'écran qui sait s'il faut
 * ouvrir l'avertissement ou reprendre une nuit.
 */
defineProps<{
  ctaLabel: string
  ctaNote?: string | null
}>()
defineEmits<{ enter: [] }>()

const { lang, t, languages } = useLang()

/**
 * Trois lieux du kit — pas plus — et leur néon.
 *
 * Ce sont des palettes calculées sur des dossiers fictifs, pas des nuits de
 * joueurs. L'accent est relevé dans chaque image : la barre de progression
 * les traverse tous, ce qui montre mieux qu'une phrase que la couleur change
 * avec la personne.
 */
const PLACES = [
  { key: 'metro', accent: '#9b45f0' },
  { key: 'square', accent: '#3fb6cc' },
  { key: 'laundromat', accent: '#a0ee3c' },
]
const spectrum = `linear-gradient(90deg, ${PLACES.map(p => p.accent).join(', ')})`

const steps = computed(() => [1, 2, 3].map(n => ({
  title: t(`home.step${n}_title`),
  text: t(`home.step${n}_text`),
})))

const reasons = computed(() => [1, 2, 3, 4].map(n => ({
  title: t(`home.why${n}_title`),
  text: t(`home.why${n}_text`),
})))

const figures = computed(() => [
  { n: 2, label: t('home.fig_lines') },
  { n: 6, label: t('home.fig_places') },
  { n: languages.length, label: t('home.fig_langs') },
  { n: 1, label: t('home.fig_night') },
])

/** Ce que le PDF de la nuit contient, dans l'ordre de ses pages. */
const keepItems = computed(() => [1, 2, 3, 4].map(n => t(`home.keep_item${n}`)))

const gameTitle = computed(() => `${t('login.title_line1')} ${t('login.title_line2')}`)

/** Les prix du script — la nuit, le PDF —, écrits à la façon de la langue affichée. */
const paywallPrice = useRuntimeConfig().public.paywallPrice as { amount: number; currency: string; keepsake: number }
function money(amount: number): string {
  return new Intl.NumberFormat(pack(lang.value).tag, {
    style: 'currency',
    currency: paywallPrice.currency,
    maximumFractionDigits: amount % 1 ? 2 : 0,
  }).format(amount)
}
const price = computed(() => money(paywallPrice.amount))
const keepsakePrice = computed(() => money(paywallPrice.keepsake))
</script>

<template>
  <div class="pitch">
    <!-- Deux lignes en entrée, une nuit en sortie : les deux moitiés glissent l'une vers l'autre -->
    <section data-scrub class="relative overflow-x-clip pt-28 pb-20 sm:pt-40 sm:pb-28">
      <div class="max-w-6xl mx-auto px-4 sm:px-6">
        <p data-reveal class="eyebrow text-neon-400">{{ t('home.formula') }}</p>
        <h2 class="what-title font-display uppercase mt-6">
          <span class="block slide-a text-ink-50">{{ t('home.what_title_1') }}</span>
          <span class="block slide-b neon-text">{{ t('home.what_title_2') }}</span>
        </h2>
        <p data-reveal class="lead mt-10 sm:mt-14 max-w-2xl">{{ t('home.what_text') }}</p>
      </div>
    </section>

    <!-- Trois temps -->
    <section class="max-w-6xl mx-auto px-4 sm:px-6 pb-28 sm:pb-40">
      <ol class="grid gap-12 md:grid-cols-3 md:gap-8">
        <li
          v-for="(step, i) in steps"
          :key="i"
          data-reveal
          class="step"
          :style="{ '--d': i }"
        >
          <span class="step-rule" />
          <span class="block font-display text-5xl text-neon-400 mt-5">0{{ i + 1 }}</span>
          <h3 class="font-display uppercase text-ink-50 text-[13px] tracking-[0.24em] leading-relaxed mt-4">
            {{ step.title }}
          </h3>
          <p class="text-ink-200/80 text-[15px] leading-relaxed mt-3">{{ step.text }}</p>
        </li>
      </ol>
    </section>

    <!--
      Les lieux, en travelling. La section est haute, son contenu reste collé à
      l'écran, et la bande défile de côté au rythme de la molette. Sans
      animation demandée par le système, elle redevient une bande qu'on fait
      glisser au doigt.
    -->
    <section data-scrub="pin" class="places" :style="{ '--n': PLACES.length + 1 }">
      <div class="places-stage">
        <div class="max-w-6xl w-full mx-auto px-4 sm:px-6 flex items-end justify-between gap-6">
          <p class="eyebrow text-steel-400">{{ t('home.places_eyebrow') }}</p>
          <span class="font-display text-[11px] tracking-[0.3em] text-steel-400 shrink-0">0{{ PLACES.length }}</span>
        </div>

        <div class="places-scroller" dir="ltr">
          <div class="places-track">
            <figure
              v-for="(place, i) in PLACES"
              :key="place.key"
              class="place"
              :style="{ '--accent': place.accent }"
            >
              <!-- Sur téléphone, le recadrage vertical de l'atelier plutôt qu'un 16:9 rogné -->
              <picture class="place-frame">
                <source media="(max-width: 639px)" :srcset="`/home/portrait/${place.key}.webp`" width="1080" height="1920">
                <img
                  :src="`/home/${place.key}.webp`"
                  :alt="t(`home.place_${place.key}`)"
                  width="1920"
                  height="1080"
                  loading="lazy"
                  decoding="async"
                  class="w-full h-full object-cover"
                >
              </picture>
              <figcaption class="flex items-center gap-3 mt-4" :dir="pack(lang).writing?.dir ?? 'ltr'">
                <span class="font-display text-[11px] tracking-[0.2em] place-accent">0{{ i + 1 }}</span>
                <span class="h-px w-8 place-accent-bg" />
                <span class="font-display uppercase text-[11px] tracking-[0.26em] text-ink-100">
                  {{ t(`home.place_${place.key}`) }}
                </span>
              </figcaption>
            </figure>

            <div class="place place-last" :dir="pack(lang).writing?.dir ?? 'ltr'">
              <p class="font-display uppercase text-neon-400 leading-[1.05] text-[clamp(1.8rem,4.4vw,3.4rem)]">
                {{ t('home.places_title') }}
              </p>
              <p class="text-ink-200/75 text-[15px] leading-relaxed mt-6 max-w-md">{{ t('home.places_text') }}</p>
            </div>
          </div>
        </div>

        <div class="max-w-6xl w-full mx-auto px-4 sm:px-6">
          <div class="h-[3px] bg-steel-700/50">
            <div class="places-progress h-full" :style="{ background: spectrum }" />
          </div>
        </div>
      </div>
    </section>

    <!-- Personne ne peut vous voler la nuit -->
    <section data-scrub class="max-w-6xl mx-auto px-4 sm:px-6 pt-28 pb-24 sm:pt-40 sm:pb-32">
      <h2 class="why-title font-display uppercase leading-[0.98] text-[clamp(2.2rem,7vw,5.5rem)]">
        <span class="block text-ink-50">{{ t('home.why_title_1') }}</span>
        <span class="block neon-text">{{ t('home.why_title_2') }}</span>
      </h2>

      <div class="grid gap-4 sm:gap-6 md:grid-cols-2 mt-14 sm:mt-20">
        <article
          v-for="(reason, i) in reasons"
          :key="i"
          data-reveal="wipe"
          class="reason"
          :style="{ '--d': i % 2 }"
        >
          <h3 class="font-display uppercase text-[13px] tracking-[0.22em] text-ink-50">
            <span class="text-neon-400 me-3">0{{ i + 1 }}</span>{{ reason.title }}
          </h3>
          <p class="text-ink-200/80 text-[15px] leading-relaxed mt-4">{{ reason.text }}</p>
        </article>
      </div>
    </section>

    <!-- Les chiffres du kit -->
    <section class="border-y border-steel-700/60">
      <dl class="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4">
        <div
          v-for="(fig, i) in figures"
          :key="i"
          data-reveal
          class="figure"
          :style="{ '--d': i }"
        >
          <dt class="order-2 font-display uppercase text-[10px] tracking-[0.28em] text-steel-400 leading-relaxed mt-3">
            {{ fig.label }}
          </dt>
          <dd class="order-1 figure-num neon-text font-display text-[clamp(3rem,8vw,5.5rem)] leading-none">
            {{ fig.n }}
          </dd>
        </div>
      </dl>
    </section>

    <!--
      CE QU'IL EN RESTE : le PDF de la nuit. Trois pages en pile qui s'ouvrent
      en éventail au défilement — la couverture et son aube, les lieux, la fin.
      Les intitulés sont ceux du vrai PDF (keepsake.*) ; le texte n'y est
      figuré que par des traits : on montre la forme, pas une nuit inventée.
      Les pages ont leur propre néon : le PDF prend les couleurs de l'aube du
      joueur, pas celles de l'accueil.
    -->
    <section class="relative overflow-x-clip pt-28 pb-24 sm:pt-40 sm:pb-32">
      <div class="max-w-6xl mx-auto px-4 sm:px-6">
        <div class="text-center max-w-2xl mx-auto">
          <p data-reveal class="eyebrow text-neon-400">{{ t('home.keep_eyebrow') }}</p>
          <h2 data-reveal class="font-display uppercase leading-[0.98] text-[clamp(2.4rem,7vw,5.5rem)] mt-6" style="--d: 1">
            <span class="block text-ink-50">{{ t('home.keep_title_1') }}</span>
            <span class="block neon-text">{{ t('home.keep_title_2') }}</span>
          </h2>
          <p data-reveal class="lead mt-8" style="--d: 2">{{ t('home.keep_text') }}</p>
        </div>

        <div data-scrub class="doc-stack" aria-hidden="true">
          <!-- La fin : ce qu'on garde, puis le texte de l'aube -->
          <div class="doc doc-end">
            <div class="doc-body">
              <p class="doc-h2">{{ t('keepsake.kept') }}</p>
              <div class="doc-kept">
                <span class="doc-kept-item"><span class="doc-tag">{{ t('keepsake.augmentation') }}</span><span class="bar" style="width: 70%" /></span>
                <span class="doc-kept-item"><span class="bar" style="width: 60%" /></span>
                <span class="doc-kept-item"><span class="bar" style="width: 80%" /></span>
                <span class="doc-kept-item"><span class="bar" style="width: 50%" /></span>
              </div>
              <span class="bar bar-endtitle" style="width: 72%" />
              <span v-for="w in [96, 100, 88, 94, 60]" :key="w" class="bar" :style="{ width: `${w}%` }" />
              <div class="doc-last">
                <span v-for="w in [92, 100, 70]" :key="w" class="bar" :style="{ width: `${w}%` }" />
              </div>
            </div>
          </div>

          <!-- Le but, puis les lieux un par un -->
          <div class="doc doc-places">
            <div class="doc-body">
              <p class="doc-h2">{{ t('keepsake.goal') }}</p>
              <span class="bar bar-goal" style="width: 94%" />
              <span class="bar bar-goal" style="width: 66%" />
              <p class="doc-h2 doc-gap">{{ t('keepsake.places') }}</p>
              <div v-for="n in 2" :key="n" class="doc-place">
                <span class="doc-num">0{{ n }}</span>
                <div>
                  <span class="bar bar-h3" :style="{ width: n === 1 ? '62%' : '48%' }" />
                  <span class="doc-row"><span class="doc-dt">{{ t('keepsake.played') }}</span><span class="doc-dd"><span class="bar" /><span class="bar" style="width: 72%" /></span></span>
                  <span class="doc-row"><span class="doc-dt">{{ t('keepsake.who') }}</span><span class="doc-dd"><span class="bar" style="width: 55%" /></span></span>
                  <span class="doc-row"><span class="doc-dt">{{ t('keepsake.answer') }}</span><span class="doc-dd"><span class="bar bar-answer" :style="{ width: n === 1 ? '40%' : '52%' }" /></span></span>
                </div>
              </div>
            </div>
          </div>

          <!-- La couverture : l'aube, le titre de la nuit, le nom et la date -->
          <div class="doc doc-cover">
            <svg viewBox="0 0 210 297" preserveAspectRatio="xMidYMid slice" class="absolute inset-0 w-full h-full">
              <rect width="210" height="297" fill="#140d24" />
              <rect y="96" width="210" height="34" fill="#24143a" />
              <rect y="130" width="210" height="26" fill="#3c1c48" />
              <rect y="156" width="210" height="20" fill="#6e2a4c" />
              <rect y="176" width="210" height="14" fill="#b4483f" />
              <circle cx="105" cy="190" r="46" fill="#ff9a4a" />
              <rect y="168" width="210" height="2.5" fill="#6e2a4c" />
              <rect y="176" width="210" height="3.5" fill="#b4483f" />
              <rect y="184" width="210" height="4.5" fill="#b4483f" />
              <g fill="#0a0c15">
                <path d="M0 190h22v-26h10v-18h8v18h12v26h14v-40h12v-22h6v22h12v40h10v-30h16v-14h8v14h12v30h12v-48h10v-16h6v16h10v48h18v-24h8v107H0z" />
              </g>
              <rect y="190" width="210" height="1.2" fill="#ff9a4a" opacity="0.8" />
            </svg>
            <div class="doc-veil" />
            <div class="doc-cover-text">
              <span class="doc-rule" />
              <p class="doc-eyebrow">{{ gameTitle }}</p>
              <span class="bar bar-title" style="width: 84%" />
              <span class="bar bar-title" style="width: 56%" />
              <span class="bar bar-who" style="width: 46%" />
            </div>
          </div>
        </div>

        <ul class="grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
          <li
            v-for="(item, i) in keepItems"
            :key="i"
            data-reveal
            class="keep-item"
            :style="{ '--d': i }"
          >
            <span class="font-display text-neon-400 text-[11px] tracking-[0.2em]">0{{ i + 1 }}</span>
            <p class="text-ink-100 text-[15px] leading-relaxed mt-3">{{ item }}</p>
          </li>
        </ul>

        <p data-reveal class="text-center font-display uppercase text-[11px] tracking-[0.28em] leading-loose text-neon-300 mt-14">
          {{ t('home.keep_price', { price: keepsakePrice }) }}
        </p>
      </div>
    </section>

    <!-- Le Comptoir est ouvert : dernier appel, sur le temple -->
    <section data-scrub class="cta relative overflow-hidden">
      <img
        src="/home/temple.webp"
        alt=""
        width="1920"
        height="1080"
        loading="lazy"
        decoding="async"
        class="cta-image absolute inset-0 w-full h-full object-cover"
      >
      <div class="absolute inset-0 cta-veil" />

      <div class="relative max-w-3xl mx-auto px-4 sm:px-6 py-32 sm:py-44 text-center flex flex-col items-center">
        <p data-reveal class="eyebrow text-neon-400">{{ t('home.cta_eyebrow') }}</p>
        <h2 data-reveal class="font-display uppercase leading-[0.98] text-[clamp(2.4rem,8vw,6rem)] mt-6" style="--d: 1">
          <span class="block text-ink-50">{{ t('home.cta_title_1') }}</span>
          <span class="block neon-text animate-neon-buzz">{{ t('home.cta_title_2') }}</span>
        </h2>
        <p data-reveal class="lead mt-8 max-w-xl" style="--d: 2">{{ t('home.cta_text', { price }) }}</p>
        <div data-reveal class="w-full max-w-sm mt-10 space-y-4" style="--d: 3">
          <GlowButton class="w-full leading-relaxed" @click="$emit('enter')">{{ ctaLabel }}</GlowButton>
          <p v-if="ctaNote" class="text-steel-400 text-[10px] uppercase tracking-[0.2em] font-display">{{ ctaNote }}</p>
        </div>
      </div>
    </section>

    <!-- Pour les créateurs : le kit promet une nuit offerte, l'accueil le dit aussi -->
    <section class="max-w-6xl mx-auto px-4 sm:px-6 py-20 sm:py-28">
      <div data-reveal="wipe" class="creators grid md:grid-cols-[1.1fr_1fr]">
        <img
          src="/home/pool.webp"
          alt=""
          width="1920"
          height="1080"
          loading="lazy"
          decoding="async"
          class="w-full h-full min-h-[180px] object-cover"
        >
        <div class="p-6 sm:p-10 flex flex-col justify-center gap-5">
          <p class="eyebrow text-neon-400">{{ t('home.creators_eyebrow') }}</p>
          <p class="text-ink-100 text-[17px] leading-relaxed">{{ t('home.creators_text') }}</p>
          <a
            href="mailto:friend@farnight.online"
            class="font-display text-neon-300 hover:text-neon-200 text-lg sm:text-xl tracking-[0.04em] break-all transition-colors"
            dir="ltr"
          >friend@farnight.online</a>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.eyebrow {
  font-family: Futura, 'Avenir Next', 'Century Gothic', 'Trebuchet MS', system-ui, sans-serif;
  font-size: 10px;
  letter-spacing: 0.42em;
  text-transform: uppercase;
}

.lead {
  font-family: Georgia, Cambria, 'Times New Roman', Times, serif;
  font-size: clamp(1.05rem, 2.1vw, 1.3rem);
  line-height: 1.75;
  color: rgb(var(--ink-200) / 0.9);
}

/*
  Les deux moitiés du titre se croisent : alignées quand la section passe au
  milieu de l'écran (--p = 0,5), décalées de part et d'autre avant et après.
*/
.what-title {
  font-size: clamp(2.4rem, 6.4vw, 6rem);
  line-height: 0.95;
  letter-spacing: 0.01em;
}
.slide-a { transform: translateX(calc((var(--p, 0.5) - 0.5) * 34vw)); }
.slide-b { transform: translateX(calc((0.5 - var(--p, 0.5)) * 34vw)); }

/* Le titre se resserre en arrivant au centre, comme un néon qui s'allume. */
.why-title { letter-spacing: calc(max(0, 0.5 - var(--p, 0.5)) * 0.4em); }

/* Un trait néon qui se tire quand l'étape apparaît. */
.step-rule {
  display: block;
  height: 2px;
  background: rgb(var(--neon-500));
  box-shadow: 0 0 10px rgb(var(--neon-500) / 0.6);
  transform-origin: left;
  transition: transform 1.1s cubic-bezier(0.2, 0.7, 0.2, 1);
  transition-delay: calc(var(--d, 0) * 110ms + 200ms);
}
[dir='rtl'] .step-rule { transform-origin: right; }

/*
  TRAVELLING DES LIEUX.
  La bande a une largeur connue d'avance — cartes, écarts, marges —, donc sa
  course aussi : la section est haute de cette course (×0,7, la bande va un
  peu plus vite que la molette), plus un écran pour s'y poser.
*/
.places {
  --card: 62vw;
  --gap: 1rem;
  --pad: 8vw;
  --track: calc(2 * var(--pad) + var(--n) * var(--card) + (var(--n) - 1) * var(--gap));
  position: relative;
  height: calc(100svh + (var(--track) - 100vw) * 0.7);
}
@media (min-width: 640px) { .places { --card: 56vw; --gap: 1.5rem; } }
@media (min-width: 1024px) { .places { --card: 42vw; --pad: 10vw; } }

.places-stage {
  position: sticky;
  top: 0;
  height: 100svh;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: clamp(1.5rem, 4vh, 3rem);
  overflow: hidden;
}

.places-scroller { overflow: hidden; }

.places-track {
  display: flex;
  gap: var(--gap);
  width: var(--track);
  padding-inline: var(--pad);
  transform: translateX(calc(var(--p, 0) * (100vw - 100%)));
  will-change: transform;
}

.place { flex: 0 0 var(--card); }

.place-frame {
  display: block;
  aspect-ratio: 9 / 16;
  max-height: 60svh;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.6), 0 0 40px color-mix(in srgb, var(--accent) 14%, transparent);
}
@media (min-width: 640px) { .place-frame { aspect-ratio: 16 / 9; max-height: 58svh; } }
.place-accent { color: var(--accent); }
.place-accent-bg { background: var(--accent); }

.place-last {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding-inline: clamp(0rem, 3vw, 3rem);
}

.places-progress {
  transform-origin: left;
  transform: scaleX(var(--p, 0));
}

/* Les quatre arguments : panneaux à double filet, comme dans le kit. */
.reason {
  position: relative;
  padding: 1.75rem;
  background: rgb(var(--ink-900) / 0.6);
  border: 1px solid rgb(var(--neon-600) / 0.4);
}
.reason::before {
  content: '';
  position: absolute;
  inset: 6px;
  border: 1px solid rgb(var(--steel-600) / 0.5);
  pointer-events: none;
}
@media (min-width: 640px) { .reason { padding: 2.25rem; } }

.figure {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 2.5rem 1rem;
  border-color: rgb(var(--steel-700) / 0.6);
}
.figure:not(:last-child) { border-inline-end-width: 1px; }
@media (max-width: 767px) {
  .figure:nth-child(2) { border-inline-end-width: 0; }
  .figure:nth-child(-n + 2) { border-bottom-width: 1px; }
}

/* Le chiffre monte de sous la ligne, puis le tube grésille une fois. */
.figure-num {
  transition: transform 0.9s cubic-bezier(0.2, 0.7, 0.2, 1), opacity 0.9s ease;
  transition-delay: calc(var(--d, 0) * 120ms + 150ms);
}

/* Le temple s'enfonce plus lentement que la page. */
.cta-image {
  transform: translateY(calc((var(--p, 0.5) - 0.5) * -14%)) scale(1.18);
  will-change: transform;
}
.cta-veil {
  background:
    linear-gradient(180deg, rgb(var(--ink-900)) 0%, rgb(var(--ink-900) / 0.55) 22%, rgb(var(--ink-900) / 0.55) 78%, rgb(var(--ink-900)) 100%),
    radial-gradient(60% 60% at 50% 50%, rgb(var(--ink-900) / 0.82) 0%, rgb(var(--ink-900) / 0.4) 100%);
}

.creators {
  border: 1px solid rgb(var(--neon-600) / 0.45);
  background: rgb(var(--ink-800) / 0.6);
}

/*
  LE PDF EN ÉVENTAIL.
  --f passe de 0 (pile fermée) à 1 (pages ouvertes) pendant que la pile monte
  vers le milieu de l'écran. Sans animation, --p manque et --f vaut 1 : les
  pages sont déjà ouvertes. Le néon des pages est celui d'une aube orangée.
*/
.doc-stack {
  --doc-w: clamp(150px, 30vw, 290px);
  --f: clamp(0, (var(--p, 0.5) - 0.2) * 4, 1);
  --neon-200: 255 226 204;
  --neon-300: 255 176 120;
  --neon-400: 255 150 86;
  --neon-500: 255 128 56;
  --neon-600: 222 96 32;
  position: relative;
  height: calc(var(--doc-w) * 1.4142 + 7rem);
  margin-block: 2.5rem 3.5rem;
}
.doc {
  position: absolute;
  top: 3rem;
  left: 50%;
  width: var(--doc-w);
  aspect-ratio: 1 / 1.4142;
  margin-left: calc(var(--doc-w) / -2);
  overflow: hidden;
  background: rgb(var(--ink-900));
  border: 1px solid rgb(var(--steel-600) / 0.6);
  box-shadow: 0 30px 70px rgba(0, 0, 0, 0.75), 0 0 0 1px rgba(0, 0, 0, 0.4);
  font-size: calc(var(--doc-w) / 20);
  will-change: transform;
}
.doc-cover {
  z-index: 3;
  transform: translateX(calc(var(--f) * -66%)) rotate(calc(var(--f) * -7deg + (1 - var(--f)) * -1deg));
}
.doc-places {
  z-index: 2;
  transform: translateY(calc(var(--f) * -4%)) rotate(calc((1 - var(--f)) * 2.5deg));
}
.doc-end {
  z-index: 1;
  transform: translateX(calc(var(--f) * 66%)) rotate(calc(var(--f) * 7deg + (1 - var(--f)) * -3deg));
}

.doc-veil {
  position: absolute;
  inset: 0;
  background: linear-gradient(180deg, transparent 55%, rgb(var(--ink-900) / 0.96) 86%);
}
.doc-cover-text { position: absolute; inset-inline: 9%; bottom: 7%; }
.doc-rule {
  display: block;
  width: 26%;
  height: 1px;
  margin-bottom: 0.6em;
  background: linear-gradient(90deg, rgb(var(--neon-500)), transparent);
}
.doc-eyebrow,
.doc-h2,
.doc-dt,
.doc-tag,
.doc-num {
  font-family: Futura, 'Avenir Next', 'Century Gothic', 'Trebuchet MS', system-ui, sans-serif;
  text-transform: uppercase;
}
.doc-eyebrow { font-size: 0.42em; letter-spacing: 0.3em; color: rgb(var(--neon-300)); }

.doc-body { padding: 9% 9%; }
.doc-h2 { font-size: 0.5em; letter-spacing: 0.18em; color: rgb(var(--neon-200)); margin-bottom: 0.5em; }
.doc-gap { margin-top: 1.4em; }

.bar {
  display: block;
  height: 0.3em;
  margin-top: 0.42em;
  background: rgb(var(--ink-300) / 0.38);
}
.bar-title { height: 0.62em; margin-top: 0.4em; background: rgb(var(--neon-200)); box-shadow: 0 0 8px rgb(var(--neon-500) / 0.6); }
.bar-who { height: 0.26em; margin-top: 0.7em; background: rgb(var(--ink-200) / 0.7); }
.bar-goal { height: 0.36em; background: rgb(var(--ink-50) / 0.6); }
.bar-h3 { height: 0.36em; margin-top: 0.1em; background: rgb(var(--ink-50) / 0.75); }
.bar-answer { background: rgb(var(--neon-300)); }
.bar-endtitle { height: 0.6em; margin-top: 1.4em; margin-bottom: 0.4em; background: rgb(var(--neon-200)); box-shadow: 0 0 8px rgb(var(--neon-500) / 0.5); }

.doc-place {
  display: grid;
  grid-template-columns: 1.4em 1fr;
  gap: 0 0.5em;
  padding-block: 0.7em;
  border-top: 1px solid rgb(var(--steel-600) / 0.5);
}
.doc-num { font-size: 0.6em; color: rgb(var(--neon-400)); line-height: 1.1; }
.doc-row { display: grid; grid-template-columns: 38% 1fr; gap: 0.4em; margin-top: 0.3em; }
.doc-dt { font-size: 0.3em; letter-spacing: 0.1em; color: rgb(var(--steel-400)); padding-top: 0.9em; line-height: 1.2; }
.doc-dd { min-width: 0; }

.doc-kept { display: grid; grid-template-columns: 1fr 1fr; gap: 0 0.8em; }
.doc-kept-item { display: block; padding-block: 0.25em 0.4em; border-bottom: 1px solid rgb(var(--steel-600) / 0.4); }
.doc-tag { display: block; font-size: 0.3em; letter-spacing: 0.12em; color: rgb(var(--neon-400)); margin-top: 0.4em; }
.doc-last {
  margin-top: 0.9em;
  padding-top: 0.5em;
  padding-inline-start: 0.6em;
  border-top: 1px solid rgb(var(--neon-600) / 0.45);
  border-inline-start: 2px solid rgb(var(--neon-500) / 0.6);
}

/* Les quatre choses qu'on garde, sous la pile : un filet néon chacune. */
.keep-item { border-top: 1px solid rgb(var(--neon-600) / 0.45); padding-top: 1rem; }

/* L'arabe se lie : l'interlettrage y casse les mots. */
.pitch:lang(ar) * { letter-spacing: normal !important; }

@media (prefers-reduced-motion: reduce) {
  .slide-a, .slide-b, .cta-image { transform: none; }
  .why-title { letter-spacing: normal; }
}
</style>

<!--
  Ce qui dépend de l'état posé par `LoginScreen` sur `.home`. Hors `scoped` :
  Vue y réduirait `:global(.home) .x` à `.home` tout court, et c'est la page
  entière qui prenait le style. Tout est préfixé par `.pitch`.
-->
<style>
.home.is-motion .pitch .step:not(.is-in) .step-rule { transform: scaleX(0); }
.home.is-motion .pitch .figure:not(.is-in) .figure-num { transform: translateY(40%); opacity: 0; }

/* Sans animation : une bande qu'on fait glisser, sans section géante. */
.home:not(.is-motion) .pitch .places { height: auto; padding-block: 6rem; }
.home:not(.is-motion) .pitch .places-stage { position: static; height: auto; }
.home:not(.is-motion) .pitch .places-scroller { overflow-x: auto; scroll-snap-type: x mandatory; }
.home:not(.is-motion) .pitch .places-track { transform: none; }
.home:not(.is-motion) .pitch .place { scroll-snap-align: center; }
.home:not(.is-motion) .pitch .places-progress { transform: scaleX(1); }
</style>

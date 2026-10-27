<script setup lang="ts">
const { lang, t } = useLang()

import { dirOf, pack } from '~/utils/languages'
import { drawQuestCard } from '~/utils/quest-card'
import { saveFile } from '~/utils/save-file'
import { usePaywall } from '~/composables/usePaywall'
import { useGameStore } from '~/stores/game'
import { usePaymentStore } from '~/stores/payment'
import { usePlayerStore } from '~/stores/player'
import type { ScenePaywall } from '~/types/scene'

const { initPayments, fetchPaymentIntent, submitPayment, submitInvite } = usePaywall()
const gameStore = useGameStore()
const paymentStore = usePaymentStore()
const playerStore = usePlayerStore()

const isInitializing = ref(true)

// Le navigateur d'Instagram garde ses cookies à part : la nuit payée n'en sort pas.
const inInstagram = ref(false)

// Nuit offerte : l'e-mail et le code qu'on en a tiré, à la place de la carte.
const invite = reactive({ open: false, email: '', code: '' })

/**
 * Textes de repli, quand aucune scène n'est chargée — cas du visiteur qui a
 * épuisé son quota gratuit sans partie en cours. Ils viennent du script, servis
 * par une route qui ne génère rien.
 */
const fallback = ref<ScenePaywall | null>(null)

// Tout le texte du paywall vient du script, interpolé avec la quête du joueur.
const paywall = computed(() => playerStore.scene?.paywall ?? fallback.value)
const price = computed(() => {
  const p = paywall.value
  if (!p) return ''
  return new Intl.NumberFormat(pack(lang.value).tag, {
    style: 'currency',
    currency: p.currency,
    maximumFractionDigits: p.amount_cents % 100 ? 2 : 0,
  }).format(p.amount_cents / 100)
})

/**
 * L'écran se lit comme une affiche : des extraits du script, jamais réécrits.
 * Le texte entier reste dans le script et les packs ; on n'en montre que la
 * pointe.
 */
function firstSentence(text: string): string {
  try {
    const segments = new Intl.Segmenter(pack(lang.value).tag, { granularity: 'sentence' }).segment(text)
    return ([...segments][0]?.segment ?? text).trim()
  } catch {
    return text
  }
}

/** La dernière ligne de la porte — « Le sas ne s'ouvre pas encore. » */
const gateHook = computed(() => paywall.value?.gate_text.split(/\n\s*\n/).pop()?.trim() ?? '')

/** Le titre en deux moitiés, blanche puis néon. D'un bloc dans les écritures sans espaces. */
const titleHalves = computed(() => {
  const words = (paywall.value?.pitch?.generative?.title ?? '').split(' ')
  if (words.length < 2) return [words.join('')]
  const cut = Math.ceil(words.length / 2)
  return [words.slice(0, cut).join(' '), words.slice(cut).join(' ')]
})

/**
 * Ce qui se tend en lui, et vers quoi : citées seules, en grand. Les points du
 * script les encadrent d'un commentaire ; on garde leur libellé, pas le reste.
 */
const stakes = computed(() => {
  const night = playerStore.scene?.night
  const points = paywall.value?.pitch?.points ?? []
  return [night?.tension, night?.release].flatMap((quote) => {
    const point = quote ? points.find(p => p.text.includes(quote)) : undefined
    return point && quote ? [{ label: point.label, quote }] : []
  })
})

/** Les autres points, réduits à leur première phrase. */
const claims = computed(() => (paywall.value?.pitch?.points ?? [])
  .filter(p => !stakes.value.some(s => p.text.includes(s.quote)))
  .map(p => ({ label: p.label, text: firstSentence(p.text) })))

/** La salle qu'il veut quitter, en fond : l'auberge a une image fixe. */
const backdrop = computed(() => gameStore.currentSceneImageUrl || '/scenes/auberge.png')

/**
 * Le but de la nuit, à partager : une carte au format story, l'auberge et la
 * phrase que le barman a dite. Dessinée dès l'arrivée, pour que le partage
 * parte au clic — la feuille est refusée quand le geste est trop loin.
 */
const { origin, host } = useRequestURL({ xForwardedHost: true })
const goal = computed(() => playerStore.scene?.night?.goal ?? '')
const questCard = shallowRef<{ blob: Blob; url: string } | null>(null)

async function prepareQuestCard() {
  if (!goal.value) return
  try {
    const blob = await drawQuestCard({
      goal: goal.value,
      label: t('keepsake.goal'),
      title: t('seo.title').split(/\s*—+\s*/)[0],
      host,
      tag: pack(lang.value).tag,
      dir: dirOf(lang.value),
    })
    questCard.value = { blob, url: URL.createObjectURL(blob) }
  } catch { /* pas de carte : le bouton reste éteint, l'écran tient */ }
}

/** La feuille de partage du système ; sans elle, l'image se télécharge. */
async function shareQuest() {
  const card = questCard.value
  if (!card) return
  const file = new File([card.blob], 'far-night.jpg', { type: card.blob.type })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text: `${t('keepsake.goal')} — ${goal.value}\n${origin}/` })
      return
    } catch (err) {
      // Feuille fermée par le joueur : il n'a rien demandé d'autre.
      if ((err as Error).name === 'AbortError') return
    }
  }
  await saveFile(card.blob, file.name)
}

/** Même averse que l'accueil, dérivée de l'index pour un rendu stable. */
const raindrops = Array.from({ length: 36 }, (_, i) => ({
  left: (i * 37) % 100,
  height: 30 + (i * 11) % 70,
  delay: ((i * 13) % 22) / 10,
  duration: 0.7 + ((i * 7) % 7) / 10,
  opacity: 0.18 + ((i * 5) % 5) / 20,
}))

/**
 * LE DÉFILEMENT, comme sur l'accueil : `--p` sur le premier écran, `is-in` sur
 * chaque `[data-reveal]` à sa première apparition. Moins d'animation demandée :
 * `is-motion` n'est jamais posée, tout est visible d'emblée.
 */
const root = ref<HTMLElement | null>(null)
const hero = ref<HTMLElement | null>(null)
const checkout = ref<HTMLElement | null>(null)
const motion = ref(false)
const pastHero = ref(false)
const atCheckout = ref(false)
let frame = 0
let observer: IntersectionObserver | null = null

/** La barre d'achat suit le lecteur entre l'affiche et le formulaire. */
const showBar = computed(() => pastHero.value && !atCheckout.value)

function paint() {
  frame = 0
  const vh = window.innerHeight
  const top = hero.value?.getBoundingClientRect()
  pastHero.value = !!top && top.bottom < vh * 0.35
  atCheckout.value = (checkout.value?.getBoundingClientRect().top ?? Infinity) < vh * 0.85
  if (motion.value && top) {
    hero.value!.style.setProperty('--p', Math.min(1, Math.max(0, -top.top / top.height)).toFixed(4))
  }
}

function onScroll() {
  if (!frame) frame = requestAnimationFrame(paint)
}

function toCheckout() {
  checkout.value?.scrollIntoView({ behavior: motion.value ? 'smooth' : 'auto', block: 'start' })
}

onMounted(async () => {
  motion.value = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  inInstagram.value = navigator.userAgent.includes('Instagram')
  window.addEventListener('scroll', onScroll, { passive: true })
  window.addEventListener('resize', onScroll, { passive: true })

  if (!playerStore.scene) {
    try {
      fallback.value = await $fetch<ScenePaywall>('/api/paywall')
    } catch { /* le prix et le bouton resteront vides, sans casser l'écran */ }
  }

  // Après le repli : ses blocs n'existent qu'une fois les textes arrivés.
  await nextTick()
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      entry.target.classList.add('is-in')
      observer?.unobserve(entry.target)
    }
  }, { rootMargin: '0px 0px -10% 0px' })
  root.value?.querySelectorAll('[data-reveal]').forEach(el => observer?.observe(el))
  paint()
  prepareQuestCard()

  try {
    const intent = await fetchPaymentIntent()
    await nextTick()
    await initPayments('#card-container', intent)
  } catch (err) {
    paymentStore.setError(err instanceof Error ? err.message : 'Paiement indisponible')
  } finally {
    isInitializing.value = false
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  window.removeEventListener('resize', onScroll)
  if (frame) cancelAnimationFrame(frame)
  observer?.disconnect()
  if (questCard.value) URL.revokeObjectURL(questCard.value.url)
})

// L'écran suivant tient dans la fenêtre : il n'hérite pas du défilement.
onUnmounted(() => window.scrollTo(0, 0))
</script>

<template>
  <div ref="root" class="paywall relative overflow-x-clip bg-ink-900" :class="{ 'is-motion': motion }">
    <!--
      L'AFFICHE. La salle qu'il quitte en fond, qui recule en s'ouvrant puis
      descend moins vite que la page ; la pluie ; une phrase, un titre, un bouton.
    -->
    <section ref="hero" class="relative min-h-[100svh] overflow-hidden flex flex-col items-center justify-center px-5 pt-16 pb-28 text-center">
      <img :src="backdrop" alt="" decoding="async" class="hero-image absolute inset-0 w-full h-full object-cover">
      <div class="hero-veil absolute inset-0 pointer-events-none" />

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

      <div v-if="paywall" class="hero-content relative z-10 flex flex-col items-center gap-7 max-w-5xl w-full">
        <p data-reveal class="hook font-display uppercase text-neon-300 animate-neon-buzz">{{ gateHook }}</p>

        <p data-reveal class="eyebrow text-neon-400" style="--d: 1">{{ paywall.pitch?.generative?.eyebrow }}</p>

        <h1 class="pay-title font-display uppercase">
          <span data-reveal="start" class="block" style="--d: 1">
            <span :class="titleHalves[1] ? 'text-ink-50' : 'neon-text'">{{ titleHalves[0] }}</span>
          </span>
          <span v-if="titleHalves[1]" data-reveal="end" class="block neon-text" style="--d: 2">{{ titleHalves[1] }}</span>
        </h1>

        <p data-reveal class="font-serif italic text-ink-50 text-lg sm:text-2xl leading-snug max-w-2xl" style="--d: 3">
          {{ firstSentence(paywall.pitch?.generative?.text ?? '') }}
        </p>

        <div data-reveal class="w-full max-w-sm flex flex-col items-center gap-4 pt-2" style="--d: 4">
          <GlowButton class="w-full leading-relaxed" @click="toCheckout">{{ paywall.cta }}</GlowButton>
          <p class="text-neon-400/80 text-[10px] uppercase tracking-[0.3em] font-display leading-relaxed">{{ paywall.sub_cta }}</p>
        </div>
      </div>

      <div class="scroll-cue absolute bottom-6 left-1/2 -translate-x-1/2 h-12 w-px bg-steel-600/60 overflow-hidden" aria-hidden="true">
        <span class="scroll-cue-dot block w-px h-4 bg-neon-400" />
      </div>
    </section>

    <!-- Ce qui se joue pour lui : deux citations, la tension puis la direction -->
    <section v-if="stakes.length" class="max-w-5xl mx-auto px-4 sm:px-6 pt-24 pb-16 sm:pt-36 sm:pb-24">
      <p data-reveal class="eyebrow text-neon-400 text-center">{{ paywall?.pitch?.eyebrow }}</p>

      <div class="mt-14 sm:mt-20 flex flex-col">
        <template v-for="(stake, i) in stakes" :key="i">
          <svg v-if="i" data-reveal viewBox="0 0 10 8" class="w-5 h-4 my-8 sm:my-12 mx-auto fill-neon-500 arrow" aria-hidden="true">
            <path d="M0 0 L5 5 L10 0 L10 3 L5 8 L0 3 Z" />
          </svg>
          <figure data-reveal="wipe" class="stake" :class="i ? 'stake-release' : ''">
            <figcaption class="font-display uppercase text-[10px] sm:text-[11px] tracking-[0.3em] text-steel-400">
              <span class="text-neon-400 me-3">0{{ i + 1 }}</span>{{ stake.label }}
            </figcaption>
            <blockquote class="stake-quote font-serif italic mt-4">{{ stake.quote }}</blockquote>
          </figure>
        </template>
      </div>
    </section>

    <!-- Le but de la nuit, à emporter : la carte telle qu'elle partira, puis le geste -->
    <section v-if="goal" class="px-4 sm:px-6 pb-24 sm:pb-36 flex flex-col items-center gap-8">
      <div data-reveal class="quest-card w-full max-w-[17rem] aspect-[9/16]">
        <img v-if="questCard" :src="questCard.url" :alt="goal" width="1080" height="1920" class="w-full h-full">
      </div>
      <div data-reveal class="w-full max-w-sm" style="--d: 1">
        <GlowButton :disabled="!questCard" class="w-full" @click="shareQuest">{{ t('home.share') }}</GlowButton>
      </div>
    </section>

    <!-- Le reste du pitch, une phrase chacun -->
    <section v-if="claims.length" class="max-w-5xl mx-auto px-4 sm:px-6 pb-8" :class="{ 'pt-24 sm:pt-36': !stakes.length }">
      <div class="grid gap-4 sm:gap-6 md:grid-cols-2">
        <article
          v-for="(claim, i) in claims"
          :key="i"
          data-reveal="wipe"
          class="claim"
          :style="{ '--d': i % 2 }"
        >
          <p class="font-display uppercase text-[10px] tracking-[0.3em] text-steel-400">
            <span class="text-neon-400 me-3">0{{ stakes.length + i + 1 }}</span>{{ claim.label }}
          </p>
          <p class="font-display uppercase text-ink-50 text-lg sm:text-xl tracking-[0.06em] leading-snug mt-4">{{ claim.text }}</p>
        </article>
      </div>
    </section>

    <!-- LA CAISSE : le prix en grand, la carte, le bouton -->
    <section ref="checkout" class="relative pt-20 pb-16 sm:pt-28 sm:pb-24">
      <div
        class="absolute inset-x-0 bottom-0 h-[70%] pointer-events-none"
        style="background: radial-gradient(85% 100% at 50% 100%, rgb(var(--neon-500) / 0.18) 0%, transparent 68%)"
      />

      <div class="relative z-10 max-w-md mx-auto px-5 space-y-8">
        <div data-reveal class="text-center">
          <p class="eyebrow text-steel-400">{{ t('paywall.secure') }}</p>
          <p class="neon-text font-display leading-none tracking-[0.02em] text-[clamp(4rem,18vw,6.5rem)] mt-5">{{ price }}</p>
        </div>

        <p v-if="inInstagram" class="text-steel-400 text-[11px] leading-relaxed text-center">{{ t('paywall.instagram') }}</p>

        <!-- Formulaire Stripe : son fond est celui du panneau, il s'y fond -->
        <div class="card-panel">
          <div v-if="isInitializing" class="h-12 flex items-center justify-center">
            <p class="text-steel-400 text-xs">{{ t('paywall.loading') }}</p>
          </div>
          <div id="card-container" />

          <p v-if="paymentStore.errorMessage && !invite.open" class="text-red-400/80 text-xs text-center mt-3">
            {{ paymentStore.errorMessage }}
          </p>
        </div>

        <div class="text-center space-y-3">
          <GlowButton
            :loading="paymentStore.status === 'processing'"
            :disabled="isInitializing"
            class="w-full leading-relaxed"
            @click="submitPayment()"
          >
            {{ paywall?.cta ?? t('common.continue') }}
          </GlowButton>
          <!-- Contenu numérique livré tout de suite : la renonciation doit précéder le paiement (L221-28 13°). -->
          <p class="text-steel-400 text-[11px] leading-relaxed">
            {{ t('paywall.withdrawal') }}
            <a href="/mentions-legales#vente" target="_blank" rel="noopener" class="underline underline-offset-2 hover:text-neon-300">{{ t('legal.link') }}</a>
          </p>
        </div>

        <!-- Nuit offerte : un code tiré de l'e-mail remplace le paiement. -->
        <div class="text-center space-y-4">
          <button
            type="button"
            class="text-steel-400 hover:text-neon-300 text-[10px] uppercase tracking-[0.28em] font-display underline underline-offset-4"
            @click="invite.open = !invite.open; paymentStore.errorMessage = null"
          >
            {{ t('puzzle.eyebrow_code') }}
          </button>

          <form v-if="invite.open" class="space-y-3" @submit.prevent="submitInvite(invite.email, invite.code)">
            <input
              v-model="invite.email"
              type="email"
              placeholder="@"
              autocomplete="email"
              required
              class="w-full bg-ink-800/50 border-0 border-b border-steel-600 focus:border-neon-400 px-3 py-2 text-ink-100 text-[13px] outline-none"
            >
            <input
              v-model="invite.code"
              type="text"
              :placeholder="t('puzzle.eyebrow_code')"
              autocomplete="off"
              autocapitalize="characters"
              spellcheck="false"
              required
              class="w-full bg-ink-800/50 border-0 border-b border-steel-600 focus:border-neon-400 px-3 py-2 text-ink-100 text-[13px] uppercase tracking-[0.2em] outline-none"
            >
            <p v-if="paymentStore.errorMessage" class="text-red-400/80 text-xs">
              {{ paymentStore.errorMessage }}
            </p>
            <GlowButton type="submit" :loading="paymentStore.status === 'processing'" class="w-full">
              {{ t('common.continue') }}
            </GlowButton>
          </form>
        </div>

        <p v-if="playerStore.place" class="text-steel-400 text-[10px] uppercase tracking-[0.18em] font-display text-center">
          {{ playerStore.playerName }} — {{ playerStore.place.name }}
        </p>
      </div>
    </section>

    <!-- La barre d'achat, entre l'affiche et la caisse -->
    <Transition name="bar">
      <div v-if="showBar && paywall" class="buy-bar fixed inset-x-0 bottom-0 z-40">
        <div class="max-w-md mx-auto px-4 pt-3">
          <GlowButton class="w-full leading-relaxed" @click="toCheckout">{{ paywall.cta }}</GlowButton>
        </div>
      </div>
    </Transition>

    <div class="crt-scanlines fixed inset-0 z-30 pointer-events-none opacity-30" />
  </div>
</template>

<style scoped>
.eyebrow {
  font-family: Futura, 'Avenir Next', 'Century Gothic', 'Trebuchet MS', system-ui, sans-serif;
  font-size: 10px;
  letter-spacing: 0.42em;
  text-transform: uppercase;
}

/* La salle recule en s'allumant, puis descend moins vite que la page. */
.hero-image {
  transform: translateY(calc(var(--p, 0) * 28%));
  scale: 1.08;
  animation: hero-open 2.8s cubic-bezier(0.2, 0.7, 0.2, 1) both;
  will-change: transform;
}
@keyframes hero-open {
  from { scale: 1.32; filter: brightness(0.25); }
  to { scale: 1.08; filter: brightness(1); }
}
.hero-veil {
  background:
    linear-gradient(180deg, rgb(var(--ink-900) / 0.75) 0%, transparent 22%, transparent 55%, rgb(var(--ink-900)) 100%),
    radial-gradient(70% 60% at 50% 50%, rgb(var(--ink-900) / 0.86) 0%, rgb(var(--ink-900) / 0.55) 60%, rgb(var(--ink-900) / 0.25) 100%);
}
.hero-content {
  opacity: calc(1 - var(--p, 0) * 1.7);
  transform: translateY(calc(var(--p, 0) * -70px));
}

/* La porte fermée, comme un tampon néon. */
.hook {
  --cut: 7px;
  font-size: 11px;
  letter-spacing: 0.32em;
  padding: 0.6rem 1.1rem;
  box-shadow: inset 0 0 0 1px rgb(var(--neon-500) / 0.6);
  clip-path: polygon(var(--cut) 0, 100% 0, 100% calc(100% - var(--cut)), calc(100% - var(--cut)) 100%, 0 100%, 0 var(--cut));
  background: rgb(var(--ink-900) / 0.55);
}

.pay-title {
  font-size: clamp(2.4rem, 8.4vw, 5.8rem);
  line-height: 0.95;
  letter-spacing: 0.01em;
}

.scroll-cue-dot { animation: cue 2.2s cubic-bezier(0.6, 0, 0.4, 1) infinite; }
@keyframes cue {
  0% { transform: translateY(-100%); }
  70%, 100% { transform: translateY(300%); }
}

/* Les deux citations : un filet néon au bord, la seconde côté opposé et en néon. */
.stake {
  max-width: 46rem;
  padding-inline-start: 1.25rem;
  border-inline-start: 2px solid rgb(var(--neon-500));
}
.stake-release {
  align-self: flex-end;
  text-align: end;
  padding-inline: 0 1.25rem;
  border-inline-start: 0;
  border-inline-end: 2px solid rgb(var(--neon-500));
}
.stake-quote {
  font-size: clamp(1.5rem, 4.2vw, 3rem);
  line-height: 1.2;
  color: rgb(var(--ink-50));
}
.stake-release .stake-quote {
  color: rgb(var(--neon-300));
  text-shadow: 0 0 18px rgb(var(--neon-500) / 0.45);
}
.arrow { filter: drop-shadow(0 0 6px rgb(var(--neon-500) / 0.8)); }

/* La carte à partager, comme un écran allumé. */
.quest-card {
  background: rgb(var(--ink-800));
  box-shadow: 0 0 0 1px rgb(var(--neon-600) / 0.4), 0 30px 90px -30px rgb(var(--neon-500) / 0.5);
}

/* Panneaux à double filet, comme les arguments de l'accueil. */
.claim,
.card-panel {
  position: relative;
  padding: 1.75rem;
  background: rgb(var(--ink-900));
  border: 1px solid rgb(var(--neon-600) / 0.4);
}
.claim::before,
.card-panel::before {
  content: '';
  position: absolute;
  inset: 6px;
  border: 1px solid rgb(var(--steel-600) / 0.5);
  pointer-events: none;
}
.card-panel { padding: 1.25rem; }
.card-panel > * { position: relative; }
@media (min-width: 640px) { .claim { padding: 2.25rem; } }

.buy-bar {
  padding-bottom: max(0.75rem, env(safe-area-inset-bottom));
  background: rgb(var(--ink-900) / 0.88);
  border-top: 1px solid rgb(var(--neon-600) / 0.25);
  -webkit-backdrop-filter: blur(10px);
  backdrop-filter: blur(10px);
}
.bar-enter-active, .bar-leave-active { transition: transform 0.35s cubic-bezier(0.2, 0.7, 0.2, 1), opacity 0.35s ease; }
.bar-enter-from, .bar-leave-to { transform: translateY(100%); opacity: 0; }

/* Les apparitions. Sans `is-motion`, rien n'est jamais caché. */
.paywall.is-motion [data-reveal] {
  transition:
    opacity 0.9s cubic-bezier(0.2, 0.7, 0.2, 1),
    transform 0.9s cubic-bezier(0.2, 0.7, 0.2, 1),
    clip-path 1.1s cubic-bezier(0.2, 0.7, 0.2, 1);
  transition-delay: calc(var(--d, 0) * 120ms);
}
.paywall.is-motion [data-reveal]:not(.is-in) { opacity: 0; transform: translateY(28px); }
.paywall.is-motion [data-reveal='start']:not(.is-in) { transform: translateX(-14vw); }
.paywall.is-motion [data-reveal='end']:not(.is-in) { transform: translateX(14vw); }
.paywall.is-motion [data-reveal='wipe']:not(.is-in) { transform: none; clip-path: inset(0 100% 0 0); }
.paywall.is-motion [data-reveal='wipe'].is-in { clip-path: inset(0 0 0 0); }

/* L'arabe se lie : l'interlettrage y casse les mots. */
.paywall:lang(ar) * { letter-spacing: normal !important; }

@media (prefers-reduced-motion: reduce) {
  .hero-image { animation: none; transform: none; }
  .hero-content { transform: none; opacity: 1; }
  .scroll-cue-dot { animation: none; }
  .bar-enter-active, .bar-leave-active { transition: none; }
}
</style>

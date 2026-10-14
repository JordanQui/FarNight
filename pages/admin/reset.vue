<script setup lang="ts">
import { forgetAdmission, forgetRun } from '~/composables/useScene'
import { forgetSceneImage } from '~/utils/scene-image-memory'
import { forgetKeepsake } from '~/utils/keepsake'

/**
 * Remettre le navigateur à zéro, pour tester.
 *
 * Les cookies du jeu sont `httpOnly` : seul le serveur peut les effacer, sur
 * une requête qui vient du navigateur — d'où la page, plutôt qu'une commande.
 * Fait la même chose que « mémoire vide (test) » de l'accueil, qui reste
 * injoignable depuis l'écran de fermeture, et oublie en plus le PDF de la nuit.
 * La langue reste.
 */
definePageMeta({ middleware: 'admin' })

/** Le cookie, en 3D : des disques empilés pour l'épaisseur, des pépites en relief. */
const LAYERS = 30
const GAP = 0.65
const THICK = LAYERS * GAP
/** Un éclat en a moins : il ne vit qu'une seconde, en vol. */
const FRAG_LAYERS = 12
const FRAG_GAP = THICK / FRAG_LAYERS

const CHIPS = [
  [34, 28, 22, 12], [56, 22, 18, -20], [70, 48, 24, 35], [46, 46, 20, 70],
  [27, 52, 16, -40], [52, 70, 22, 15], [36, 72, 17, 50], [66, 72, 19, -10],
] as const
type Chip = typeof CHIPS[number]

/** Hasard à graine fixe : le serveur et le navigateur découpent le même cookie. */
let seed = 11
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647

/**
 * Les éclats : sept parts aux bords dentelés.
 *
 * Deux parts voisines partagent la même ligne de cassure, si bien qu'au repos
 * elles reforment exactement le cookie entier — l'échange est invisible.
 */
const PIECES = 7
const at = (r: number, a: number) =>
  `${(50 + r * 100 * Math.cos(a)).toFixed(2)}% ${(50 + r * 100 * Math.sin(a)).toFixed(2)}%`
const cracks = Array.from({ length: PIECES }, (_, k) => {
  const a = (k / PIECES) * Math.PI * 2 + (rnd() - 0.5) * 0.5
  return { a, inner: at(0.15, a + (rnd() - 0.5) * 0.35), mid: at(0.33, a + (rnd() - 0.5) * 0.3), outer: at(0.8, a) }
})
const pieces = cracks.map((from, k) => {
  const to = cracks[(k + 1) % PIECES]!
  const end = k === PIECES - 1 ? to.a + Math.PI * 2 : to.a
  const mid = (from.a + end) / 2
  const dist = 170 + rnd() * 90
  const spin = () => `${Math.round((rnd() - 0.5) * 900)}deg`
  const angleOf = ([x, y]: Chip) => {
    const a = Math.atan2(y - 50, x - 50)
    return a < cracks[0]!.a ? a + Math.PI * 2 : a
  }
  return {
    clip: `polygon(50% 50%, ${from.inner}, ${from.mid}, ${from.outer}, ${at(0.85, mid)}, ${to.outer}, ${to.mid}, ${to.inner})`,
    chips: CHIPS.filter(c => angleOf(c) >= from.a && angleOf(c) < end),
    flight: {
      '--tx': `${Math.round(Math.cos(mid) * dist)}px`,
      '--ty': `${Math.round(Math.sin(mid) * dist)}px`,
      '--tz': `${Math.round(60 + rnd() * 140)}px`,
      '--rx': spin(), '--ry': spin(), '--rz': spin(),
    },
  }
})

/** Plus sombre vers le dessous : la tranche se lit comme une cuisson. */
function baked(i: number, n: number) {
  const t = i / (n - 1)
  const mix = (a: number, b: number) => Math.round(a + (b - a) * t)
  return `rgb(${mix(110, 186)} ${mix(64, 121)} ${mix(28, 60)})`
}

function chipStyle([x, y, size, rot]: Chip) {
  return {
    left: `${x}%`, top: `${y}%`, width: `${size}px`, height: `${size * 0.8}px`,
    transform: `translate(-50%, -50%) translateZ(${THICK / 2 + 2}px) rotate(${rot}deg)`,
  }
}

const phase = ref<'idle' | 'charging' | 'boom' | 'done' | 'error'>('idle')
/** Le cookie est en morceaux : on montre les éclats à la place du cookie entier. */
const shattered = ref(false)
/** Un cookie neuf vient de reparaître. */
const reborn = ref(false)
const tilt = reactive({ x: 0, y: 0 })
const crumbs = ref<Array<Record<string, string>>>([])

function aim(e: PointerEvent) {
  const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
  tilt.x = ((e.clientX - box.left) / box.width - 0.5) * 2
  tilt.y = ((e.clientY - box.top) / box.height - 0.5) * 2
}

const CRUMB_COLORS = ['#c48446', '#d99a57', '#a8672f', '#3b2316']

/** Les miettes, projetées tout autour, puis rattrapées par la gravité. */
function burst() {
  crumbs.value = Array.from({ length: 28 }, () => {
    const a = rnd() * Math.PI * 2
    const speed = 80 + rnd() * 160
    const size = 3 + rnd() * 7
    return {
      '--dx': `${Math.round(Math.cos(a) * speed)}px`,
      '--dy': `${Math.round(Math.sin(a) * speed * 0.6 - 50)}px`,
      '--rot': `${Math.round((rnd() - 0.5) * 720)}deg`,
      width: `${size}px`,
      height: `${size * 0.75}px`,
      background: CRUMB_COLORS[Math.floor(rnd() * CRUMB_COLORS.length)]!,
      animationDelay: `${(rnd() * 0.08).toFixed(2)}s`,
    }
  })
  setTimeout(() => { crumbs.value = [] }, 1800)
}

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function wipe() {
  await $fetch('/api/dev/forget', { method: 'POST' })
  forgetRun()
  forgetAdmission()
  forgetKeepsake()
  await forgetSceneImage()
}

async function reset() {
  if (phase.value === 'charging' || phase.value === 'boom') return
  phase.value = 'charging'
  try {
    // Le cookie tremble le temps d'effacer : il n'explose que si c'est fait.
    await Promise.all([wipe(), pause(700)])
  } catch {
    phase.value = 'error'
    return
  }
  phase.value = 'boom'
  shattered.value = true
  burst()
  await pause(1300)
  phase.value = 'done'
  await pause(400)
  shattered.value = false
  reborn.value = true
  setTimeout(() => { reborn.value = false }, 700)
}
</script>

<template>
  <div class="min-h-[100dvh] px-5 py-10 sm:px-8 overflow-x-hidden">
    <div class="mx-auto w-full max-w-xl space-y-10">
      <header class="space-y-4">
        <p class="font-display text-[10px] uppercase tracking-[0.4em] text-neon-400/80">Admin — test</p>
        <h1 class="neon-text font-display uppercase text-2xl sm:text-3xl tracking-[0.05em]">Reset</h1>
        <div class="neon-rule w-32" />
        <p class="text-ink-200/85 text-sm leading-relaxed">
          Efface les cookies signés du jeu — quota, accès payé, verrou, position — et la partie gardée par ce
          navigateur : scène, journal, inventaire, formulaire, image, PDF de la nuit. La langue reste.
        </p>
      </header>

      <div
        class="stage"
        :class="{ quake: phase === 'boom' }"
        @pointermove="aim"
        @pointerleave="tilt.x = 0; tilt.y = 0"
      >
        <div class="glow" :class="{ hot: phase === 'charging' }" />
        <div
          class="tilt"
          :style="{ transform: `rotateX(${58 - tilt.y * 18}deg) rotateY(${tilt.x * 22}deg)` }"
        >
          <div class="shake" :class="{ charging: phase === 'charging', reborn }">
            <div class="spin" :class="{ fast: phase === 'charging' }">
              <template v-if="!shattered">
                <div
                  v-for="i in LAYERS"
                  :key="`l-${i}`"
                  class="layer"
                  :style="{ transform: `translateZ(${(i - 1) * GAP - THICK / 2}px)`, background: baked(i - 1, LAYERS) }"
                />
                <div class="layer top" :style="{ transform: `translateZ(${THICK / 2}px)` }" />
                <span v-for="(chip, i) in CHIPS" :key="`c-${i}`" class="chip" :style="chipStyle(chip)" />
              </template>

              <template v-else>
                <div v-for="(piece, k) in pieces" :key="`p-${k}`" class="frag" :style="piece.flight">
                  <div
                    v-for="i in FRAG_LAYERS"
                    :key="`pl-${i}`"
                    class="layer"
                    :style="{
                      transform: `translateZ(${(i - 1) * FRAG_GAP - THICK / 2}px)`,
                      background: baked(i - 1, FRAG_LAYERS), clipPath: piece.clip,
                    }"
                  />
                  <div class="layer top" :style="{ transform: `translateZ(${THICK / 2}px)`, clipPath: piece.clip }" />
                  <span v-for="(chip, i) in piece.chips" :key="`pc-${i}`" class="chip" :style="chipStyle(chip)" />
                </div>
              </template>
            </div>
          </div>
        </div>

        <template v-if="phase === 'boom'">
          <div class="flash" />
          <div class="ring" />
        </template>
        <span v-for="(c, i) in crumbs" :key="`m-${i}`" class="crumb" :style="c" />
      </div>

      <div class="space-y-4 text-center">
        <GlowButton class="w-full" :loading="phase === 'charging' || phase === 'boom'" @click="reset">Reset cookie</GlowButton>
        <p v-if="phase === 'done'" class="text-neon-300 text-sm">Mémoire vide. La prochaine partie repart de l’accueil.</p>
        <p v-else-if="phase === 'error'" class="text-red-400/80 text-xs">
          Le serveur n’a pas effacé les cookies : le serveur de dev tourne-t-il ?
        </p>
      </div>

      <nav class="flex gap-4 text-xs">
        <!-- Un vrai chargement : les stores du jeu repartent vides eux aussi. -->
        <a href="/" class="text-ink-300 hover:text-neon-300 hover:underline underline-offset-4">Retour au jeu</a>
      </nav>
    </div>
  </div>
</template>

<style scoped>
.stage {
  position: relative;
  height: 320px;
  display: flex;
  align-items: center;
  justify-content: center;
  perspective: 900px;
  touch-action: none;
}

/* Le néon sous le cookie : il pose l'objet dans la nuit du jeu. */
.glow {
  position: absolute;
  left: 50%;
  top: 62%;
  width: 280px;
  height: 70px;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: radial-gradient(closest-side, rgb(var(--neon-500) / 0.45), transparent);
  filter: blur(6px);
  animation: breathe 3.2s ease-in-out infinite;
}

.glow.hot {
  background: radial-gradient(closest-side, rgb(var(--neon-400) / 0.85), transparent);
  animation-duration: 0.25s;
}

.tilt,
.shake,
.spin,
.frag {
  transform-style: preserve-3d;
}

.tilt {
  width: 240px;
  height: 240px;
  transition: transform 0.25s ease-out;
}

.shake,
.spin {
  position: relative;
  width: 100%;
  height: 100%;
}

.shake.charging {
  animation: rattle 0.09s linear infinite;
}

.shake.reborn {
  animation: pop 0.6s cubic-bezier(0.3, 1.6, 0.5, 1);
}

.spin {
  animation: spin 16s linear infinite;
}

.spin.fast {
  animation-duration: 1.4s;
}

.layer {
  position: absolute;
  inset: 0;
  border-radius: 50%;
}

.layer.top {
  background:
    radial-gradient(circle at 40% 36%, rgb(255 236 196 / 0.22) 0 3%, transparent 3.5%),
    radial-gradient(circle at 62% 60%, rgb(255 236 196 / 0.18) 0 2.5%, transparent 3%),
    radial-gradient(circle at 30% 64%, rgb(120 70 30 / 0.35) 0 2%, transparent 2.5%),
    radial-gradient(circle at 74% 34%, rgb(120 70 30 / 0.3) 0 2.5%, transparent 3%),
    radial-gradient(circle at 46% 42%, #e6b06b 0%, #cf9150 55%, #b06f34 88%, #93582a 100%);
  box-shadow: inset 0 0 18px rgb(90 50 20 / 0.55);
}

.chip {
  position: absolute;
  border-radius: 42% 58% 50% 46%;
  background: radial-gradient(circle at 35% 30%, #74462a, #2e180c 72%);
}

/* Les éclats volent en 3D ; ce sont leurs couches qui s'effacent, pour garder l'épaisseur en vol. */
.frag {
  position: absolute;
  inset: 0;
  animation: fly 1.25s cubic-bezier(0.12, 0.7, 0.3, 1) forwards;
}

.frag > * {
  animation: fade 1.25s ease-in forwards;
}

.flash {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 300px;
  height: 300px;
  margin: -150px 0 0 -150px;
  border-radius: 50%;
  background: radial-gradient(closest-side, rgb(255 255 255 / 0.95), rgb(var(--neon-400) / 0.7) 40%, transparent 72%);
  pointer-events: none;
  animation: flash 0.6s ease-out forwards;
}

/* L'onde de choc, à plat dans le plan du cookie : une ellipse, comme lui. */
.ring {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 240px;
  height: 240px;
  margin: -120px 0 0 -120px;
  border-radius: 50%;
  border: 2px solid rgb(var(--neon-300));
  box-shadow: 0 0 18px rgb(var(--neon-500) / 0.8), inset 0 0 18px rgb(var(--neon-500) / 0.6);
  pointer-events: none;
  animation: ring 0.8s ease-out forwards;
}

.crumb {
  position: absolute;
  left: 50%;
  top: 50%;
  border-radius: 40% 60% 45% 55%;
  pointer-events: none;
  animation: burst 1.4s cubic-bezier(0.2, 0.6, 0.6, 1) forwards;
}

.stage.quake {
  animation: quake 0.45s linear;
}

@keyframes spin {
  to { transform: rotateZ(360deg); }
}

@keyframes breathe {
  50% { opacity: 0.6; }
}

@keyframes rattle {
  0% { transform: translate3d(2px, -1px, 0); }
  25% { transform: translate3d(-2px, 2px, 1px); }
  50% { transform: translate3d(1px, 2px, -1px); }
  75% { transform: translate3d(-1px, -2px, 0); }
  100% { transform: translate3d(2px, -1px, 0); }
}

@keyframes pop {
  0% { transform: scale3d(0.2, 0.2, 0.2); }
  100% { transform: scale3d(1, 1, 1); }
}

@keyframes fly {
  to {
    transform: translate3d(var(--tx), var(--ty), var(--tz)) rotateX(var(--rx)) rotateY(var(--ry)) rotateZ(var(--rz));
  }
}

@keyframes fade {
  0%, 55% { opacity: 1; }
  100% { opacity: 0; }
}

@keyframes flash {
  0% { transform: scale(0.2); opacity: 1; }
  100% { transform: scale(2.2); opacity: 0; }
}

@keyframes ring {
  0% { transform: scale(0.3, 0.16); opacity: 1; }
  100% { transform: scale(2.6, 1.38); opacity: 0; }
}

@keyframes burst {
  0% { transform: translate(0, 0) rotate(0); opacity: 1; }
  40% { transform: translate(calc(var(--dx) * 0.7), calc(var(--dy) * 0.85)) rotate(calc(var(--rot) * 0.4)); opacity: 1; }
  100% { transform: translate(var(--dx), calc(var(--dy) + 170px)) rotate(var(--rot)); opacity: 0; }
}

@keyframes quake {
  0%, 100% { transform: translate(0, 0); }
  15% { transform: translate(-6px, 3px); }
  30% { transform: translate(5px, -4px); }
  45% { transform: translate(-4px, -2px); }
  60% { transform: translate(3px, 3px); }
  80% { transform: translate(-2px, 1px); }
}

@media (prefers-reduced-motion: reduce) {
  .spin, .glow, .shake.charging, .stage.quake { animation: none; }
}
</style>

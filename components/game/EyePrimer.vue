<script setup lang="ts">
const { t } = useLang()

import { usePlayerStore } from '~/stores/player'

/**
 * Ce que le bouton de l'oeil allume : un voile opaque, pleine page, tant que
 * l'oeil est fermé à l'arrivée sur la page.
 *
 * UNE FENÊTRE D'INTERFACE, PAS UN MORCEAU DE RÉCIT. L'oeil n'est pas un objet
 * qu'on trouve ni un pouvoir qu'on gagne : c'est la commande qui active la
 * lecture des noms, et le son qui va avec. Son texte est donc FIXE — écrit
 * dans `defaults.eye_primer` —, jamais généré avec la scène.
 *
 * Elle s'ouvre à la souris comme au doigt, et l'icône suit ce qui visera :
 * la souris sur desktop, le capteur au tactile. SUR IOS, LE GYROSCOPE N'ÉMET
 * RIEN AVANT LA PERMISSION, et cette fenêtre est précisément ce qui la précède :
 * l'icône dérive donc d'elle-même tant que rien ne parle.
 */
const emit = defineEmits<{ confirm: [] }>()

const playerStore = usePlayerStore()
const labels = computed(() => playerStore.scene?.eye_primer)

/**
 * Ce que dit la fenêtre si la scène n'est pas encore là.
 *
 * Ce texte ne dépend d'aucune scène — c'est une commande d'interface —, donc
 * il n'y a aucune raison qu'un chargement en retard laisse la fenêtre muette.
 */
const body = computed(() => labels.value?.body?.length ? labels.value.body : [t('game.eye_body_1'), t('game.eye_body_2')])

/** Position dans le carré, en fraction. 0,5 au centre. */
const pos = ref({ x: 0.5, y: 0.5 })
/** Le capteur a parlé : on cesse alors la dérive de démonstration. */
const live = ref(false)

let raf: number | null = null
let phase = 0

function onOrientation(e: DeviceOrientationEvent) {
  if (e.beta === null || e.gamma === null) return
  live.value = true
  // Débattement volontairement court : le carré fait quelques dizaines de
  // pixels, il doit réagir à un mouvement de poignet.
  pos.value = {
    x: Math.min(1, Math.max(0, 0.5 + e.gamma / 24)),
    y: Math.min(1, Math.max(0, 0.5 + (e.beta - 45) / 30)),
  }
}

/** À la souris, l'icône suit le curseur, ramené à l'échelle du carré. */
function onPointer(e: PointerEvent) {
  if (e.pointerType !== 'mouse') return
  live.value = true
  pos.value = { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight }
}

function drift() {
  if (!live.value) {
    phase += 0.018
    // Une figure de Lissajous : les deux axes ne se répètent pas ensemble, le
    // mouvement ne paraît donc jamais mécanique.
    pos.value = { x: 0.5 + Math.sin(phase) * 0.34, y: 0.5 + Math.sin(phase * 1.6) * 0.3 }
  }
  raf = requestAnimationFrame(drift)
}

onMounted(() => {
  window.addEventListener('deviceorientation', onOrientation, true)
  window.addEventListener('pointermove', onPointer, { passive: true })
  raf = requestAnimationFrame(drift)
})
onUnmounted(() => {
  window.removeEventListener('deviceorientation', onOrientation, true)
  window.removeEventListener('pointermove', onPointer)
  if (raf) cancelAnimationFrame(raf)
})

const style = computed(() => ({
  left: `${pos.value.x * 100}%`,
  top: `${pos.value.y * 100}%`,
}))
</script>

<template>
  <div
    class="fixed inset-0 z-[60] flex items-center justify-center px-6 py-8 overflow-y-auto bg-ink-900"
  >

    <div
      class="relative z-10 w-full max-w-sm bg-ink-900 border border-neon-600/50 p-7 space-y-6"
      style="box-shadow: 0 24px 60px rgba(0,0,0,0.8), 0 0 40px rgb(var(--neon-500) / 0.12)"
    >
      <span class="absolute inset-[5px] border border-neon-500/15 pointer-events-none" />

      <!-- Le carré est invisible : seul le déplacement se voit. -->
      <div class="relative h-24 w-24 mx-auto">
        <div class="absolute -translate-x-1/2 -translate-y-1/2 text-neon-400" :style="style">
          <svg viewBox="0 0 24 16" class="w-10 h-7" fill="none" stroke="currentColor" stroke-width="1.2">
            <path d="M1 8s4-6.5 11-6.5S23 8 23 8s-4 6.5-11 6.5S1 8 1 8Z" />
            <circle cx="12" cy="8" r="3.2" fill="currentColor" opacity="0.85" />
          </svg>
        </div>
      </div>

      <div class="space-y-2 text-center">
        <p class="text-neon-400/80 text-[10px] uppercase tracking-[0.32em] font-display">
          {{ labels?.eyebrow ?? t('game.eye_eyebrow') }}
        </p>
      </div>

      <p
        v-for="(line, i) in body"
        :key="i"
        class="text-ink-200/85 text-sm leading-relaxed"
      >
        {{ line }}
      </p>

      <GlowButton class="w-full" @click="emit('confirm')">
        {{ labels?.cta ?? t('game.eye_open') }}
      </GlowButton>
    </div>
  </div>
</template>

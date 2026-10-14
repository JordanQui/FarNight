<script setup lang="ts">
/**
 * Un panneau noir opaque qui désigne une commande de l'interface.
 *
 * Le reste de l'écran s'éteint, la commande reste allumée dans sa découpe, et
 * le panneau pointe dessus. Il sert aux commandes qui APPARAISSENT en cours de
 * partie — la loupe, l'issue — et qu'on ne remarque pas : elles s'allument
 * pendant que la fenêtre de l'augmentation recouvre l'écran.
 *
 * La cible est cherchée par son `data-hint`, à chaque image : la barre bouge
 * encore quand un bandeau se replie, et le panneau doit la suivre.
 */
const props = defineProps<{ target: string; text: string; cta: string }>()
const emit = defineEmits<{ close: [] }>()

const rect = ref<{ x: number; y: number; w: number; h: number } | null>(null)
const view = ref({ w: 0, h: 0 })

let raf: number | null = null
function track() {
  const el = document.querySelector(`[data-hint="${props.target}"]`)
  const r = el?.getBoundingClientRect()
  const next = r && r.width ? { x: r.left, y: r.top, w: r.width, h: r.height } : null
  const now = rect.value
  if (!next || !now || next.x !== now.x || next.y !== now.y || next.w !== now.w || next.h !== now.h) rect.value = next
  if (view.value.w !== window.innerWidth || view.value.h !== window.innerHeight) {
    view.value = { w: window.innerWidth, h: window.innerHeight }
  }
  raf = requestAnimationFrame(track)
}
onMounted(track)
onUnmounted(() => { if (raf) cancelAnimationFrame(raf) })

const PAD = 6
const GAP = 14
const MARGIN = 16

const layout = computed(() => {
  const r = rect.value
  if (!r) return null
  const width = Math.min(288, view.value.w - MARGIN * 2)
  const cx = r.x + r.w / 2
  const left = Math.min(Math.max(cx - width / 2, MARGIN), view.value.w - MARGIN - width)
  // Le panneau se pose du côté où il reste de la place : sous la loupe, qui est
  // au milieu de l'écran, au-dessus de l'issue, qui est tout en bas.
  const below = r.y + r.h / 2 < view.value.h / 2
  return {
    below,
    hole: {
      left: `${r.x - PAD}px`, top: `${r.y - PAD}px`,
      width: `${r.w + PAD * 2}px`, height: `${r.h + PAD * 2}px`,
    },
    panel: {
      left: `${left}px`, width: `${width}px`,
      ...(below
        ? { top: `${r.y + r.h + PAD + GAP}px` }
        : { bottom: `${view.value.h - r.y + PAD + GAP}px` }),
    },
    arrow: { left: `${Math.min(Math.max(cx - left, 16), width - 16)}px` },
  }
})
</script>

<template>
  <div v-if="layout" class="fixed inset-0 z-[55]" @click="emit('close')">
    <!-- La découpe : son ombre éteint tout le reste de l'écran. -->
    <div class="spot-hole absolute border border-neon-400/80 pointer-events-none" :style="layout.hole" />

    <div
      class="absolute bg-black border border-neon-600/60 p-5 space-y-4"
      style="box-shadow: 0 0 40px rgb(var(--neon-500) / 0.12)"
      :style="layout.panel"
      @click.stop
    >
      <span
        class="absolute -translate-x-1/2 w-3 h-3 bg-black border-neon-600/60 rotate-45"
        :class="layout.below ? '-top-[7px] border-l border-t' : '-bottom-[7px] border-r border-b'"
        :style="layout.arrow"
      />
      <p class="text-ink-200/90 text-sm leading-relaxed">{{ text }}</p>
      <GlowButton class="w-full" @click="emit('close')">{{ cta }}</GlowButton>
    </div>
  </div>
</template>

<style scoped>
.spot-hole {
  box-shadow: 0 0 18px rgb(var(--neon-400) / 0.55), 0 0 0 200vmax rgba(0, 0, 0, 0.88);
}
</style>

<script setup lang="ts">
const { t } = useLang()

// Le texte reste d'un seul tenant dans les packs : on le découpe ici en
// phrases (ponctuation latine ou CJK) et on n'en montre qu'une à la fois.
const sentences = computed(() =>
  (t('game.loading_disclaimer').match(/[^.!?。！？]+[.!?。！？]*/g) ?? [])
    .map(s => s.trim())
    .filter(Boolean),
)

const index = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  timer = setInterval(() => {
    index.value = (index.value + 1) % Math.max(sentences.value.length, 1)
  }, 4000)
})
onUnmounted(() => { if (timer) clearInterval(timer) })
</script>

<template>
  <p
    class="absolute inset-x-0 bottom-0 z-10 mx-auto max-w-md px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-[10px] leading-relaxed text-ink-200/35 text-center min-h-[3.5rem] flex items-end justify-center"
  >
    <Transition name="disclaimer" mode="out-in">
      <span :key="index">{{ sentences[index] }}</span>
    </Transition>
  </p>
</template>

<style scoped>
.disclaimer-enter-active, .disclaimer-leave-active { transition: opacity 0.6s ease, transform 0.6s ease; }
.disclaimer-enter-from { opacity: 0; transform: translateY(4px); }
.disclaimer-leave-to { opacity: 0; transform: translateY(-4px); }
</style>

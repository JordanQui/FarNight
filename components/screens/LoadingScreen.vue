<script setup lang="ts">
const { t } = useLang()

defineProps<{ message?: string }>()
</script>

<template>
  <div class="relative min-h-[100dvh] flex flex-col items-center justify-center gap-6 px-6">
    <!-- Skyline Deco : trois gradins qui respirent, décalés -->
    <div class="flex items-end gap-1.5 h-6" aria-hidden="true">
      <span
        v-for="(h, i) in [12, 24, 12]"
        :key="i"
        class="w-1.5 bg-neon-500 animate-deco-pulse"
        :style="{ height: `${h}px`, animationDelay: `${i * 0.35}s` }"
      />
    </div>

    <p class="font-display text-[11px] uppercase tracking-[0.32em] text-neon-400/85 text-center">
      {{ message ?? t('game.loading_default') }}
    </p>

    <LoadingDisclaimer />
  </div>
</template>

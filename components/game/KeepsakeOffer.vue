<script setup lang="ts">
const { t } = useLang()

import type { Keepsake } from '~/utils/keepsake'
import { saveFile } from '~/utils/save-file'

/**
 * Le PDF de la nuit, offert à la fin.
 *
 * Sur l'écran de fin, puis sur l'écran de fermeture tant que la ville reste
 * close : un rechargement ne le fait pas perdre.
 */
const props = defineProps<{ keepsake: Keepsake }>()

const preparing = ref(false)
const failed = ref(false)
/** Le PDF déjà imprimé : le retélécharger ne repasse pas par le serveur. */
let pdf: Blob | null = null

const filename = computed(() => `${t('seo.title').split(' — ')[0]} — ${props.keepsake.title}.pdf`)

async function download() {
  failed.value = false
  if (!pdf) {
    preparing.value = true
    try {
      pdf = await $fetch<Blob>('/api/keepsake', {
        method: 'POST',
        body: { keepsake: props.keepsake },
        responseType: 'blob',
      })
    } catch {
      failed.value = true
      return
    } finally {
      preparing.value = false
    }
  }
  await saveFile(pdf, filename.value)
}
</script>

<template>
  <div class="keepsake">
    <button type="button" class="cta" :disabled="preparing" @click="download">
      {{ preparing ? t('keepsake.preparing') : t('keepsake.cta') }}
    </button>
    <p class="text-ink-200/85 text-[13px] leading-relaxed text-center mt-3">{{ t('keepsake.pitch') }}</p>
    <p v-if="failed" class="text-red-400/80 text-xs text-center mt-3">{{ t('keepsake.failed') }}</p>
  </div>
</template>

<style scoped>
.keepsake {
  margin-top: 1.25rem;
}

.cta {
  display: block;
  margin: 0 auto;
  padding: 0.7rem 1.4rem;
  font-family: Futura, 'Avenir Next', 'Century Gothic', 'Trebuchet MS', system-ui, sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  font-size: 12px;
  color: rgb(var(--ink-900));
  background: rgb(var(--neon-300));
  box-shadow: 0 0 18px rgb(var(--neon-500) / 0.55);
  transition: box-shadow 0.2s, background 0.2s;
}

.cta:hover,
.cta:focus-visible {
  background: rgb(var(--neon-200));
  box-shadow: 0 0 26px rgb(var(--neon-500) / 0.75);
  outline: none;
}

.cta:disabled {
  opacity: 0.7;
}
</style>

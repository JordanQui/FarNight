<script setup lang="ts">
const { t } = useLang()

import { usePaywall } from '~/composables/usePaywall'
import { usePaymentStore } from '~/stores/payment'
import { storeKeepsake, type Keepsake } from '~/utils/keepsake'
import { saveFile } from '~/utils/save-file'
import { pack } from '~/utils/languages'

/**
 * Le PDF de la nuit, vendu à la fin.
 *
 * Sur l'écran de fin, puis sur l'écran de fermeture tant que la ville reste
 * close : un rechargement ne fait pas perdre l'offre. Payé, il se retélécharge
 * avec le même paiement, gardé dans le carnet.
 */
const props = defineProps<{ keepsake: Keepsake }>()

const { initPayments, fetchPaymentIntent, confirmCard } = usePaywall()
const paymentStore = usePaymentStore()

const paymentId = ref<string | null>(props.keepsake.payment_id ?? null)
const open = ref(false)
const initializing = ref(false)
const preparing = ref(false)
const failed = ref(false)
/** Le PDF déjà imprimé : le retélécharger ne repasse pas par le serveur. */
let pdf: Blob | null = null

const offer = useRuntimeConfig().public.paywallPrice as { keepsake: number; currency: string }
const price = computed(() => new Intl.NumberFormat(pack(props.keepsake.lang).tag, {
  style: 'currency',
  currency: offer.currency,
  minimumFractionDigits: Number.isInteger(offer.keepsake) ? 0 : 2,
}).format(offer.keepsake))

const filename = computed(() => `${t('seo.title').split(' — ')[0]} — ${props.keepsake.title}.pdf`)

async function openForm() {
  open.value = true
  initializing.value = true
  paymentStore.errorMessage = null
  try {
    const intent = await fetchPaymentIntent('keepsake')
    await nextTick()
    await initPayments('#keepsake-card', intent)
  } catch (err) {
    paymentStore.setError(err instanceof Error ? err.message : t('errors.payment_form'))
  } finally {
    initializing.value = false
  }
}

async function pay() {
  try {
    const id = await confirmCard()
    if (!id) return
    paymentId.value = id
    storeKeepsake({ ...props.keepsake, payment_id: id })
    paymentStore.reset()
    await download()
  } catch {
    paymentStore.setError(t('errors.payment_refused'))
  }
}

async function download() {
  if (!paymentId.value) return
  failed.value = false
  if (!pdf) {
    preparing.value = true
    try {
      pdf = await $fetch<Blob>('/api/keepsake', {
        method: 'POST',
        body: { paymentIntentId: paymentId.value, keepsake: props.keepsake },
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

/** En local seulement : le PDF sans payer, pour voir à quoi il ressemble. */
const canPreview = isLocal()

async function preview() {
  failed.value = false
  preparing.value = true
  try {
    const blob = await $fetch<Blob>('/api/admin/keepsake-preview', {
      method: 'POST',
      body: { keepsake: props.keepsake },
      responseType: 'blob',
    })
    await saveFile(blob, filename.value)
  } catch {
    failed.value = true
  } finally {
    preparing.value = false
  }
}
</script>

<template>
  <div class="keepsake">
    <!-- Payé : il ne reste qu'à le prendre, autant de fois qu'il faut. -->
    <template v-if="paymentId">
      <button type="button" class="cta" :disabled="preparing" @click="download">
        {{ preparing ? t('keepsake.preparing') : t('keepsake.download') }}
      </button>
      <p v-if="failed" class="text-red-400/80 text-xs text-center mt-3">{{ t('keepsake.failed') }}</p>
    </template>

    <button v-else-if="!open" type="button" class="cta" @click="openForm">
      {{ t('keepsake.cta', { price }) }}
    </button>

    <div v-else class="space-y-4">
      <p class="text-ink-200/85 text-[13px] leading-relaxed text-center">{{ t('keepsake.pitch') }}</p>
      <p class="neon-text font-display text-2xl tracking-[0.04em] text-center">{{ price }}</p>
      <div v-if="initializing" class="h-12 flex items-center justify-center">
        <p class="text-steel-400 text-xs">{{ t('paywall.loading') }}</p>
      </div>
      <div id="keepsake-card" />
      <p v-if="paymentStore.errorMessage" class="text-red-400/80 text-xs text-center">
        {{ paymentStore.errorMessage }}
      </p>
      <GlowButton
        :loading="paymentStore.status === 'processing'"
        :disabled="initializing"
        class="w-full"
        @click="pay"
      >
        {{ t('keepsake.pay') }}
      </GlowButton>
      <button
        v-if="canPreview"
        type="button"
        class="block mx-auto text-steel-400 hover:text-neon-300 underline underline-offset-4 text-[11px]"
        :disabled="preparing"
        @click="preview"
      >
        {{ preparing ? t('keepsake.preparing') : 'Voir le PDF sans payer (local)' }}
      </button>
      <p v-if="failed && !paymentId" class="text-red-400/80 text-xs text-center">{{ t('keepsake.failed') }}</p>
      <!-- Contenu numérique livré tout de suite : la renonciation doit précéder le paiement (L221-28 13°). -->
      <p class="text-steel-400 text-[11px] leading-relaxed text-center">
        {{ t('keepsake.withdrawal') }}
        <a href="/mentions-legales#vente" target="_blank" rel="noopener" class="underline underline-offset-2 hover:text-neon-300">{{ t('legal.link') }}</a>
      </p>
    </div>
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

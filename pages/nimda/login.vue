<script setup lang="ts">
/**
 * Le mot de passe des pages d'admin ouvertes en production
 * (utils/admin-access.ts). En local, la page renvoie directement.
 */
import { PROD_ADMIN_PAGES, safeNext } from '~/utils/admin-access'

definePageMeta({ middleware: 'admin' })
useHead({ meta: [{ name: 'robots', content: 'noindex' }] })

const route = useRoute()
const password = ref('')
const error = ref<string | null>(null)
const pending = ref(false)

const LABELS: Record<string, string> = {
  '/nimda/monitor': 'Monitor',
  '/nimda/monitorpaiement': 'Paiements',
  '/nimda/socials': 'Réseaux',
  '/nimda/instagram': 'Instagram',
}

async function login() {
  error.value = null
  pending.value = true
  try {
    await $fetch('/api/nimda/login', { method: 'POST', body: { password: password.value } })
    // Une vraie navigation : la page suivante passe par le garde serveur avec le cookie.
    window.location.href = safeNext(route.query.next)
  } catch {
    error.value = 'Mot de passe incorrect'
    password.value = ''
  } finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="min-h-[100dvh] px-5 py-10 sm:px-8">
    <div class="mx-auto w-full max-w-sm space-y-10">
      <header class="space-y-4">
        <p class="font-display text-[10px] uppercase tracking-[0.4em] text-neon-400/80">Admin</p>
        <h1 class="neon-text font-display uppercase text-2xl sm:text-3xl tracking-[0.05em]">Accès</h1>
        <div class="neon-rule w-32" />
      </header>

      <form class="space-y-4" @submit.prevent="login">
        <input
          v-model="password"
          type="password"
          inputmode="numeric"
          placeholder="Mot de passe"
          autocomplete="current-password"
          autofocus
          required
          class="w-full bg-ink-800/50 border-0 border-b border-steel-600 focus:border-neon-400 px-3 py-2 text-ink-100 text-[13px] outline-none"
        >
        <GlowButton type="submit" class="w-full" :disabled="pending">Entrer</GlowButton>
        <p v-if="error" class="text-red-400/80 text-xs">{{ error }}</p>
      </form>

      <nav class="flex flex-wrap gap-4 text-xs text-ink-200/70">
        <NuxtLink v-for="p in PROD_ADMIN_PAGES" :key="p" :to="p" external class="hover:text-neon-300">
          {{ LABELS[p] ?? p }}
        </NuxtLink>
      </nav>
    </div>
  </div>
</template>

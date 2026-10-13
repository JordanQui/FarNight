<script setup lang="ts">
/**
 * Le code d'invitation d'un influenceur.
 *
 * On tape son e-mail, la page rend le code à lui envoyer. Il entrera les deux
 * sous le lien « Code » du paywall, à la place de la carte. Le code est
 * calculé, pas stocké : la même adresse redonne toujours le même.
 */
definePageMeta({ middleware: 'admin' })

const email = ref('')
const result = ref<{ email: string; code: string } | null>(null)
const error = ref<string | null>(null)
const copied = ref(false)

async function encrypt() {
  error.value = null
  copied.value = false
  try {
    result.value = await $fetch('/api/admin/encrypt', { method: 'POST', body: { email: email.value } })
  } catch (err) {
    result.value = null
    error.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage ?? 'Échec'
  }
}

async function copy() {
  if (!result.value) return
  await navigator.clipboard.writeText(result.value.code)
  copied.value = true
}
</script>

<template>
  <div class="min-h-[100dvh] px-5 py-10 sm:px-8">
    <div class="mx-auto w-full max-w-xl space-y-10">
      <header class="space-y-4">
        <p class="font-display text-[10px] uppercase tracking-[0.4em] text-neon-400/80">Admin — influenceurs</p>
        <h1 class="neon-text font-display uppercase text-2xl sm:text-3xl tracking-[0.05em]">Code d’invitation</h1>
        <div class="neon-rule w-32" />
        <p class="text-ink-200/85 text-sm leading-relaxed">
          L’e-mail de l’influenceur donne son code. Il entrera les deux sous le lien « Code » du paiement,
          et sa nuit s’ouvrira sans carte. Le code n’est valable en ligne que si le
          <code class="text-neon-300">NUXT_SECRET</code> local est celui de la production.
        </p>
      </header>

      <form class="space-y-4" @submit.prevent="encrypt">
        <input
          v-model="email"
          type="email"
          placeholder="@"
          autocomplete="off"
          required
          class="w-full bg-ink-800/50 border-0 border-b border-steel-600 focus:border-neon-400 px-3 py-2 text-ink-100 text-[13px] outline-none"
        >
        <GlowButton type="submit" class="w-full">Générer</GlowButton>
        <p v-if="error" class="text-red-400/80 text-xs">{{ error }}</p>
      </form>

      <section v-if="result" class="space-y-3 border-y border-steel-600/40 py-6 text-center">
        <p class="text-steel-400 text-xs">{{ result.email }}</p>
        <p class="neon-text font-display text-3xl tracking-[0.3em] select-all">{{ result.code }}</p>
        <button
          type="button"
          class="text-ink-300 hover:text-neon-300 text-xs underline underline-offset-4"
          @click="copy"
        >
          {{ copied ? 'Copié' : 'Copier' }}
        </button>
      </section>

      <nav class="flex gap-4 text-xs">
        <NuxtLink to="/" class="text-ink-300 hover:text-neon-300 hover:underline underline-offset-4">Retour au jeu</NuxtLink>
      </nav>
    </div>
  </div>
</template>

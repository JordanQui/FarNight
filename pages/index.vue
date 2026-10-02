<script setup lang="ts">
const { t } = useLang()

import { useGameStore } from '~/stores/game'
import { usePaymentStore } from '~/stores/payment'

const gameStore = useGameStore()
const paymentStore = usePaymentStore()

// Un joueur qui a déjà payé reprend sans repasser par le paywall. L'appel ne
// déclenche aucune génération : il ne fait que lire un cookie signé.
onMounted(async () => {
  try {
    const access = await $fetch<{
      active: boolean
      expiresAt?: number
      lock: { until: number; reason: 'stalled' | 'completed' | 'asleep'; text?: string } | null
      resume: { sceneId: string; index: number } | null
    }>('/api/access')
    paymentStore.setAccess(access.active, access.expiresAt ?? null)

    // Où il en était. Le serveur ne la renvoie que si la reprise est permise —
    // l'accueil n'a donc rien à vérifier, il propose ou il ne propose pas.
    gameStore.setResumePoint(access.resume?.sceneId ?? null)

    // La ville est fermée : on n'ouvre même pas l'écran de connexion. Toute
    // requête coûteuse serait refusée en 423 de toute façon, et l'adieu doit
    // revenir tel quel — au rechargement, dans un autre onglet, le lendemain.
    if (access.lock) gameStore.closeCity(access.lock)
  } catch {
    // Sans réponse, on reste sur le parcours payant : jamais l'inverse.
  } finally {
    /**
     * L'accueil n'ouvre qu'APRÈS la réponse.
     *
     * Il ouvrait avant, et la ville fermée laissait donc une poignée de
     * secondes où l'on pouvait lancer une partie qui serait refusée en 423.
     * L'appel ne génère rien — il lit un cookie signé —, l'attente est celle
     * d'un aller-retour. `setScreen` refuse de son côté de quitter l'écran de
     * fermeture : si le verrou tient, cette ligne ne fait rien.
     */
    if (gameStore.currentScreen === 'init') gameStore.setScreen('login')
  }
})
</script>

<template>
  <div class="min-h-[100dvh] bg-ink-900">
    <Transition name="screen" mode="out-in">
      <LoginScreen v-if="gameStore.currentScreen === 'login'" key="login" />
      <AdmissionScreen v-else-if="gameStore.currentScreen === 'admission'" key="admission" />
      <SceneBuildScreen v-else-if="gameStore.currentScreen === 'scene_build_loading'" key="scene-build" />
      <GameShell v-else-if="gameStore.currentScreen === 'playing'" key="game" />
      <PaywallScreen v-else-if="gameStore.currentScreen === 'paywall'" key="paywall" />
      <EndingScreen v-else-if="gameStore.currentScreen === 'ending'" key="ending" />
      <LockedScreen v-else-if="gameStore.currentScreen === 'locked'" key="locked" />
      <LoadingScreen v-else-if="gameStore.currentScreen === 'payment_processing'" key="pay" :message="t('paywall.processing')" />
      <PaymentSuccessScreen v-else-if="gameStore.currentScreen === 'payment_success'" key="success" />
      <LoadingScreen v-else key="init" />
    </Transition>
  </div>
</template>

<style>
.screen-enter-active, .screen-leave-active { transition: opacity 0.5s ease; }
.screen-enter-from, .screen-leave-to { opacity: 0; }
</style>

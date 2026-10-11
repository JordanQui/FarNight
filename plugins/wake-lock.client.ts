import { useGameStore } from '~/stores/game'

/**
 * Garde l'écran allumé pendant les chargements.
 *
 * Une scène met plusieurs dizaines de secondes à s'écrire puis à se peindre ;
 * le téléphone, sans geste du joueur, s'éteint entre-temps — et un onglet en
 * arrière-plan peut voir ses requêtes suspendues. On demande donc un verrou
 * d'écran (Screen Wake Lock) tant qu'un chargement est en cours, et on le rend
 * dès qu'il finit : le reste du temps, la veille reste celle du téléphone.
 *
 * Le navigateur relâche le verrou de lui-même quand la page est masquée ; on le
 * redemande au retour si le chargement court toujours.
 */
export default defineNuxtPlugin(() => {
  if (!('wakeLock' in navigator)) return

  const gameStore = useGameStore()
  let sentinel: WakeLockSentinel | null = null

  const loading = () =>
    gameStore.currentScreen === 'init'
    || gameStore.currentScreen === 'scene_build_loading'
    || gameStore.currentScreen === 'payment_processing'
    || gameStore.sceneImageLoading

  const sync = async () => {
    if (loading() && document.visibilityState === 'visible') {
      if (sentinel && !sentinel.released) return
      try {
        sentinel = await navigator.wakeLock.request('screen')
      } catch {
        // Refusé (batterie faible, politique du navigateur) : la veille reprend
        // ses droits, le chargement continue quand même.
        sentinel = null
      }
    } else if (sentinel) {
      const s = sentinel
      sentinel = null
      void s.release().catch(() => {})
    }
  }

  watch(loading, () => void sync(), { immediate: true })
  document.addEventListener('visibilitychange', () => void sync())
})

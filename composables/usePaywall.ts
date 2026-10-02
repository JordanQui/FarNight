import { useGameStore } from '~/stores/game'
import { usePlayerStore } from '~/stores/player'
import { usePaymentStore } from '~/stores/payment'

declare global {
  interface Window {
    Square: {
      payments(applicationId: string, locationId: string): Promise<{
        card(options?: { style?: Record<string, Record<string, string>> }): Promise<{
          attach(selector: string): Promise<void>
          tokenize(): Promise<{ status: string; token?: string; errors?: Array<{ message: string }> }>
        }>
      }>
    }
  }
}

export function usePaywall() {
  const { t } = useLang()
  const gameStore = useGameStore()
  const playerStore = usePlayerStore()
  const paymentStore = usePaymentStore()
  const progression = useProgression()
  const config = useRuntimeConfig()

  let squareCard: Awaited<ReturnType<Awaited<ReturnType<typeof window.Square.payments>>['card']>> | null = null

  /**
   * Ouvre la sortie. Un joueur qui a déjà payé passe directement à la suite :
   * le droit d'accès dure un mois, on ne lui repropose pas le paiement.
   *
   * `force` est réservé au canal '#' : le raccourci existe justement pour
   * atteindre la porte sans avoir joué les tours qui y mènent.
   */
  function openExit(options: { force?: boolean } = {}) {
    // Garde-fou : on ne quitte pas une scène dont l'objectif n'est pas rempli.
    // Le deck écarte déjà la sortie tant que l'objet manque, mais rien
    // n'empêchait un autre chemin — un bouton — d'avancer sans.
    if (!options.force && !objectiveMet()) return

    // Le raccourci vient VOIR la porte. Il passait par le même aiguillage que
    // la sortie jouée : un cookie d'accès resté d'un paiement de test, ou une
    // scène qui n'est pas la porte, le faisaient filer à la scène suivante —
    // une génération payée, et pas d'écran de paiement.
    if (options.force) {
      gameStore.triggerPaywall()
      return
    }

    // Seule la scène-porte demande le paiement. Ailleurs, franchir la sortie
    // fait simplement passer à la suite — sans quoi chaque scène renverrait à
    // l'écran de succès puis à elle-même, en boucle.
    const isGate = playerStore.scene?.is_paywall_gate === true
    if (!isGate || paymentStore.hasAccess) {
      if (progression.advance()) return
      // Plus rien après : on laisse l'écran de succès, qui conclut.
      gameStore.setScreen('payment_success')
      return
    }
    gameStore.triggerPaywall()
  }

  /**
   * L'objectif de la scène est-il rempli ?
   *
   * Une scène se quitte quand on a ce qu'on était venu y chercher. Une scène
   * sans objet-clé — s'il en existe — n'a rien à exiger.
   */
  function objectiveMet(): boolean {
    if (!playerStore.scene?.key_item) return true
    return gameStore.hasKeyItem
  }

  async function initSquarePayments(containerSelector: string) {
    if (!window.Square) await loadSquareSdk()

    const payments = await window.Square.payments(
      config.public.squareApplicationId,
      config.public.squareLocationId
    )
    // Le formulaire vit dans une iframe Square : il ne voit pas nos classes, et
    // se dessine blanc par défaut. On lui passe donc les couleurs de
    // l'interface en dur, lues au moment de l'ouvrir. Si Square refuse un
    // style, on garde son formulaire nu plutôt que pas de formulaire du tout.
    try {
      squareCard = await payments.card({ style: squareCardStyle(containerSelector) })
    } catch {
      squareCard = await payments.card()
    }
    await squareCard.attach(containerSelector)
  }

  /** Le formulaire fondu dans l'écran : fond d'encre, filet discret, aucun néon. */
  function squareCardStyle(containerSelector: string) {
    const el = document.querySelector(containerSelector) ?? document.documentElement
    const css = getComputedStyle(el)
    const hex = (name: string, fallback: string) => {
      const rgb = css.getPropertyValue(name).trim().split(/\s+/).map(Number)
      if (rgb.length !== 3 || rgb.some(n => Number.isNaN(n))) return fallback
      return '#' + rgb.map(n => n.toString(16).padStart(2, '0')).join('')
    }
    const ground = hex('--ink-900', '#080b12')
    const line = hex('--steel-600', '#333d53')
    const muted = hex('--steel-400', '#6b7794')
    const text = hex('--ink-100', '#dce1ea')
    const error = '#f87171'
    return {
      '.input-container': { borderColor: line, borderRadius: '0px', borderWidth: '1px' },
      '.input-container.is-focus': { borderColor: muted },
      '.input-container.is-error': { borderColor: error },
      input: { backgroundColor: ground, color: text },
      'input::placeholder': { color: muted },
      '.message-text': { color: muted },
      '.message-icon': { color: muted },
      '.message-text.is-error': { color: error },
      '.message-icon.is-error': { color: error },
    }
  }

  function loadSquareSdk(): Promise<void> {
    return new Promise((resolve) => {
      if (window.Square) { resolve(); return }
      const src = config.public.squareEnvironment === 'production'
        ? 'https://web.squarecdn.com/v1/square.js'
        : 'https://sandbox.web.squarecdn.com/v1/square.js'
      const script = document.createElement('script')
      script.src = src
      script.onload = () => resolve()
      document.head.appendChild(script)
    })
  }

  async function fetchPaymentIntent() {
    const data = await $fetch<{
      paymentLinkId: string
      url: string
      applicationId: string
      locationId: string
    }>('/api/payment/intent', { method: 'POST', body: {} })

    paymentStore.setIntent({
      paymentId: data.paymentLinkId,
      applicationId: data.applicationId,
      locationId: data.locationId,
    })
    return data
  }

  async function submitPayment() {
    if (!squareCard) {
      paymentStore.setError(t('errors.payment_form'))
      return false
    }

    paymentStore.setProcessing()
    gameStore.setScreen('payment_processing')

    const result = await squareCard.tokenize()
    if (result.status !== 'OK' || !result.token) {
      paymentStore.setError(result.errors?.[0]?.message ?? t('errors.tokenize'))
      gameStore.setScreen('paywall')
      return false
    }

    try {
      const confirmed = await $fetch<{ expiresAt?: number }>('/api/payment/confirm', {
        method: 'POST',
        body: { sourceId: result.token },
      })
      paymentStore.setSuccess(confirmed?.expiresAt ?? null)
      gameStore.setScreen('payment_success')
      return true
    } catch (err) {
      paymentStore.setError(err instanceof Error ? err.message : t('errors.payment_refused'))
      gameStore.setScreen('paywall')
      return false
    }
  }

  // Les prédicats de sortie — « il en parle », « il est trop tôt », « l'objet
  // manque » — vivent désormais dans les qualités du deck : ils s'y lisent
  // dans l'ordre où ils se jouent. Ne reste ici que l'ouverture elle-même.
  return { objectiveMet, openExit, initSquarePayments, fetchPaymentIntent, submitPayment }
}

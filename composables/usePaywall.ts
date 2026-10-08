import { useGameStore } from '~/stores/game'
import { usePlayerStore } from '~/stores/player'
import { usePaymentStore } from '~/stores/payment'

type StripeElements = {
  create(type: 'payment', options?: Record<string, unknown>): { mount(selector: string): void }
}

declare global {
  interface Window {
    Stripe: (publishableKey: string) => {
      elements(options: { clientSecret: string; appearance?: Record<string, unknown> }): StripeElements
      confirmPayment(options: { elements: StripeElements; redirect: 'if_required' }): Promise<{
        error?: { message?: string }
        paymentIntent?: { id: string; status: string }
      }>
    }
  }
}

type PaymentIntentConfig = { publishableKey: string; paymentIntentId: string; clientSecret: string }

export function usePaywall() {
  const { t } = useLang()
  const gameStore = useGameStore()
  const playerStore = usePlayerStore()
  const paymentStore = usePaymentStore()
  const progression = useProgression()

  // Le client Stripe et le formulaire monté, qui confirmeront le paiement.
  let stripe: ReturnType<Window['Stripe']> | null = null
  let elements: StripeElements | null = null

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

  async function initPayments(containerSelector: string, intent: PaymentIntentConfig) {
    if (!window.Stripe) await loadStripeSdk()

    stripe = window.Stripe(intent.publishableKey)
    // Le Payment Element montre ce que l'appareil sait payer : carte, Google
    // Pay, Link… Apple Pay est coupé tant que le domaine n'est pas enregistré.
    // Il vit dans une iframe Stripe qui ne voit pas nos classes : on lui passe
    // les couleurs de l'interface en dur, lues au moment de l'ouvrir.
    elements = stripe.elements({ clientSecret: intent.clientSecret, appearance: stripeAppearance(containerSelector) })
    elements.create('payment', { wallets: { applePay: 'never' } }).mount(containerSelector)
  }

  /** Le formulaire fondu dans l'écran : fond d'encre, filet discret, aucun néon. */
  function stripeAppearance(containerSelector: string) {
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
    return {
      theme: 'night',
      variables: {
        colorBackground: ground,
        colorText: text,
        colorTextSecondary: muted,
        colorTextPlaceholder: muted,
        colorPrimary: text,
        colorDanger: '#f87171',
        borderRadius: '0px',
      },
      rules: {
        '.Input': { borderColor: line, boxShadow: 'none' },
        '.Input:focus': { borderColor: muted, boxShadow: 'none' },
        '.Tab': { borderColor: line, boxShadow: 'none' },
      },
    }
  }

  function loadStripeSdk(): Promise<void> {
    return new Promise((resolve) => {
      if (window.Stripe) { resolve(); return }
      const script = document.createElement('script')
      script.src = 'https://js.stripe.com/v3/'
      script.onload = () => resolve()
      document.head.appendChild(script)
    })
  }

  async function fetchPaymentIntent() {
    const data = await $fetch<PaymentIntentConfig>('/api/payment/intent', { method: 'POST', body: {} })
    paymentStore.setIntent({ paymentId: data.paymentIntentId })
    return data
  }

  async function submitPayment() {
    if (!stripe || !elements) {
      paymentStore.setError(t('errors.payment_form'))
      return false
    }

    // On reste sur l'écran : le bouton tourne. Passer par un écran de
    // traitement démontait le paywall, et à son retour l'erreur était effacée.
    paymentStore.setProcessing()

    try {
      // Stripe débite, 3-D Secure compris s'il le faut, sans quitter la page.
      const result = await stripe.confirmPayment({ elements, redirect: 'if_required' })
      if (result.error || !result.paymentIntent) {
        paymentStore.setError(result.error?.message ?? t('errors.payment_refused'))
        return false
      }
      const confirmed = await $fetch<{ expiresAt?: number }>('/api/payment/confirm', {
        method: 'POST',
        body: { paymentIntentId: result.paymentIntent.id },
      })
      paymentStore.setSuccess(confirmed?.expiresAt ?? null)
      gameStore.setScreen('payment_success')
      return true
    } catch (err) {
      const reason = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
      paymentStore.setError(reason ?? t('errors.payment_refused'))
      return false
    }
  }

  // Les prédicats de sortie — « il en parle », « il est trop tôt », « l'objet
  // manque » — vivent désormais dans les qualités du deck : ils s'y lisent
  // dans l'ordre où ils se jouent. Ne reste ici que l'ouverture elle-même.
  return { objectiveMet, openExit, initPayments, fetchPaymentIntent, submitPayment }
}

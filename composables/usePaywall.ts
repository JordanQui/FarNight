import { useGameStore } from '~/stores/game'
import { usePlayerStore } from '~/stores/player'
import { usePaymentStore } from '~/stores/payment'

type StripeCard = { mount(selector: string): void }

declare global {
  interface Window {
    Stripe: (publishableKey: string) => {
      elements(): { create(type: 'card', options?: Record<string, unknown>): StripeCard }
      confirmCardPayment(clientSecret: string, data: { payment_method: { card: StripeCard } }): Promise<{
        error?: { message?: string }
        paymentIntent?: { id: string; status: string }
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

  // Le formulaire monté, le client Stripe qui le confirmera, et le paiement visé.
  let stripe: ReturnType<Window['Stripe']> | null = null
  let card: StripeCard | null = null
  let secret: string | null = null

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

  async function initPayments(containerSelector: string, clientSecret: string) {
    if (!window.Stripe) await loadStripeSdk()

    stripe = window.Stripe(config.public.stripePublishableKey)
    secret = clientSecret
    // Le champ « carte » seul : ni Apple Pay, ni Google Pay, ni Link. Il vit
    // dans une iframe Stripe qui ne voit pas nos classes : on lui passe les
    // couleurs de l'interface en dur, lues au moment de l'ouvrir.
    card = stripe.elements().create('card', { style: stripeCardStyle(containerSelector), hidePostalCode: true })
    card.mount(containerSelector)
  }

  /** Le formulaire fondu dans l'écran : fond d'encre, filet discret, aucun néon. */
  function stripeCardStyle(containerSelector: string) {
    const el = document.querySelector(containerSelector) ?? document.documentElement
    const css = getComputedStyle(el)
    const hex = (name: string, fallback: string) => {
      const rgb = css.getPropertyValue(name).trim().split(/\s+/).map(Number)
      if (rgb.length !== 3 || rgb.some(n => Number.isNaN(n))) return fallback
      return '#' + rgb.map(n => n.toString(16).padStart(2, '0')).join('')
    }
    const muted = hex('--steel-400', '#6b7794')
    const text = hex('--ink-100', '#dce1ea')
    return {
      base: { color: text, iconColor: muted, fontSize: '16px', '::placeholder': { color: muted } },
      invalid: { color: '#f87171', iconColor: '#f87171' },
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
    const data = await $fetch<{
      paymentIntentId: string
      clientSecret: string
    }>('/api/payment/intent', { method: 'POST', body: {} })

    paymentStore.setIntent({ paymentId: data.paymentIntentId })
    return data
  }

  async function submitPayment() {
    if (!stripe || !card || !secret) {
      paymentStore.setError(t('errors.payment_form'))
      return false
    }

    // On reste sur l'écran : le bouton tourne. Passer par un écran de
    // traitement démontait le paywall, et à son retour l'erreur était effacée.
    paymentStore.setProcessing()

    try {
      // Stripe débite, 3-D Secure compris s'il le faut, sans quitter la page.
      const result = await stripe.confirmCardPayment(secret, { payment_method: { card } })
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

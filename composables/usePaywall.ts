import { useGameStore } from '~/stores/game'
import { usePlayerStore } from '~/stores/player'
import { usePaymentStore } from '~/stores/payment'

type SquareTokenizer = {
  attach?(selector: string, options?: Record<string, string>): Promise<void>
  tokenize(verificationDetails?: Record<string, unknown>): Promise<{ status: string; token?: string; errors?: Array<{ message: string }> }>
}

declare global {
  interface Window {
    Square: {
      payments(applicationId: string, locationId: string): Promise<{
        card(options?: { style?: Record<string, Record<string, string>> }): Promise<SquareTokenizer>
        paymentRequest(options: Record<string, unknown>): unknown
        applePay(request: unknown): Promise<SquareTokenizer>
        googlePay(request: unknown): Promise<SquareTokenizer>
      }>
    }
  }
}

export type PaymentMethod = 'card' | 'applePay' | 'googlePay'

type SquareConfig = { applicationId: string; locationId: string; environment: string }

export function usePaywall() {
  const { t } = useLang()
  const gameStore = useGameStore()
  const playerStore = usePlayerStore()
  const paymentStore = usePaymentStore()
  const progression = useProgression()

  // Un tokenizer par moyen de paiement que Square a accepté d'ouvrir ici.
  const tokenizers: Partial<Record<PaymentMethod, SquareTokenizer>> = {}
  let squareConfig: SquareConfig | null = null
  // Montant du débit, pour la vérification 3-D Secure de la carte.
  let charge: { amountCents: number; currency: string } | null = null

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

  async function initSquarePayments(
    containerSelector: string,
    wallet?: { amountCents: number; currency: string; label: string; googlePaySelector: string },
  ) {
    // Identifiant, location et environnement viennent du serveur, à
    // l'exécution — comme dans ronde_v2. Bakés au build, ils pouvaient ne plus
    // correspondre au jeton : la carte se tokenisait, le débit répondait 400.
    const square = squareConfig ?? await fetchPaymentIntent()
    if (!window.Square) await loadSquareSdk(square.environment)

    const payments = await window.Square.payments(square.applicationId, square.locationId)
    // Le formulaire vit dans une iframe Square : il ne voit pas nos classes, et
    // se dessine blanc par défaut. On lui passe donc les couleurs de
    // l'interface en dur, lues au moment de l'ouvrir. Si Square refuse un
    // style, on garde son formulaire nu plutôt que pas de formulaire du tout.
    try {
      tokenizers.card = await payments.card({ style: squareCardStyle(containerSelector) })
    } catch {
      tokenizers.card = await payments.card()
    }
    await tokenizers.card.attach!(containerSelector)

    // Portefeuilles : Square refuse de les ouvrir quand le navigateur, l'appareil
    // ou le pays ne s'y prêtent pas (Apple Pay hors Safari, domaine non vérifié…).
    // Un refus n'est pas une erreur : il reste la carte.
    if (wallet) {
      charge = { amountCents: wallet.amountCents, currency: wallet.currency }
      const request = () => payments.paymentRequest({
        countryCode: wallet.currency === 'USD' ? 'US' : 'FR',
        currencyCode: wallet.currency,
        total: { amount: (wallet.amountCents / 100).toFixed(2), label: wallet.label },
      })
      try {
        tokenizers.applePay = await payments.applePay(request())
      } catch { /* indisponible ici */ }
      try {
        const googlePay = await payments.googlePay(request())
        await googlePay.attach!(wallet.googlePaySelector, { buttonColor: 'white', buttonSizeMode: 'fill', buttonType: 'long' })
        tokenizers.googlePay = googlePay
      } catch { /* indisponible ici */ }
    }

    return { applePay: !!tokenizers.applePay, googlePay: !!tokenizers.googlePay }
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

  function loadSquareSdk(environment: string): Promise<void> {
    return new Promise((resolve) => {
      if (window.Square) { resolve(); return }
      const src = environment === 'production'
        ? 'https://web.squarecdn.com/v1/square.js'
        : 'https://sandbox.web.squarecdn.com/v1/square.js'
      const script = document.createElement('script')
      script.src = src
      script.onload = () => resolve()
      document.head.appendChild(script)
    })
  }

  async function fetchPaymentIntent() {
    const data = await $fetch<SquareConfig>('/api/payment/intent', { method: 'POST', body: {} })

    paymentStore.setIntent({
      paymentId: null,
      applicationId: data.applicationId,
      locationId: data.locationId,
    })
    squareConfig = data
    return data
  }

  async function submitPayment(method: PaymentMethod = 'card') {
    const tokenizer = tokenizers[method]
    if (!tokenizer) {
      paymentStore.setError(t('errors.payment_form'))
      return false
    }

    // Tokeniser AVANT de quitter l'écran : Apple Pay et Google Pay ouvrent leur
    // feuille depuis le bouton cliqué, et l'écran de traitement la démonterait.
    // La carte passe par 3-D Secure : en Europe, sans elle, la banque refuse
    // la plupart des débits (CARD_DECLINED_VERIFICATION_REQUIRED). Square ne
    // lance le défi que si la banque l'exige, et le jeton le porte ensuite —
    // rien à ajouter au débit. Les portefeuilles s'authentifient eux-mêmes.
    const verification = method === 'card' && charge
      ? {
          amount: (charge.amountCents / 100).toFixed(2),
          currencyCode: charge.currency,
          intent: 'CHARGE',
          billingContact: {},
          customerInitiated: true,
          sellerKeyedIn: false,
        }
      : undefined
    const result = await tokenizer.tokenize(verification)
    if (result.status !== 'OK' || !result.token) {
      paymentStore.setError(result.errors?.[0]?.message ?? t('errors.tokenize'))
      return false
    }

    // On reste sur l'écran : le bouton tourne. Passer par un écran de
    // traitement démontait le paywall, et à son retour l'erreur était effacée.
    paymentStore.setProcessing()

    try {
      const confirmed = await $fetch<{ expiresAt?: number }>('/api/payment/confirm', {
        method: 'POST',
        body: { sourceId: result.token },
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
  return { objectiveMet, openExit, initSquarePayments, fetchPaymentIntent, submitPayment }
}

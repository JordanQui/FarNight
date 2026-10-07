import { defineStore } from 'pinia'

export type PaymentStatus = 'idle' | 'pending' | 'processing' | 'success' | 'error'

export const usePaymentStore = defineStore('payment', {
  state: () => ({
    status: 'idle' as PaymentStatus,
    paymentId: null as string | null,
    applicationId: null as string | null,
    locationId: null as string | null,
    errorMessage: null as string | null,
    /** Droit d'accès en cours, ouvert par un paiement passé. */
    hasAccess: false,
    accessExpiresAt: null as number | null,
  }),

  actions: {
    setIntent(data: { paymentId: string; applicationId: string; locationId: string }) {
      this.paymentId = data.paymentId
      this.applicationId = data.applicationId
      this.locationId = data.locationId
      this.status = 'pending'
      this.errorMessage = null
    },
    setAccess(active: boolean, expiresAt: number | null = null) {
      this.hasAccess = active
      this.accessExpiresAt = expiresAt
    },
    setProcessing() {
      this.status = 'processing'
      this.errorMessage = null
    },
    setSuccess(expiresAt: number | null = null) {
      this.status = 'success'
      this.errorMessage = null
      this.hasAccess = true
      this.accessExpiresAt = expiresAt
    },
    setError(message: string) {
      this.status = 'error'
      this.errorMessage = message
    },
    reset() {
      this.status = 'idle'
      this.paymentId = null
      this.errorMessage = null
    },
  },
})

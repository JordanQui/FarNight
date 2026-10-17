/**
 * Les crédits API X pour /nimda/socials : solde, part achetée, part offerte.
 * Lecture seule ; on recharge dans la console développeur, X n'a pas d'API
 * pour payer. Voir server/socials/x.ts.
 */
import { xCredits } from '../../../socials/x'

export default defineEventHandler(() => xCredits())

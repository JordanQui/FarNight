/**
 * Les derniers posts X du compte et leurs promotions, pour /nimda/socials.
 * Lecture seule, par l'Ads API ; sans ses identifiants au .env, la liste de
 * ce qui manque. Voir server/socials/x-ads.ts.
 */
import { xBoard } from '../../../socials/x-ads'

export default defineEventHandler(() => xBoard())

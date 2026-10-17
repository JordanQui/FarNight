/**
 * La caisse du compte pub Meta pour /nimda/socials : carte, dépensé, dû,
 * plafond, reste et budgets engagés. Lecture seule ; le plafond se fixe par
 * ads.post.ts. Voir server/socials/ads.ts.
 */
import { wallet } from '../../../socials/ads'

export default defineEventHandler(() => wallet())

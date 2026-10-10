import { FORMATS } from '~/utils/instagram-crop'

/**
 * Tous les posts de l'atelier, et ce que la page doit savoir pour les peindre.
 * L'accès est fermé par server/middleware/admin-guard.ts.
 */
export default defineEventHandler(async () => ({
  posts: await loadPosts(),
  formats: FORMATS,
  palette: IG_PALETTE,
}))

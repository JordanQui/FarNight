import { isLocal } from '~/utils/app-env'
import { hasAdminSession } from '~/server/utils/admin-session'

/** Pour le middleware client : la session ne se lit pas depuis le navigateur. */
export default defineEventHandler(event => ({ ok: isLocal() || hasAdminSession(event) }))

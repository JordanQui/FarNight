import { closeAdminSession } from '~/server/utils/admin-session'

export default defineEventHandler((event) => {
  closeAdminSession(event)
  return { ok: true }
})

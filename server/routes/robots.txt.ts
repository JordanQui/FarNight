/**
 * Servi plutôt que posé dans `public/` : le lien vers le plan du site doit
 * porter le domaine réellement servi, et il change entre une préproduction
 * Vercel et le domaine définitif.
 */

/** Robots qui collectent pour entraîner des modèles ; les moteurs de recherche n'y sont pas. */
const AI_TRAINING_BOTS = [
  'GPTBot', 'ClaudeBot', 'anthropic-ai', 'CCBot', 'Google-Extended',
  'Applebot-Extended', 'Bytespider', 'meta-externalagent',
]

export default defineEventHandler((event) => {
  const { origin } = getRequestURL(event, { xForwardedHost: true })
  setHeader(event, 'content-type', 'text/plain; charset=utf-8')

  // L'administration est protégée côté serveur ; elle n'a en plus rien à faire
  // dans un index. Les robots d'entraînement d'IA sont refusés partout : c'est
  // l'opposition à la fouille que portent les mentions légales, lisible par machine.
  return [
    ...AI_TRAINING_BOTS.flatMap(bot => [`User-agent: ${bot}`, 'Disallow: /', '']),
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    '',
    `Sitemap: ${origin}/sitemap.xml`,
    '',
  ].join('\n')
})

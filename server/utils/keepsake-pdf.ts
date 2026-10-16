import puppeteer from 'puppeteer-core'
import chromium from '@sparticuz/chromium-min'
import type { LangCode } from '~/types/i18n'
import type { Keepsake } from '~/utils/keepsake'
import { interfaceVariables } from '~/utils/ui-theme'
import { dirOf, pack, translate } from '~/utils/languages'

/**
 * Le PDF de la nuit, imprimé par un vrai Chrome.
 *
 * Une bibliothèque PDF en JavaScript aurait demandé une police embarquée par
 * écriture, et l'arabe y sort en lettres détachées. Chrome compose les quinze
 * langues comme il compose le jeu, avec les polices Noto servies par Google.
 */

/**
 * Sur Vercel, Chrome n'est pas dans la fonction : il pèserait sur le démarrage
 * de chaque route du jeu. Il se télécharge au premier PDF dans /tmp, où les
 * appels suivants le retrouvent. Le lien suit la version du paquet installé.
 */
const PACK_URL = 'https://github.com/Sparticuz/chromium/releases/download/v153.0.0/chromium-v153.0.0-pack.x64.tar'
const MAC_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

async function launch() {
  const local = process.env.CHROME_PATH || (process.platform === 'darwin' ? MAC_CHROME : '')
  if (local) return puppeteer.launch({ executablePath: local, headless: true })

  chromium.setGraphicsMode = false
  return puppeteer.launch({
    args: await puppeteer.defaultArgs({ args: chromium.args, headless: 'shell' }),
    executablePath: await chromium.executablePath(process.env.CHROMIUM_PACK_URL || PACK_URL),
    headless: 'shell',
  })
}

export async function renderKeepsakePdf(keepsake: Keepsake): Promise<Buffer> {
  const browser = await launch()
  try {
    const page = await browser.newPage()
    // Rien d'autre que les polices ne sort de la page : le contenu vient du
    // navigateur du joueur, il n'a pas à pouvoir appeler quoi que ce soit.
    await page.setRequestInterception(true)
    page.on('request', (req) => {
      const url = req.url()
      if (url.startsWith('data:') || /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(url)) void req.continue()
      else void req.abort()
    })
    // La feuille des polices bloque le chargement, leurs fichiers suivent : on
    // les attend aussi. Trop lentes, on imprime avec les polices de repli.
    await page.setContent(keepsakeHtml(keepsake), { waitUntil: 'load', timeout: 20_000 }).catch(() => {})
    await page.evaluate('document.fonts.ready').catch(() => {})
    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true })
    return Buffer.from(pdf)
  } finally {
    await browser.close()
  }
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Les polices de l'écriture jouée, en plus du latin et du cyrillique. */
const SCRIPT_FONTS: Partial<Record<LangCode, { families: string; serif: string; sans: string }>> = {
  ja: { families: 'Noto+Serif+JP:wght@400;600&family=Noto+Sans+JP:wght@400;500', serif: "'Noto Serif JP'", sans: "'Noto Sans JP'" },
  zh: { families: 'Noto+Serif+SC:wght@400;600&family=Noto+Sans+SC:wght@400;500', serif: "'Noto Serif SC'", sans: "'Noto Sans SC'" },
  ar: { families: 'Noto+Naskh+Arabic:wght@400;600&family=Noto+Sans+Arabic:wght@400;500', serif: "'Noto Naskh Arabic'", sans: "'Noto Sans Arabic'" },
}

export function keepsakeHtml(k: Keepsake): string {
  const t = (key: string) => esc(translate(k.lang, `keepsake.${key}`))
  const game = esc(translate(k.lang, 'seo.title').split(' — ')[0] ?? '')
  const extra = SCRIPT_FONTS[k.lang]
  const fonts = 'https://fonts.googleapis.com/css2?family=Jost:wght@400;500'
    + '&family=Noto+Serif:ital,wght@0,400;0,600;1,400&family=Noto+Sans:wght@400;500'
    + (extra ? `&family=${extra.families}` : '') + '&display=block'
  const vars = Object.entries(interfaceVariables(k.palette)).map(([n, v]) => `${n}: ${v};`).join(' ')

  const row = (label: string, value: string) =>
    `<div class="row"><dt>${t(label)}</dt><dd>${esc(value)}</dd></div>`

  const places = k.places.map((p, i) => `
    <article class="place">
      ${p.image ? `<img class="shot" src="${p.image}" alt="">` : ''}
      <p class="num">${String(i + 1).padStart(2, '0')}</p>
      <div>
        <h3>${esc(p.place)}</h3>
        ${p.title && p.title !== p.place ? `<p class="sub">${esc(p.title)}</p>` : ''}
        <dl>
          ${p.played ? row('played', p.played) : ''}
          ${p.who.length ? row('who', p.who.join(', ')) : ''}
          ${p.carried ? row('carried', p.carried) : ''}
          ${p.answer ? `<div class="row answer"><dt>${t('answer')}</dt><dd>${esc(p.answer)}</dd></div>` : ''}
        </dl>
      </div>
    </article>`).join('')

  const kept = [
    ...(k.augmentation ? [`<li><span class="tag">${t('augmentation')}</span>${esc(k.augmentation)}</li>`] : []),
    ...k.kept.map(name => `<li>${esc(name)}</li>`),
  ].join('')

  return `<!doctype html>
<html lang="${esc(pack(k.lang).tag)}" dir="${dirOf(k.lang)}">
<head>
<meta charset="utf-8">
<title>${game} — ${esc(k.title)}</title>
<link rel="stylesheet" href="${fonts}">
<style>
:root { ${vars}
  --display: 'Jost', ${extra ? `${extra.sans}, ` : ''}'Noto Sans', sans-serif;
  --body: 'Noto Serif', ${extra ? `${extra.serif}, ` : ''}serif; }
@page { size: A4; margin: 0; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: rgb(var(--ink-900)); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body { color: rgb(var(--ink-100)); font-family: var(--body); font-size: 10.5pt; line-height: 1.65; }

.cover { position: relative; height: 297mm; overflow: hidden; break-after: page; }
.cover img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.cover .veil { position: absolute; inset: 0;
  background: linear-gradient(180deg, rgb(var(--ink-900) / 0.35) 0%, rgb(var(--ink-900) / 0) 30%,
    rgb(var(--ink-900) / 0.25) 55%, rgb(var(--ink-900) / 0.96) 85%); }
.cover .text { position: absolute; left: 18mm; right: 18mm; bottom: 22mm; }
.eyebrow { font-family: var(--display); text-transform: uppercase; letter-spacing: 0.32em;
  font-size: 8pt; color: rgb(var(--neon-300)); }
h1 { font-family: var(--display); font-weight: 500; text-transform: uppercase; letter-spacing: 0.06em;
  font-size: 30pt; line-height: 1.1; margin: 5mm 0 6mm; color: rgb(var(--neon-100));
  text-shadow: 0 0 12px rgb(var(--neon-500) / 0.7); }
.cover .who { font-family: var(--display); text-transform: uppercase; letter-spacing: 0.2em;
  font-size: 8.5pt; color: rgb(var(--ink-200)); }
.rule { width: 24mm; height: 1px; margin-bottom: 6mm;
  background: linear-gradient(90deg, rgb(var(--neon-500)), transparent); }

/* Le haut et le bas de chaque page, répétés par Chrome : les marges d'@page restent blanches. */
table.flow { width: 100%; border-collapse: collapse; }
table.flow td { padding: 0 18mm; }
.space { height: 16mm; }

h2 { font-family: var(--display); font-weight: 500; text-transform: uppercase; letter-spacing: 0.18em;
  font-size: 11pt; color: rgb(var(--neon-200)); margin: 0 0 6mm; }
section { margin-bottom: 12mm; }
.goal p { font-size: 13pt; line-height: 1.55; font-style: italic; color: rgb(var(--ink-50)); }

.place { display: grid; grid-template-columns: 12mm 1fr; gap: 0 4mm; padding: 6mm 0;
  border-top: 1px solid rgb(var(--steel-600) / 0.5); break-inside: avoid; }
.place .shot { grid-column: 1 / -1; width: 100%; height: 92mm; object-fit: cover; margin-bottom: 5mm;
  border: 1px solid rgb(var(--neon-600) / 0.4); }
.place .num { font-family: var(--display); font-size: 14pt; color: rgb(var(--neon-400)); line-height: 1.2; }
h3 { font-family: var(--display); font-weight: 500; text-transform: uppercase; letter-spacing: 0.1em;
  font-size: 11.5pt; color: rgb(var(--ink-50)); line-height: 1.3; }
.sub { font-family: var(--display); text-transform: uppercase; letter-spacing: 0.16em; font-size: 7.5pt;
  color: rgb(var(--steel-400)); margin-top: 1mm; }
dl { margin-top: 3.5mm; }
.row { display: grid; grid-template-columns: 34mm 1fr; gap: 4mm; margin-top: 1.5mm; }
dt { font-family: var(--display); text-transform: uppercase; letter-spacing: 0.14em; font-size: 7pt;
  color: rgb(var(--steel-400)); padding-top: 0.8mm; }
dd { color: rgb(var(--ink-100)); }
.answer dd { font-family: var(--display); letter-spacing: 0.04em; color: rgb(var(--neon-200)); unicode-bidi: plaintext; }

.kept ul { list-style: none; columns: 2; column-gap: 10mm; }
.kept li { padding: 1.5mm 0; border-bottom: 1px solid rgb(var(--steel-600) / 0.35); break-inside: avoid; }
.kept .tag { display: block; font-family: var(--display); text-transform: uppercase; letter-spacing: 0.14em;
  font-size: 7pt; color: rgb(var(--neon-400)); }

/* Le texte de fin, tel que l'écran l'a montré : la lecture finale mise à part. */
.ending { break-before: page; }
.ending h2 { font-size: 18pt; letter-spacing: 0.08em; line-height: 1.2; color: rgb(var(--neon-200));
  text-shadow: 0 0 10px rgb(var(--neon-500) / 0.6); margin-bottom: 8mm; }
.ending p { font-size: 11pt; line-height: 1.75; margin-bottom: 4mm; }
.ending p:last-of-type { margin-top: 8mm; padding: 6mm 0 0 5mm; border-top: 1px solid rgb(var(--neon-600) / 0.45);
  border-left: 2px solid rgb(var(--neon-500) / 0.6); color: rgb(var(--ink-50)); break-inside: avoid; }
.ending em { font-style: normal; color: rgb(var(--neon-300)); }
.ending strong { font-weight: 600; color: rgb(var(--neon-200)); }
.colophon { margin-top: 14mm; text-align: center; }

:lang(ar) *, :lang(zh) *, :lang(ja) * { letter-spacing: 0 !important; }
:lang(ar) dt, :lang(zh) dt, :lang(ja) dt { font-size: 8pt; }
[dir="rtl"] .rule { background: linear-gradient(270deg, rgb(var(--neon-500)), transparent); }
[dir="rtl"] .ending p:last-of-type { padding: 6mm 5mm 0 0; border-left: 0; border-right: 2px solid rgb(var(--neon-500) / 0.6); }
</style>
</head>
<body>
<div class="cover">
  ${k.image ? `<img src="${k.image}" alt="">` : ''}
  <div class="veil"></div>
  <div class="text">
    <div class="rule"></div>
    <p class="eyebrow">${game}</p>
    <h1>${esc(k.title)}</h1>
    <p class="who">${esc([k.name, k.date].filter(Boolean).join(' — '))}</p>
  </div>
</div>
<table class="flow">
  <thead><tr><td><div class="space"></div></td></tr></thead>
  <tfoot><tr><td><div class="space"></div></td></tr></tfoot>
  <tbody><tr><td>
    ${k.goal ? `<section class="goal"><h2>${t('goal')}</h2><p>${esc(k.goal)}</p></section>` : ''}
    ${places ? `<section><h2>${t('places')}</h2>${places}</section>` : ''}
    ${kept ? `<section class="kept"><h2>${t('kept')}</h2><ul>${kept}</ul></section>` : ''}
    <section class="ending">${k.ending_html}</section>
    <p class="colophon eyebrow">${game} — farnight.online</p>
  </td></tr></tbody>
</table>
</body>
</html>`
}

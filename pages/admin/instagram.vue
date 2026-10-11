<script setup lang="ts">
/**
 * L'atelier Instagram.
 *
 * Un post y passe de l'idée à la mise en ligne. Il est une publication, une
 * story ou un Reel, jamais les trois : un sujet, une image peinte dans le
 * style du jeu (server/utils/instagram.ts), recadrée ici même dans le seul
 * format de son type, animée par Veo s'il est un Reel, une légende écrite par
 * Claude d'après l'image. Tout est écrit dans communication/instagram/,
 * versionné avec le reste.
 */
import type { InstagramPost, PostKind, PostStatus } from '~/types/instagram'
import { FORMATS, formatsFor, place, type FormatId, type Framing } from '~/utils/instagram-crop'
import { postPdf } from '~/utils/instagram-pdf'

// Voir middleware/admin.ts : la page n'existe qu'en local.
definePageMeta({ middleware: 'admin' })
useHead({ title: 'Atelier Instagram' })

const { data, error, refresh } = await useFetch('/api/admin/instagram')
const posts = computed<InstagramPost[]>(() => (data.value?.posts ?? []) as InstagramPost[])
const background = computed(() => data.value?.palette.dominant ?? '#0b0f1c')

const STATUS: Record<PostStatus, { label: string; tone: string }> = {
  idee: { label: 'Idée', tone: 'border-steel-600/60 text-steel-400' },
  brouillon: { label: 'Brouillon', tone: 'border-ink-400/60 text-ink-200' },
  pret: { label: 'Prêt', tone: 'border-neon-600/60 text-neon-300' },
  publie: { label: 'Publié', tone: 'border-ink-600 text-ink-300' },
}
const STATUSES = Object.keys(STATUS) as PostStatus[]

const KIND: Record<PostKind, string> = { publication: 'Publication', story: 'Story', reel: 'Reel' }
const KINDS = Object.keys(KIND) as PostKind[]

const selectedId = ref<string | null>(null)
const notice = ref<{ text: string; error?: boolean } | null>(null)
const busy = ref<string | null>(null)

const visible = computed(() => {
  // Les dates prévues d'abord, la plus proche en tête ; le reste par fraîcheur.
  return [...posts.value].sort((a, b) => {
    if (a.scheduled_for && b.scheduled_for) return a.scheduled_for.localeCompare(b.scheduled_for)
    if (a.scheduled_for) return -1
    if (b.scheduled_for) return 1
    return b.updated_at.localeCompare(a.updated_at)
  })
})

const fileUrl = (path: string | null | undefined, version = '') =>
  path ? `/api/admin/instagram/file?path=${encodeURIComponent(path)}&v=${encodeURIComponent(version)}` : ''
const thumbOf = (p: InstagramPost) => fileUrl(p.renders[p.format] ?? p.source, p.updated_at)

function say(text: string, isError = false) {
  notice.value = { text, error: isError }
  setTimeout(() => { if (notice.value?.text === text) notice.value = null }, isError ? 8000 : 3000)
}
const reason = (err: any) => err?.data?.statusMessage ?? err?.statusMessage ?? err?.message ?? String(err)

/** Remplace un post dans la liste locale par ce que le serveur a renvoyé. */
function adopt(post: InstagramPost) {
  if (!data.value) return
  const list = data.value.posts as InstagramPost[]
  const i = list.findIndex(p => p.id === post.id)
  if (i >= 0) list.splice(i, 1, post)
  else list.unshift(post)
  if (draft.value?.id === post.id) loadDraft(post)
}

async function run<T>(label: string, task: () => Promise<T>): Promise<T | undefined> {
  busy.value = label
  try {
    return await task()
  } catch (err) {
    say(reason(err), true)
  } finally {
    busy.value = null
  }
}

/* ───────────── Le post ouvert ───────────── */

const draft = ref<InstagramPost | null>(null)
const hashtagText = ref('')
const saveState = ref<'saved' | 'pending' | 'saving'>('saved')

function loadDraft(post: InstagramPost) {
  draft.value = JSON.parse(JSON.stringify(post))
  hashtagText.value = post.hashtags.map(h => `#${h}`).join(' ')
  saveState.value = 'saved'
}

function open(id: string) {
  flushSave()
  selectedId.value = id
  const post = posts.value.find(p => p.id === id)
  if (post) loadDraft(post)
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
function scheduleSave() {
  saveState.value = 'pending'
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(save, 700)
}
function flushSave() {
  if (saveTimer && saveState.value === 'pending') {
    clearTimeout(saveTimer)
    save()
  }
}
async function save() {
  saveTimer = null
  const d = draft.value
  if (!d) return
  saveState.value = 'saving'
  try {
    const post = await $fetch<InstagramPost>(`/api/admin/instagram/${d.id}`, {
      method: 'PATCH',
      body: {
        title: d.title, subject: d.subject, notes: d.notes, status: d.status,
        scheduled_for: d.scheduled_for || null, published_at: d.published_at || null,
        caption: d.caption, overlay: d.overlay, framing: d.framing, motion: d.motion, video: d.video,
        kind: d.kind, format: d.format,
        hashtags: hashtagText.value.split(/[\s,]+/).map(h => h.replace(/^#/, '')).filter(Boolean),
      },
    })
    // On ne recharge pas le brouillon : l'utilisateur tape peut-être encore.
    const list = data.value!.posts as InstagramPost[]
    list.splice(list.findIndex(p => p.id === post.id), 1, post)
    if (draft.value?.id === post.id) {
      draft.value.updated_at = post.updated_at
      draft.value.published_at = post.published_at
    }
    if (saveState.value === 'saving') saveState.value = 'saved'
  } catch (err) {
    saveState.value = 'pending'
    say(`Enregistrement impossible : ${reason(err)}`, true)
  }
}
onBeforeUnmount(flushSave)

const hashtags = computed(() => hashtagText.value.split(/[\s,]+/).map(h => h.replace(/^#/, '')).filter(Boolean))
const fullCaption = computed(() => {
  if (!draft.value) return ''
  const tags = hashtags.value.map(h => `#${h}`).join(' ')
  return [draft.value.caption.trim(), tags].filter(Boolean).join('\n\n')
})

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text)
    say(`${what} copié`)
  } catch {
    say('Le presse-papiers est refusé par le navigateur', true)
  }
}

async function createPost(fields: { title: string; subject?: string; notes?: string; kind?: PostKind }) {
  const post = await run('create', () => $fetch<InstagramPost>('/api/admin/instagram', { method: 'POST', body: fields }))
  if (post) {
    adopt(post)
    open(post.id)
  }
  return post
}

const newTitle = ref('')
const newKind = ref<PostKind>('publication')
async function quickCreate() {
  if (!newTitle.value.trim()) return
  if (await createPost({ title: newTitle.value, kind: newKind.value })) newTitle.value = ''
}

/** Changer de type ramène le format dans ceux que ce type permet. */
function setKind(kind: PostKind) {
  const d = draft.value
  if (!d) return
  d.kind = kind
  if (!formatsFor(kind).includes(d.format)) d.format = formatsFor(kind)[0]!
  scheduleSave()
}
function setFormat(format: FormatId) {
  if (!draft.value) return
  draft.value.format = format
  scheduleSave()
}

async function remove() {
  const d = draft.value
  if (!d || !confirm(`Supprimer « ${d.title} » et les images de son dossier instagram/${d.id}/ ?`)) return
  const ok = await run('delete', () => $fetch(`/api/admin/instagram/${d.id}`, { method: 'DELETE' }))
  if (!ok) return
  draft.value = null
  selectedId.value = null
  await refresh()
}

function markPublished() {
  if (!draft.value) return
  draft.value.status = 'publie'
  draft.value.published_at = draft.value.published_at || new Date().toISOString().slice(0, 10)
  scheduleSave()
}

/* ───────────── L'image source ───────────── */

const quality = 'high'

async function generate() {
  const d = draft.value
  if (!d?.subject.trim()) return say('Décris d’abord le sujet de l’image', true)
  flushSave()
  const post = await run('image', () => $fetch<InstagramPost>(`/api/admin/instagram/${d.id}/image`, {
    method: 'POST', body: { subject: d.subject, quality }, timeout: 600_000,
  }))
  if (post) {
    adopt(post)
    say('Nouvelle image peinte')
  }
}

function upload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  const d = draft.value
  if (!file || !d) return
  const reader = new FileReader()
  reader.onload = async () => {
    const post = await run('upload', () => $fetch<InstagramPost>(`/api/admin/instagram/${d.id}/source`, {
      method: 'POST', body: { image: reader.result },
    }))
    if (post) adopt(post)
  }
  reader.readAsDataURL(file)
  ;(event.target as HTMLInputElement).value = ''
}

function pickSource(path: string) {
  if (!draft.value || draft.value.source === path) return
  draft.value.source = path
  scheduleSave()
}

/* ───────────── Les déclinaisons ───────────── */

/** Le seul cadre affiché : celui du format du post. */
const shownFormats = computed(() => FORMATS.filter(f => f.id === draft.value?.format))

/** Hors réactivité : Vue rappelle ces refs à chaque rendu, sans que rien n'en dépende. */
const canvases: Partial<Record<FormatId, HTMLCanvasElement>> = {}
const sourceImage = shallowRef<HTMLImageElement | null>(null)
const sourceSize = ref('')

function bindCanvas(id: FormatId) {
  return (el: unknown) => {
    if (!el) {
      delete canvases[id]
      return
    }
    // Un canvas remonté (retour d'onglet) naît vide : on le repeint.
    if (canvases[id] !== el) {
      canvases[id] = el as HTMLCanvasElement
      nextTick(() => paint(id))
    }
  }
}

watch(() => draft.value?.source, (path) => {
  sourceImage.value = null
  sourceSize.value = ''
  if (!path || !import.meta.client) return
  const img = new Image()
  img.onload = () => {
    if (draft.value?.source !== path) return
    sourceImage.value = img
    sourceSize.value = `${img.naturalWidth}×${img.naturalHeight}`
  }
  img.onerror = () => say(`Image illisible : ${path}`, true)
  img.src = fileUrl(path, draft.value?.updated_at)
}, { immediate: true })

function paint(id: FormatId) {
  const canvas = canvases[id]
  const img = sourceImage.value
  const framing = draft.value?.framing[id]
  if (!canvas || !img || !framing) return
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = background.value
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const { src, dst } = place(img.naturalWidth, img.naturalHeight, canvas.width, canvas.height, framing)
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, src.x, src.y, src.w, src.h, dst.x, dst.y, dst.w, dst.h)
  if (id === '9x16' && draft.value?.kind === 'story') paintOverlay(ctx, canvas.width, canvas.height)
}
const paintAll = () => FORMATS.forEach(f => paint(f.id))

watch([sourceImage, () => draft.value?.framing, () => draft.value?.overlay], () => nextTick(paintAll), { deep: true })

/**
 * L'accroche d'une story, dessinée sur le canvas même de l'aperçu : ce qu'on
 * voit est ce qui part. Elle reste entre les zones qu'Instagram recouvre — la
 * barre du profil en haut, la réponse en bas — sur un aplat d'encre, sans
 * dégradé, dans la police et le néon du jeu.
 */
const SAFE_TOP = 250 / 1920
const SAFE_BOTTOM = 340 / 1920
const DISPLAY_FONT = 'Futura, "Avenir Next", "Century Gothic", "Trebuchet MS", system-ui, sans-serif'

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}

function paintOverlay(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const { hook, cta, position } = draft.value!.overlay
  if (!hook.trim() && !cta.trim()) return
  const pad = w * 0.09
  const maxWidth = w - pad * 2

  // L'accroche rétrécit jusqu'à tenir en trois lignes.
  let hookSize = w * 0.085
  let hookLines: string[] = []
  ctx.letterSpacing = '0.04em'
  for (; hookSize > w * 0.05; hookSize *= 0.92) {
    ctx.font = `600 ${hookSize}px ${DISPLAY_FONT}`
    hookLines = wrap(ctx, hook.trim().toUpperCase(), maxWidth)
    if (hookLines.length <= 3) break
  }
  const ctaSize = w * 0.042
  ctx.font = `400 ${ctaSize}px ${DISPLAY_FONT}`
  const ctaLines = wrap(ctx, cta.trim(), maxWidth)

  const hookLead = hookSize * 1.12
  const ctaLead = ctaSize * 1.35
  const gap = hookLines.length && ctaLines.length ? hookSize * 0.55 : 0
  const blockH = hookLines.length * hookLead + gap + ctaLines.length * ctaLead
  const top = h * SAFE_TOP + pad * 0.6
  const bottom = h * (1 - SAFE_BOTTOM) - pad * 0.6
  const y0 = position === 'top' ? top : position === 'center' ? (h - blockH) / 2 : bottom - blockH

  ctx.globalAlpha = 0.8
  ctx.fillStyle = background.value
  ctx.fillRect(0, y0 - pad * 0.5, w, blockH + pad)
  ctx.globalAlpha = 1

  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  let y = y0
  ctx.font = `600 ${hookSize}px ${DISPLAY_FONT}`
  ctx.fillStyle = data.value?.palette.accent ?? '#ff2e88'
  for (const line of hookLines) {
    ctx.fillText(line, w / 2, y)
    y += hookLead
  }
  y += gap
  ctx.letterSpacing = '0.08em'
  ctx.font = `400 ${ctaSize}px ${DISPLAY_FONT}`
  ctx.fillStyle = '#e9ecf1'
  for (const line of ctaLines) {
    ctx.fillText(line, w / 2, y)
    y += ctaLead
  }
  ctx.letterSpacing = '0px'
}

function setOverlay(patch: Partial<InstagramPost['overlay']>) {
  if (!draft.value) return
  draft.value.overlay = { ...draft.value.overlay, ...patch }
  scheduleSave()
}

function setFraming(id: FormatId, patch: Partial<Framing>) {
  if (!draft.value) return
  draft.value.framing[id] = { ...draft.value.framing[id], ...patch }
  scheduleSave()
}

/** Glisser l'aperçu déplace le cadrage, comme on déplace une photo sous un cache. */
let drag: { id: FormatId; x: number; y: number; fx: number; fy: number; w: number; h: number } | null = null
function dragStart(id: FormatId, e: PointerEvent) {
  const f = draft.value?.framing[id]
  if (!f) return
  const box = (e.currentTarget as HTMLElement).getBoundingClientRect()
  ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  drag = { id, x: e.clientX, y: e.clientY, fx: f.x, fy: f.y, w: box.width, h: box.height }
}
function dragMove(e: PointerEvent) {
  if (!drag) return
  // En recadrage, l'image suit la main : glisser à droite montre la gauche.
  const sign = draft.value?.framing[drag.id].mode === 'crop' ? -1 : 1
  const clamp = (v: number) => Math.min(1, Math.max(0, v))
  setFraming(drag.id, {
    x: clamp(drag.fx + sign * (e.clientX - drag.x) / drag.w),
    y: clamp(drag.fy + sign * (e.clientY - drag.y) / drag.h),
  })
}
const dragEnd = () => { drag = null }

async function exportRenders() {
  const d = draft.value
  if (!d || !sourceImage.value) return
  paintAll()
  const renders: Record<string, string> = {}
  for (const f of FORMATS) {
    const canvas = canvases[f.id]
    if (canvas) renders[f.id] = canvas.toDataURL('image/jpeg', 0.92)
  }
  const post = await run('export', () => $fetch<InstagramPost>(`/api/admin/instagram/${d.id}/renders`, {
    method: 'POST', body: { renders, framing: d.framing },
  }))
  if (post) {
    adopt(post)
    say(`Exporté dans instagram/dropzone/${d.id}-${d.format}.jpg`)
  }
}

/* ───────────── Le Reel ───────────── */

const videoModel = ref<'fast' | 'standard'>('fast')
/** Décoché : la vidéo sort muette. */
const videoSound = ref(false)

async function animate() {
  const d = draft.value
  if (!d?.source) return say('Choisis d’abord l’image de départ', true)
  if (!d.motion.trim()) return say('Décris d’abord ce qui bouge', true)
  flushSave()
  const post = await run('video', () => $fetch<InstagramPost>(`/api/admin/instagram/${d.id}/video`, {
    method: 'POST', body: { motion: d.motion, model: videoModel.value, sound: videoSound.value }, timeout: 600_000,
  }))
  if (post) {
    adopt(post)
    say('Nouveau Reel animé')
  }
}

/** Le pool de références : peintes ou importées, citées par @nom dans « Ce qui bouge ». */
const refNameInput = ref('')
const refSubject = ref('')

async function addRef(image?: string) {
  const d = draft.value
  if (!d || !refNameInput.value.trim()) return say('Donne d’abord un nom à la référence', true)
  flushSave()
  const post = await run(image ? 'upload' : 'ref', () => $fetch<InstagramPost>(`/api/admin/instagram/${d.id}/ref`, {
    method: 'POST', body: { name: refNameInput.value, subject: refSubject.value, image }, timeout: 600_000,
  }))
  if (post) {
    adopt(post)
    refNameInput.value = ''
    refSubject.value = ''
  }
}

function uploadRef(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => addRef(reader.result as string)
  reader.readAsDataURL(file)
  ;(event.target as HTMLInputElement).value = ''
}

/** Un clic sur une référence la cite à la fin de « Ce qui bouge ». */
function citeRef(name: string) {
  const d = draft.value
  if (!d) return
  d.motion = `${d.motion.trimEnd()}${d.motion.trim() ? ' ' : ''}@${name} `
  scheduleSave()
}

function pickVideo(path: string) {
  if (!draft.value) return
  draft.value.video = path
  scheduleSave()
}

/** Retire une image ou une vidéo du pool ; les fichiers d'avant l'atelier restent sur le disque. */
async function removeVariant(path: string) {
  const d = draft.value
  if (!d || !confirm('Supprimer cette variante ?')) return
  flushSave()
  const post = await run('variant', () => $fetch<InstagramPost>(`/api/admin/instagram/${d.id}/variant`, {
    method: 'DELETE', body: { path },
  }))
  if (post) adopt(post)
}

/* ───────────── La légende ───────────── */

const captionDirection = ref('')
async function writeCaption() {
  const d = draft.value
  if (!d) return
  flushSave()
  const post = await run('caption', () => $fetch<InstagramPost>(`/api/admin/instagram/${d.id}/caption`, {
    method: 'POST', body: { direction: captionDirection.value }, timeout: 180_000,
  }))
  if (post) adopt(post)
}

/* ───────────── Le PDF ───────────── */

/** L'image telle qu'elle part : le format recadré (la story avec son texte), l'image de départ d'un Reel. */
function pdfCanvas(): HTMLCanvasElement | null {
  const d = draft.value
  const img = sourceImage.value
  if (!d || !img) return null
  if (d.kind !== 'reel' && canvases[d.format]) {
    paint(d.format)
    return canvases[d.format]!
  }
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  canvas.getContext('2d')!.drawImage(img, 0, 0)
  return canvas
}

async function exportPdf() {
  const d = draft.value
  const canvas = pdfCanvas()
  if (!d || !canvas) return say('Il faut d’abord une image', true)
  const jpeg = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92))
  if (!jpeg) return say('Image illisible pour le PDF', true)
  const blocks = d.kind === 'story'
    ? [{ label: 'Accroche', text: d.overlay.hook }, { label: 'Appel', text: d.overlay.cta }]
    : [{ label: 'Légende', text: fullCaption.value }]
  const blob = postPdf({
    title: d.title,
    meta: [KIND[d.kind], d.format.replace('x', ':'), d.scheduled_for && `prévu le ${d.scheduled_for}`].filter(Boolean).join(' · '),
    jpeg: new Uint8Array(await jpeg.arrayBuffer()),
    width: canvas.width,
    height: canvas.height,
    blocks: blocks.filter(b => b.text.trim()),
  })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${d.id}.pdf`
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

const BUSY_LABEL: Record<string, string> = {
  image: 'Peinture en cours — compte une à deux minutes…',
  caption: 'Claude regarde l’image et écrit…',
  export: 'Export du format…',
  ref: 'Peinture de la référence — compte une à deux minutes…',
  variant: 'Suppression de la variante…',
  upload: 'Import de l’image…',
  video: 'Veo anime l’image — compte deux à six minutes…',
  create: 'Création du post…',
  delete: 'Suppression…',
}

// [color-scheme:dark] : sans lui, les listes et les dates natives restent blanches.
const input = 'w-full bg-ink-800 [color-scheme:dark] border border-steel-500 px-3 py-2 text-sm text-parchment placeholder:text-ink-300 focus:border-neon-500 focus:outline-none'
const button = 'border border-neon-500 bg-neon-500/10 px-3 py-1.5 text-xs uppercase tracking-[0.14em] text-neon-200 hover:bg-neon-500/25 disabled:opacity-40 disabled:cursor-not-allowed'
const ghost = 'border border-steel-500 px-3 py-1.5 text-xs uppercase tracking-[0.14em] text-ink-100 hover:border-ink-200 disabled:opacity-40 disabled:cursor-not-allowed'
const label = 'font-display text-[11px] uppercase tracking-[0.2em] text-ink-200'
</script>

<template>
  <div class="ig-atelier min-h-[100dvh] px-4 py-8 sm:px-8">
    <div class="mx-auto w-full max-w-6xl space-y-8">

      <div v-if="error" class="border border-neon-600/40 p-6 space-y-2">
        <p class="font-display uppercase tracking-[0.2em] text-neon-400 text-xs">Atelier indisponible</p>
        <p class="text-ink-200/80 text-sm">{{ error.statusMessage ?? error.message }}</p>
      </div>

      <template v-else-if="data">
        <header class="space-y-4">
          <p class="font-display text-[10px] uppercase tracking-[0.4em] text-neon-400/80">Communication</p>
          <h1 class="neon-text font-display uppercase text-2xl sm:text-3xl tracking-[0.05em]">Atelier Instagram</h1>
          <div class="neon-rule w-32" />
          <p class="text-ink-100 text-sm leading-relaxed max-w-3xl">
            Choisis le type — publication, story ou Reel — puis décris l’image, peins-la, recadre-la ; pour un Reel,
            choisis l’image que Veo anime. Fais écrire la légende. Télécharge, copie, publie depuis l’app Instagram.
          </p>
        </header>

        <!-- ─────────────── Posts ─────────────── -->
        <section class="grid gap-6 lg:grid-cols-[300px_1fr]">
          <aside class="space-y-4">
            <form class="space-y-2" @submit.prevent="quickCreate">
              <div class="flex gap-1">
                <button
                  v-for="k in KINDS" :key="k" type="button"
                  :class="[newKind === k ? 'border-neon-500 text-neon-200 bg-neon-500/10' : 'border-steel-500 text-ink-100', 'flex-1 border py-1.5 text-[11px] uppercase tracking-[0.14em]']"
                  @click="newKind = k"
                >{{ KIND[k] }}</button>
              </div>
              <div class="flex gap-2">
                <input v-model="newTitle" :class="input" :placeholder="`Nouvelle ${KIND[newKind].toLowerCase()} — un titre`">
                <button :class="button" :disabled="!newTitle.trim() || !!busy">+</button>
              </div>
            </form>
            <ul class="space-y-1.5 max-h-[70vh] overflow-y-auto pr-1">
              <li v-for="p in visible" :key="p.id">
                <button
                  class="flex w-full items-center gap-3 border p-2 text-left hover:border-neon-600/60"
                  :class="selectedId === p.id ? 'border-neon-500 bg-neon-500/5' : 'border-steel-600'"
                  @click="open(p.id)"
                >
                  <img v-if="thumbOf(p)" :src="thumbOf(p)" alt="" class="h-14 w-11 shrink-0 object-cover bg-ink-800">
                  <span v-else class="h-14 w-11 shrink-0 bg-ink-800 border border-dashed border-steel-600/60" />
                  <span class="min-w-0 space-y-1">
                    <span class="block truncate text-sm text-ink-100">{{ p.title }}</span>
                    <span class="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em]">
                      <span class="text-ink-100">{{ KIND[p.kind] }}</span>
                      <span :class="[STATUS[p.status].tone, 'border px-1.5']">{{ STATUS[p.status].label }}</span>
                      <span v-if="p.scheduled_for && p.status !== 'publie'" class="text-ink-300">{{ p.scheduled_for }}</span>
                      <span v-else-if="p.published_at" class="text-ink-300">{{ p.published_at }}</span>
                    </span>
                  </span>
                </button>
              </li>
              <li v-if="!visible.length" class="text-ink-300 text-xs py-4">Aucun post ici.</li>
            </ul>
          </aside>

          <div v-if="!draft" class="border border-dashed border-steel-600 p-10 text-center text-ink-300 text-sm">
            Choisis un post à gauche, ou crée-en un.
          </div>

          <article v-else class="space-y-8 min-w-0">
            <!-- Infos -->
            <section class="space-y-4">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <input v-model="draft.title" :class="[input, 'font-display text-lg uppercase tracking-[0.06em] max-w-md']" @input="scheduleSave">
                <span class="text-[10px] uppercase tracking-[0.16em] text-ink-300 pt-3">
                  {{ saveState === 'saved' ? 'Enregistré' : saveState === 'saving' ? 'Enregistrement…' : 'Modifié' }}
                  · {{ draft.id }}
                </span>
              </div>
              <div class="grid gap-3 sm:grid-cols-3">
                <label class="space-y-1">
                  <span :class="label">Type</span>
                  <select :value="draft.kind" :class="input" @change="setKind(($event.target as HTMLSelectElement).value as PostKind)">
                    <option v-for="k in KINDS" :key="k" :value="k">{{ KIND[k] }}</option>
                  </select>
                </label>
                <label class="space-y-1">
                  <span :class="label">Statut</span>
                  <select v-model="draft.status" :class="input" @change="scheduleSave">
                    <option v-for="s in STATUSES" :key="s" :value="s">{{ STATUS[s].label }}</option>
                  </select>
                </label>
                <label class="space-y-1">
                  <span :class="label">Publication prévue</span>
                  <input v-model="draft.scheduled_for" type="date" :class="input" @change="scheduleSave">
                </label>
              </div>
              <label class="block space-y-1">
                <span :class="label">Notes — l’angle, ce que le post doit raconter</span>
                <textarea v-model="draft.notes" rows="2" :class="input" @input="scheduleSave" />
              </label>
            </section>

            <!-- Image : celle d'un Reel se choisit dans sa propre section -->
            <section v-if="draft.kind !== 'reel'" class="space-y-4 border-t border-steel-600 pt-6">
              <h2 class="font-display text-[11px] uppercase tracking-[0.28em] text-ink-100">1 · L’image</h2>
              <label class="block space-y-1">
                <span :class="label">Sujet, en anglais — le style et la palette sont ajoutés tout seuls</span>
                <textarea
                  v-model="draft.subject" rows="4" :class="input"
                  placeholder="A rain-soaked rooftop at night, a lone figure in a long coat…"
                  @input="scheduleSave"
                />
              </label>
              <div class="flex flex-wrap items-center gap-2">
                <button :class="button" :disabled="!!busy || !draft.subject.trim()" @click="generate">
                  {{ draft.sources.length ? 'Peindre une variante' : 'Peindre l’image' }}
                </button>
                <label :class="[ghost, 'cursor-pointer']">
                  Importer une image
                  <input type="file" accept="image/png,image/jpeg,image/webp" class="hidden" @change="upload">
                </label>
              </div>
              <div v-if="draft.sources.length" class="flex gap-2 overflow-x-auto pb-1">
                <div v-for="s in draft.sources" :key="s" class="relative shrink-0">
                  <button
                    class="border-2"
                    :class="draft.source === s ? 'border-neon-500' : 'border-transparent opacity-60 hover:opacity-100'"
                    :title="s"
                    @click="pickSource(s)"
                  >
                    <img :src="fileUrl(s)" alt="" class="ig-variant h-28 w-auto bg-ink-800">
                  </button>
                  <button
                    class="absolute right-1 top-1 bg-ink-900/85 px-1.5 text-xs text-ink-100 hover:text-red-300"
                    title="Supprimer cette variante" :disabled="!!busy" @click="removeVariant(s)"
                  >✕</button>
                </div>
              </div>
            </section>

            <!-- Cadrage -->
            <section v-if="draft.source && draft.kind !== 'reel'" class="space-y-4 border-t border-steel-600 pt-6">
              <div class="flex flex-wrap items-baseline justify-between gap-2">
                <h2 class="font-display text-[11px] uppercase tracking-[0.28em] text-ink-100">2 · Le cadrage</h2>
                <span class="text-ink-300 text-[11px]">Source {{ sourceSize || '…' }} — glisse l’aperçu pour recadrer</span>
              </div>
              <div v-if="draft.kind === 'publication'" class="flex gap-1 max-w-xs">
                <button
                  v-for="id in formatsFor('publication')" :key="id"
                  :class="[draft.format === id ? 'border-neon-500 text-neon-200 bg-neon-500/10' : 'border-steel-500 text-ink-100', 'flex-1 border py-1.5 text-[11px] uppercase tracking-[0.14em]']"
                  @click="setFormat(id)"
                >{{ id === '1x1' ? 'Carré' : 'Portrait 4:5' }}</button>
              </div>
              <div class="max-w-xs">
                <div v-for="f in shownFormats" :key="f.id" class="space-y-2">
                  <p class="flex justify-between text-[10px] uppercase tracking-[0.16em]">
                    <span class="text-ink-100">{{ f.label }}</span>
                    <span class="text-ink-300">{{ f.width }}×{{ f.height }}</span>
                  </p>
                  <canvas
                    :ref="bindCanvas(f.id)"
                    :width="f.width" :height="f.height"
                    class="w-full border border-steel-600 cursor-grab active:cursor-grabbing touch-none"
                    @pointerdown="dragStart(f.id, $event)"
                    @pointermove="dragMove"
                    @pointerup="dragEnd"
                    @pointercancel="dragEnd"
                  />
                  <div class="flex gap-1 text-[10px] uppercase tracking-[0.12em]">
                    <button
                      v-for="m in (['crop', 'fit'] as const)" :key="m"
                      :class="[draft.framing[f.id].mode === m ? 'border-neon-500 text-neon-300' : 'border-steel-600/60 text-ink-300', 'flex-1 border py-1']"
                      @click="setFraming(f.id, { mode: m })"
                    >{{ m === 'crop' ? 'Remplir' : 'Image entière' }}</button>
                  </div>
                  <label class="flex items-center gap-2 text-[10px] text-ink-300">
                    Zoom
                    <input
                      type="range" min="1" max="2.5" step="0.01" class="flex-1 accent-neon-500"
                      :value="draft.framing[f.id].zoom"
                      @input="setFraming(f.id, { zoom: Number(($event.target as HTMLInputElement).value) })"
                    >
                  </label>
                  <a
                    v-if="draft.renders[f.id]"
                    :href="fileUrl(draft.renders[f.id], draft.updated_at)"
                    :download="`${draft.id}-${f.id}.jpg`"
                    class="block text-[11px] text-neon-300 hover:underline underline-offset-4"
                  >Télécharger le {{ f.id.replace('x', ':') }} exporté</a>
                </div>
              </div>
              <div v-if="draft.kind === 'story'" class="space-y-3 max-w-md">
                <span :class="label">Le texte de la story — incrusté à l’export</span>
                <div class="flex flex-wrap gap-2">
                  <input
                    v-model="captionDirection" :class="[input, 'flex-1 min-w-[200px]']"
                    placeholder="Consigne facultative pour Claude"
                  >
                  <button :class="button" :disabled="!!busy" @click="writeCaption">
                    {{ draft.overlay.hook ? 'Réécrire avec Claude' : 'Écrire avec Claude' }}
                  </button>
                </div>
                <label class="block space-y-1">
                  <span :class="label">Accroche</span>
                  <input :value="draft.overlay.hook" :class="input" @input="setOverlay({ hook: ($event.target as HTMLInputElement).value })">
                </label>
                <label class="block space-y-1">
                  <span :class="label">Appel — au-dessus du sticker lien</span>
                  <input :value="draft.overlay.cta" :class="input" @input="setOverlay({ cta: ($event.target as HTMLInputElement).value })">
                </label>
                <div class="flex gap-1 text-[10px] uppercase tracking-[0.12em]">
                  <button
                    v-for="[pos, name] in ([['top', 'Haut'], ['center', 'Centre'], ['bottom', 'Bas']] as const)" :key="pos"
                    :class="[draft.overlay.position === pos ? 'border-neon-500 text-neon-300' : 'border-steel-600/60 text-ink-300', 'flex-1 border py-1']"
                    @click="setOverlay({ position: pos })"
                  >{{ name }}</button>
                </div>
              </div>
              <button :class="button" :disabled="!!busy || !sourceImage" @click="exportRenders">
                Exporter
              </button>
              <p v-if="draft.kind === 'story'" class="text-ink-200 text-sm">
                Télécharge le 9:16 exporté, publie-le en story, puis ajoute le sticker lien vers le jeu juste sous le texte.
              </p>
            </section>

            <!-- Reel -->
            <section v-if="draft.kind === 'reel'" class="space-y-4 border-t border-steel-600 pt-6">
              <h2 class="font-display text-[11px] uppercase tracking-[0.28em] text-ink-100">1 · La vidéo</h2>
              <div class="space-y-2">
                <span :class="label">L’image de départ — celle que Veo anime</span>
                <div class="flex flex-wrap items-center gap-2">
                  <label :class="[button, 'cursor-pointer']">
                    {{ draft.source ? 'Changer l’image' : 'Choisir une image' }}
                    <input type="file" accept="image/png,image/jpeg,image/webp" class="hidden" @change="upload">
                  </label>
                </div>
                <div v-if="draft.sources.length" class="flex gap-2 overflow-x-auto pb-1">
                  <div v-for="s in draft.sources" :key="s" class="relative shrink-0">
                    <button
                      class="border-2"
                      :class="draft.source === s ? 'border-neon-500' : 'border-transparent opacity-60 hover:opacity-100'"
                      :title="s"
                      @click="pickSource(s)"
                    >
                      <img :src="fileUrl(s)" alt="" class="ig-variant h-40 w-auto bg-ink-800">
                    </button>
                    <button
                      class="absolute right-1 top-1 bg-ink-900/85 px-1.5 text-xs text-ink-100 hover:text-red-300"
                      title="Supprimer cette image" :disabled="!!busy" @click="removeVariant(s)"
                    >✕</button>
                  </div>
                </div>
              </div>
              <div class="space-y-2">
                <span :class="label">Les références · {{ draft.refs.length }} — Veo ne les voit pas, Claude les décrit quand « Ce qui bouge » cite leur @nom</span>
                <div v-if="draft.refs.length" class="flex gap-2 overflow-x-auto pb-1">
                  <div v-for="r in draft.refs" :key="r.path" class="relative shrink-0 space-y-1">
                    <button class="block border-2 border-transparent hover:border-neon-600/60" :title="r.subject || r.path" @click="citeRef(r.name)">
                      <img :src="fileUrl(r.path)" alt="" class="ig-variant h-28 w-auto bg-ink-800">
                    </button>
                    <span class="block text-[11px] text-neon-300">@{{ r.name }}</span>
                    <button
                      class="absolute right-1 top-1 bg-ink-900/85 px-1.5 text-xs text-ink-100 hover:text-red-300"
                      title="Supprimer cette référence" :disabled="!!busy" @click="removeVariant(r.path)"
                    >✕</button>
                  </div>
                </div>
                <p v-else class="border border-dashed border-steel-600 p-4 text-ink-300 text-xs">
                  Le pool est vide. Chaque référence ajoutée vient s’y ranger, autant qu’il en faut ; un clic sur l’une d’elles la cite dans « Ce qui bouge ».
                </p>
                <span class="block text-[10px] uppercase tracking-[0.16em] text-ink-200 pt-1">
                  {{ draft.refs.length ? 'Ajouter une autre référence' : 'Ajouter une référence' }}
                </span>
                <div class="flex flex-wrap gap-2">
                  <input v-model="refNameInput" :class="[input, 'w-40']" placeholder="nom">
                  <input
                    v-model="refSubject" :class="[input, 'flex-1 min-w-[200px]']"
                    placeholder="Ce que la référence montre — le style et la palette sont ajoutés tout seuls"
                  >
                </div>
                <div class="flex flex-wrap items-center gap-2">
                  <button :class="button" :disabled="!!busy || !refNameInput.trim() || !refSubject.trim()" @click="addRef()">
                    Peindre la référence
                  </button>
                  <label :class="[ghost, 'cursor-pointer']" :aria-disabled="!refNameInput.trim()">
                    Importer une image
                    <input type="file" accept="image/png,image/jpeg,image/webp" class="hidden" :disabled="!!busy || !refNameInput.trim()" @change="uploadRef">
                  </label>
                </div>
              </div>
              <label class="block space-y-1">
                <span :class="label">Ce qui bouge, en français — Claude en fait le prompt anglais de Veo</span>
                <textarea
                  v-model="draft.motion" rows="3" :class="input"
                  placeholder="Ce qui bouge dans l’image, et comment la caméra se déplace — une référence se cite par son @nom"
                  @input="scheduleSave"
                />
              </label>
              <div class="flex flex-wrap items-center gap-2">
                <select v-model="videoModel" :class="[input, 'w-auto']">
                  <option value="fast">Veo 3.1 Fast — environ 1 $</option>
                  <option value="standard">Veo 3.1 — environ 3,20 $</option>
                </select>
                <label class="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-ink-100 cursor-pointer">
                  <input v-model="videoSound" type="checkbox" class="accent-neon-500">
                  Avec le son
                </label>
                <button :class="button" :disabled="!!busy || !draft.source || !draft.motion.trim()" @click="animate">
                  {{ draft.videos.length ? 'Tourner une variante' : 'Tourner le Reel' }}
                </button>
              </div>
              <div v-if="draft.videos.length" class="flex gap-3 overflow-x-auto pb-1">
                <div v-for="v in draft.videos" :key="v" class="shrink-0 space-y-1">
                  <video
                    :src="fileUrl(v)" controls loop playsinline preload="metadata"
                    class="ig-variant border-2" :class="draft.video === v ? 'border-neon-500' : 'border-transparent'"
                  />
                  <div class="flex gap-2 text-[11px]">
                    <button v-if="draft.video !== v" class="text-ink-100 hover:text-neon-300" @click="pickVideo(v)">Choisir</button>
                    <span v-else class="text-neon-300">Choisie</span>
                    <a :href="fileUrl(v)" :download="`${draft.id}-reel.mp4`" class="text-neon-300 hover:underline underline-offset-4">Télécharger</a>
                    <button class="ml-auto text-red-400/80 hover:text-red-300" :disabled="!!busy" @click="removeVariant(v)">Supprimer</button>
                  </div>
                </div>
              </div>
            </section>

            <!-- Légende -->
            <section v-if="draft.kind !== 'story'" class="space-y-4 border-t border-steel-600 pt-6">
              <h2 class="font-display text-[11px] uppercase tracking-[0.28em] text-ink-100">{{ draft.kind === 'reel' ? 2 : 3 }} · La légende</h2>
              <div class="flex flex-wrap gap-2">
                <input
                  v-model="captionDirection" :class="[input, 'flex-1 min-w-[200px]']"
                  placeholder="Consigne facultative : plus mystérieux, annoncer la sortie…"
                >
                <button :class="button" :disabled="!!busy" @click="writeCaption">
                  {{ draft.caption ? 'Réécrire avec Claude' : 'Écrire avec Claude' }}
                </button>
              </div>
              <label class="block space-y-1">
                <span :class="label" class="flex justify-between">
                  <span>Légende</span>
                  <span :class="draft.caption.length > 2200 ? 'text-red-400' : ''">{{ draft.caption.length }} / 2200</span>
                </span>
                <textarea v-model="draft.caption" rows="7" :class="input" @input="scheduleSave" />
              </label>
              <label class="block space-y-1">
                <span :class="label" class="flex justify-between">
                  <span>Hashtags</span>
                  <span :class="hashtags.length > 30 ? 'text-red-400' : ''">{{ hashtags.length }} / 30</span>
                </span>
                <textarea v-model="hashtagText" rows="2" :class="input" @input="scheduleSave" />
              </label>
              <div class="flex flex-wrap gap-2">
                <button :class="button" :disabled="!fullCaption" @click="copy(fullCaption, 'Légende et hashtags')">
                  Copier légende + hashtags
                </button>
              </div>
            </section>

            <footer class="flex flex-wrap justify-between gap-2 border-t border-steel-600 pt-6">
              <div class="flex flex-wrap gap-2">
                <button :class="ghost" :disabled="!!busy || !sourceImage" @click="exportPdf">Exporter en PDF</button>
                <button v-if="draft.status !== 'publie'" :class="button" @click="markPublished">Marquer comme publié</button>
              </div>
              <button class="text-xs uppercase tracking-[0.14em] text-red-400/80 hover:text-red-300" :disabled="!!busy" @click="remove">
                Supprimer le post
              </button>
            </footer>
          </article>
        </section>
      </template>
    </div>

    <div
      v-if="busy || notice"
      class="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-[90vw] border px-4 py-2 text-sm bg-ink-900/95"
      :class="notice?.error && !busy ? 'border-red-400/60 text-red-300' : 'border-neon-600/60 text-ink-100'"
    >
      {{ busy ? BUSY_LABEL[busy] ?? 'Un instant…' : notice?.text }}
    </div>
  </div>
</template>

<style>
/*
 * Filet de sécurité : si Tailwind n'a pas (encore) généré les classes de la
 * page, les champs restaient blancs à texte gris et les bordures claires.
 * :where() ramène tout à une spécificité nulle, les utilitaires gagnent dès
 * qu'ils existent.
 */
:where(.ig-atelier) :where(*) { border-color: rgb(var(--steel-500)); }
:where(.ig-atelier) :where(input:not([type=range], [type=file]), textarea, select) {
  background-color: rgb(var(--ink-800));
  color: #e9ecf1;
  color-scheme: dark;
}
:where(.ig-atelier) :where(input, textarea)::placeholder { color: rgb(var(--ink-300)); }
/* Les variantes peintes : des vignettes, pas l'image en 1024×1536. */
.ig-variant { height: 7rem; width: auto; }
</style>

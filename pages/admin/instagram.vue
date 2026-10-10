<script setup lang="ts">
/**
 * L'atelier Instagram.
 *
 * Un post y passe de l'idée à la mise en ligne : un sujet, une image peinte
 * dans le style du jeu (server/utils/instagram.ts), ses trois déclinaisons
 * recadrées ici même, une légende écrite par Claude d'après l'image. Tout est
 * écrit dans communication/instagram/, versionné avec le reste.
 */
import type { InstagramPost, PostIdea, PostStatus } from '~/types/instagram'
import { FORMATS, place, type FormatId, type Framing } from '~/utils/instagram-crop'

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
  publie: { label: 'Publié', tone: 'border-ink-600 text-ink-400' },
}
const STATUSES = Object.keys(STATUS) as PostStatus[]

type Tab = 'posts' | 'grille' | 'idees'
const tab = ref<Tab>('posts')
const filter = ref<PostStatus | 'tous'>('tous')
const selectedId = ref<string | null>(null)
const notice = ref<{ text: string; error?: boolean } | null>(null)
const busy = ref<string | null>(null)

const visible = computed(() => {
  const list = filter.value === 'tous' ? posts.value : posts.value.filter(p => p.status === filter.value)
  // Les dates prévues d'abord, la plus proche en tête ; le reste par fraîcheur.
  return [...list].sort((a, b) => {
    if (a.scheduled_for && b.scheduled_for) return a.scheduled_for.localeCompare(b.scheduled_for)
    if (a.scheduled_for) return -1
    if (b.scheduled_for) return 1
    return b.updated_at.localeCompare(a.updated_at)
  })
})
const countOf = (s: PostStatus) => posts.value.filter(p => p.status === s).length

const fileUrl = (path: string | null | undefined, version = '') =>
  path ? `/api/admin/instagram/file?path=${encodeURIComponent(path)}&v=${encodeURIComponent(version)}` : ''
const thumbOf = (p: InstagramPost) => fileUrl(p.renders['4x5'] ?? p.renders['1x1'] ?? p.source, p.updated_at)

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
  tab.value = 'posts'
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
        caption: d.caption, alt: d.alt, framing: d.framing,
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

async function createPost(fields: { title: string; subject?: string; notes?: string }) {
  const post = await run('create', () => $fetch<InstagramPost>('/api/admin/instagram', { method: 'POST', body: fields }))
  if (post) {
    adopt(post)
    open(post.id)
  }
  return post
}

const newTitle = ref('')
async function quickCreate() {
  if (!newTitle.value.trim()) return
  if (await createPost({ title: newTitle.value })) newTitle.value = ''
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

const quality = ref<'low' | 'medium' | 'high'>('high')

async function generate() {
  const d = draft.value
  if (!d?.subject.trim()) return say('Décris d’abord le sujet de l’image', true)
  flushSave()
  const post = await run('image', () => $fetch<InstagramPost>(`/api/admin/instagram/${d.id}/image`, {
    method: 'POST', body: { subject: d.subject, quality: quality.value }, timeout: 600_000,
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
}
const paintAll = () => FORMATS.forEach(f => paint(f.id))

watch([sourceImage, () => draft.value?.framing], () => nextTick(paintAll), { deep: true })

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
    say('Les trois formats sont exportés')
  }
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

/* ───────────── Les idées ───────────── */

const ideaDirection = ref('')
const ideaCount = ref(6)
const ideas = ref<PostIdea[]>([])
async function proposeIdeas() {
  const reply = await run('ideas', () => $fetch<{ ideas: PostIdea[] }>('/api/admin/instagram/ideas', {
    method: 'POST', body: { direction: ideaDirection.value, count: ideaCount.value }, timeout: 180_000,
  }))
  if (reply) ideas.value = reply.ideas
}
async function adoptIdea(idea: PostIdea) {
  if (await createPost({ title: idea.title, subject: idea.subject, notes: idea.angle })) {
    ideas.value = ideas.value.filter(i => i !== idea)
  }
}

/* ───────────── La grille du profil ───────────── */

/**
 * Le profil tel qu'il sera : les posts prévus au-dessus, du plus lointain au
 * plus proche, puis ceux déjà en ligne, du plus récent au plus ancien.
 */
const grid = computed(() => {
  const planned = posts.value
    .filter(p => p.status !== 'publie' && p.status !== 'idee' && (p.renders['4x5'] || p.source))
    .sort((a, b) => (b.scheduled_for ?? '9999').localeCompare(a.scheduled_for ?? '9999'))
  const live = posts.value
    .filter(p => p.status === 'publie')
    .sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))
  return [...planned, ...live]
})

const BUSY_LABEL: Record<string, string> = {
  image: 'Peinture en cours — compte une à deux minutes…',
  caption: 'Claude regarde l’image et écrit…',
  ideas: 'Claude cherche des idées…',
  export: 'Export des trois formats…',
  upload: 'Import de l’image…',
  create: 'Création du post…',
  delete: 'Suppression…',
}

const input = 'w-full bg-ink-900/70 border border-steel-600/60 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-400 focus:border-neon-500 focus:outline-none'
const button = 'border border-neon-600/60 px-3 py-1.5 text-xs uppercase tracking-[0.14em] text-neon-300 hover:bg-neon-500/10 disabled:opacity-40 disabled:cursor-not-allowed'
const ghost = 'border border-steel-600/60 px-3 py-1.5 text-xs uppercase tracking-[0.14em] text-ink-200 hover:border-ink-300 disabled:opacity-40 disabled:cursor-not-allowed'
const label = 'font-display text-[10px] uppercase tracking-[0.22em] text-steel-400'
</script>

<template>
  <div class="min-h-[100dvh] px-4 py-8 sm:px-8">
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
          <p class="text-ink-200/85 text-sm leading-relaxed max-w-3xl">
            Un sujet, une image peinte dans le style du jeu, ses trois formats recadrés d’un geste, une légende
            écrite par Claude d’après l’image. Tout s’enregistre dans
            <code class="text-neon-300">communication/instagram/</code>.
          </p>
          <nav class="flex gap-2">
            <button
              v-for="[id, name] in ([['posts', 'Posts'], ['grille', 'Grille du profil'], ['idees', 'Idées']] as const)"
              :key="id"
              :class="[tab === id ? 'border-neon-500 text-neon-300' : 'border-steel-600/60 text-ink-300', 'border px-3 py-1.5 text-xs uppercase tracking-[0.16em]']"
              @click="tab = id"
            >{{ name }}</button>
          </nav>
        </header>

        <!-- ─────────────── Posts ─────────────── -->
        <section v-if="tab === 'posts'" class="grid gap-6 lg:grid-cols-[300px_1fr]">
          <aside class="space-y-4">
            <form class="flex gap-2" @submit.prevent="quickCreate">
              <input v-model="newTitle" :class="input" placeholder="Nouveau post — un titre">
              <button :class="button" :disabled="!newTitle.trim() || !!busy">+</button>
            </form>
            <div class="flex flex-wrap gap-1.5 text-[10px] uppercase tracking-[0.14em]">
              <button
                :class="[filter === 'tous' ? 'border-neon-500 text-neon-300' : 'border-steel-600/60 text-ink-300', 'border px-2 py-0.5']"
                @click="filter = 'tous'"
              >Tous {{ posts.length }}</button>
              <button
                v-for="s in STATUSES" :key="s"
                :class="[filter === s ? 'border-neon-500 text-neon-300' : 'border-steel-600/60 text-ink-300', 'border px-2 py-0.5']"
                @click="filter = s"
              >{{ STATUS[s].label }} {{ countOf(s) }}</button>
            </div>
            <ul class="space-y-1.5 max-h-[70vh] overflow-y-auto pr-1">
              <li v-for="p in visible" :key="p.id">
                <button
                  class="flex w-full items-center gap-3 border p-2 text-left hover:border-neon-600/60"
                  :class="selectedId === p.id ? 'border-neon-500 bg-neon-500/5' : 'border-steel-700'"
                  @click="open(p.id)"
                >
                  <img v-if="thumbOf(p)" :src="thumbOf(p)" alt="" class="h-14 w-11 shrink-0 object-cover bg-ink-800">
                  <span v-else class="h-14 w-11 shrink-0 bg-ink-800 border border-dashed border-steel-600/60" />
                  <span class="min-w-0 space-y-1">
                    <span class="block truncate text-sm text-ink-100">{{ p.title }}</span>
                    <span class="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em]">
                      <span :class="[STATUS[p.status].tone, 'border px-1.5']">{{ STATUS[p.status].label }}</span>
                      <span v-if="p.scheduled_for && p.status !== 'publie'" class="text-ink-300">{{ p.scheduled_for }}</span>
                      <span v-else-if="p.published_at" class="text-ink-400">{{ p.published_at }}</span>
                    </span>
                  </span>
                </button>
              </li>
              <li v-if="!visible.length" class="text-ink-400 text-xs py-4">Aucun post ici.</li>
            </ul>
          </aside>

          <div v-if="!draft" class="border border-dashed border-steel-700 p-10 text-center text-ink-400 text-sm">
            Choisis un post à gauche, crée-en un, ou va chercher des idées.
          </div>

          <article v-else class="space-y-8 min-w-0">
            <!-- Infos -->
            <section class="space-y-4">
              <div class="flex flex-wrap items-start justify-between gap-3">
                <input v-model="draft.title" :class="[input, 'font-display text-lg uppercase tracking-[0.06em] max-w-md']" @input="scheduleSave">
                <span class="text-[10px] uppercase tracking-[0.16em] text-ink-400 pt-3">
                  {{ saveState === 'saved' ? 'Enregistré' : saveState === 'saving' ? 'Enregistrement…' : 'Modifié' }}
                  · {{ draft.id }}
                </span>
              </div>
              <div class="grid gap-3 sm:grid-cols-3">
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
                <label class="space-y-1">
                  <span :class="label">Publié le</span>
                  <input v-model="draft.published_at" type="date" :class="input" @change="scheduleSave">
                </label>
              </div>
              <label class="block space-y-1">
                <span :class="label">Notes — l’angle, ce que le post doit raconter</span>
                <textarea v-model="draft.notes" rows="2" :class="input" @input="scheduleSave" />
              </label>
            </section>

            <!-- Image -->
            <section class="space-y-4 border-t border-steel-700 pt-6">
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
                <select v-model="quality" :class="[input, 'w-auto']">
                  <option value="low">Qualité basse — essai</option>
                  <option value="medium">Qualité moyenne</option>
                  <option value="high">Qualité haute — final</option>
                </select>
                <button :class="button" :disabled="!!busy || !draft.subject.trim()" @click="generate">
                  {{ draft.sources.length ? 'Peindre une variante' : 'Peindre l’image' }}
                </button>
                <label :class="[ghost, 'cursor-pointer']">
                  Importer une image
                  <input type="file" accept="image/png,image/jpeg,image/webp" class="hidden" @change="upload">
                </label>
              </div>
              <div v-if="draft.sources.length" class="flex gap-2 overflow-x-auto pb-1">
                <button
                  v-for="s in draft.sources" :key="s"
                  class="shrink-0 border-2"
                  :class="draft.source === s ? 'border-neon-500' : 'border-transparent opacity-60 hover:opacity-100'"
                  :title="s"
                  @click="pickSource(s)"
                >
                  <img :src="fileUrl(s)" alt="" class="h-28 w-auto bg-ink-800">
                </button>
              </div>
            </section>

            <!-- Formats -->
            <section v-if="draft.source" class="space-y-4 border-t border-steel-700 pt-6">
              <div class="flex flex-wrap items-baseline justify-between gap-2">
                <h2 class="font-display text-[11px] uppercase tracking-[0.28em] text-ink-100">2 · Les formats</h2>
                <span class="text-ink-400 text-[11px]">Source {{ sourceSize || '…' }} — glisse l’aperçu pour recadrer</span>
              </div>
              <div class="grid gap-5 sm:grid-cols-3 items-start">
                <div v-for="f in FORMATS" :key="f.id" class="space-y-2">
                  <p class="flex justify-between text-[10px] uppercase tracking-[0.16em]">
                    <span class="text-ink-100">{{ f.label }}</span>
                    <span class="text-ink-400">{{ f.width }}×{{ f.height }}</span>
                  </p>
                  <canvas
                    :ref="bindCanvas(f.id)"
                    :width="f.width" :height="f.height"
                    class="w-full border border-steel-700 cursor-grab active:cursor-grabbing touch-none"
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
              <button :class="button" :disabled="!!busy || !sourceImage" @click="exportRenders">
                Exporter les trois formats
              </button>
            </section>

            <!-- Légende -->
            <section class="space-y-4 border-t border-steel-700 pt-6">
              <h2 class="font-display text-[11px] uppercase tracking-[0.28em] text-ink-100">3 · La légende</h2>
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
              <label class="block space-y-1">
                <span :class="label">Texte alternatif — Paramètres avancés › Accessibilité</span>
                <textarea v-model="draft.alt" rows="2" :class="input" @input="scheduleSave" />
              </label>
              <div class="flex flex-wrap gap-2">
                <button :class="button" :disabled="!fullCaption" @click="copy(fullCaption, 'Légende et hashtags')">
                  Copier légende + hashtags
                </button>
                <button :class="ghost" :disabled="!draft.alt" @click="copy(draft.alt, 'Texte alternatif')">
                  Copier le texte alternatif
                </button>
              </div>
            </section>

            <footer class="flex flex-wrap justify-between gap-2 border-t border-steel-700 pt-6">
              <button v-if="draft.status !== 'publie'" :class="button" @click="markPublished">Marquer comme publié</button>
              <span v-else />
              <button class="text-xs uppercase tracking-[0.14em] text-red-400/80 hover:text-red-300" :disabled="!!busy" @click="remove">
                Supprimer le post
              </button>
            </footer>
          </article>
        </section>

        <!-- ─────────────── Grille ─────────────── -->
        <section v-else-if="tab === 'grille'" class="space-y-4">
          <p class="text-ink-300 text-sm max-w-2xl">
            Le profil tel qu’il apparaîtra : les posts à venir en haut, puis ceux en ligne. Un clic ouvre le post.
          </p>
          <div class="mx-auto grid max-w-xl grid-cols-3 gap-0.5 bg-ink-800">
            <button v-for="p in grid" :key="p.id" class="relative aspect-[3/4] overflow-hidden bg-ink-900" @click="open(p.id)">
              <img :src="thumbOf(p)" :alt="p.alt || p.title" class="h-full w-full object-cover">
              <span
                v-if="p.status !== 'publie'"
                class="absolute left-1 top-1 bg-ink-900/85 px-1.5 text-[9px] uppercase tracking-[0.12em] text-neon-300"
              >{{ p.scheduled_for ?? STATUS[p.status].label }}</span>
            </button>
          </div>
          <p v-if="!grid.length" class="text-ink-400 text-sm">Rien à montrer : aucun post n’a encore d’image.</p>
        </section>

        <!-- ─────────────── Idées ─────────────── -->
        <section v-else class="space-y-5">
          <div class="flex flex-wrap gap-2">
            <input
              v-model="ideaDirection" :class="[input, 'flex-1 min-w-[220px]']"
              placeholder="Une piste ? Les personnages, l’attente avant la sortie, les objets…"
            >
            <select v-model.number="ideaCount" :class="[input, 'w-auto']">
              <option v-for="n in [3, 6, 9, 12]" :key="n" :value="n">{{ n }} idées</option>
            </select>
            <button :class="button" :disabled="!!busy" @click="proposeIdeas">Proposer</button>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <div v-for="idea in ideas" :key="idea.title + idea.subject" class="border border-steel-700 p-4 space-y-2">
              <p class="font-display uppercase tracking-[0.08em] text-ink-100">{{ idea.title }}</p>
              <p class="text-ink-200 text-sm">{{ idea.angle }}</p>
              <p class="text-ink-400 text-xs italic">{{ idea.subject }}</p>
              <button :class="button" :disabled="!!busy" @click="adoptIdea(idea)">Créer le post</button>
            </div>
          </div>
          <p v-if="!ideas.length" class="text-ink-400 text-sm">
            Claude part du jeu et des posts déjà faits, et propose des sujets prêts à peindre.
          </p>
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

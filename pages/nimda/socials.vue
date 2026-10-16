<script setup lang="ts">
/**
 * Publier sur les réseaux depuis le poste : un onglet par réseau, avec tous
 * les formats que son API permet, et un onglet Info qui lit l'état des
 * branchements et répare ce qui peut l'être (server/api/admin/socials/scan.ts).
 *
 * La page se dessine d'après les formats décrits côté serveur (server/socials) :
 * un format dit s'il a un texte, un titre, des médias (fichiers ou adresses
 * publiques) et des options. Le texte, le titre et les médias restent d'un
 * onglet à l'autre, pour décliner un même post sur plusieurs réseaux.
 */

// Voir middleware/admin.ts : la page n'existe qu'en local.
definePageMeta({ middleware: 'admin' })

const { data: board, refresh } = await useFetch('/api/admin/socials')
type Board = NonNullable<typeof board.value>
type Net = Board['networks'][number]
type Fmt = Net['formats'][number]
type Entry = Board['journal'][number]

const route = useRoute()
const router = useRouter()
const tab = ref(typeof route.query.tab === 'string' ? route.query.tab : 'instagram')
watch(tab, t => router.replace({ query: { tab: t } }))

const net = computed<Net | null>(() => board.value?.networks.find(n => n.id === tab.value) ?? null)
const chosen = reactive<Record<string, string>>({})
const fmt = computed<Fmt | null>(() => {
  const n = net.value
  return n ? n.formats.find(f => f.id === chosen[n.id]) ?? n.formats[0] ?? null : null
})

const reason = (e: unknown) => {
  const err = e as { data?: { statusMessage?: string }; statusMessage?: string; message?: string }
  return err.data?.statusMessage ?? err.statusMessage ?? err.message ?? 'échec'
}
const when = (iso: string) => new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' })
const label = (id: string) => board.value?.networks.find(n => n.id === id)?.label ?? id
const formatLabel = (network: string, id: string) => board.value?.networks.find(n => n.id === network)?.formats.find(f => f.id === id)?.label ?? id

/* Le brouillon */

const text = ref('')
const title = ref('')
const urls = ref('')
type Pick = { file: File; src: string; kind: 'image' | 'video' | null }
const picks = ref<Pick[]>([])

/** Les options par réseau et par format : « privacy » n'a pas les mêmes valeurs sur TikTok et YouTube. */
const optionsBy = reactive<Record<string, Record<string, string | boolean>>>({})
watch([net, fmt], ([n, f]) => {
  if (n && f) optionsBy[`${n.id}.${f.id}`] ??= Object.fromEntries((f.options ?? []).map(o => [o.id, o.default]))
}, { immediate: true })
const opts = computed(() => (net.value && fmt.value && optionsBy[`${net.value.id}.${fmt.value.id}`]) || {})

function take(files: FileList | null | undefined) {
  for (const file of files ?? []) {
    picks.value.push({ file, src: URL.createObjectURL(file), kind: file.type.startsWith('video/') ? 'video' : file.type.startsWith('image/') ? 'image' : null })
  }
}
function pick(e: Event) {
  const input = e.target as HTMLInputElement
  take(input.files)
  input.value = ''
}
function remove(i: number) {
  URL.revokeObjectURL(picks.value[i]!.src)
  picks.value.splice(i, 1)
}
function move(i: number, by: number) {
  const j = i + by
  if (j < 0 || j >= picks.value.length) return
  const list = picks.value
  ;[list[i], list[j]] = [list[j]!, list[i]!]
}
onBeforeUnmount(() => picks.value.forEach(p => URL.revokeObjectURL(p.src)))

const urlList = computed(() => urls.value.split('\n').map(l => l.trim()).filter(Boolean))
const sent = computed(() => {
  const m = fmt.value?.media
  return { files: m?.files ? picks.value : [], urls: m?.urls ? urlList.value : [] }
})
const count = computed(() => sent.value.files.length + sent.value.urls.length)
const accept = computed(() => (fmt.value?.media?.kinds ?? []).map(k => `${k}/*`).join(','))
const kinds = computed(() => (fmt.value?.media?.kinds ?? []).map(k => k === 'image' ? 'images' : 'vidéos').join(' ou '))
const size = (b: number) => `${(b / 1024 / 1024).toFixed(1)} Mo`

/** Ce qui empêche d'envoyer ; le serveur vérifie la même chose. */
const problems = computed(() => {
  const f = fmt.value
  if (!f) return []
  const out: string[] = []
  if (f.media) {
    const { min, max } = f.media
    if (count.value < min || count.value > max) out.push(`${min === max ? min : `De ${min} à ${max}`} média(s) attendu(s), ${count.value} prêt(s).`)
    for (const p of sent.value.files) {
      if (!p.kind) out.push(`${p.file.name} : ni image ni vidéo.`)
      else if (!(f.media.kinds as string[]).includes(p.kind)) out.push(`${p.file.name} : ce format ne prend pas de ${p.kind === 'video' ? 'vidéo' : 'image'}.`)
    }
  }
  if (f.text?.required && !text.value.trim()) out.push(`${f.text.label} manquant.`)
  if (f.text && text.value.trim().length > f.text.max) out.push(`${f.text.label} : ${text.value.trim().length} signes pour ${f.text.max} au plus.`)
  if (f.title?.required && !title.value.trim()) out.push(`${f.title.label} manquant.`)
  if (f.title && title.value.trim().length > f.title.max) out.push(`${f.title.label} trop long.`)
  return out
})

const sending = ref(false)
const outcome = ref<{ entry?: Entry; error?: string } | null>(null)
watch([tab, fmt], () => { outcome.value = null })

async function publish() {
  const n = net.value
  const f = fmt.value
  if (!n || !f || problems.value.length) return
  if (!confirm(`Publier sur ${n.label}, format ${f.label} ?`)) return
  sending.value = true
  outcome.value = null
  const body = new FormData()
  body.set('network', n.id)
  body.set('format', f.id)
  if (f.text) body.set('text', text.value)
  if (f.title) body.set('title', title.value)
  body.set('options', JSON.stringify(opts.value))
  body.set('urls', sent.value.urls.join('\n'))
  for (const p of sent.value.files) body.append('files', p.file, p.file.name)
  try {
    outcome.value = { entry: await $fetch<Entry>('/api/admin/socials/publish', { method: 'POST', body }) }
  } catch (e) {
    outcome.value = { error: reason(e) }
  } finally {
    sending.value = false
    refresh()
  }
}

/* Développer : le champ devient un post fini, écrit par l'IA (server/socials/develop.ts) */

const developing = ref(false)
const developError = ref('')
/** Le brouillon d'avant le dernier développement, pour « Annuler ». */
const before = ref<{ text: string; title: string } | null>(null)
watch([tab, fmt], () => { developError.value = '' })

const once = (el: HTMLElement, name: string, ms: number) => new Promise<void>((ok, ko) => {
  const t = setTimeout(() => ko(new Error(name)), ms)
  el.addEventListener(name, () => { clearTimeout(t); ok() }, { once: true })
  el.addEventListener('error', () => { clearTimeout(t); ko(new Error('error')) }, { once: true })
})

/** Ce que l'IA voit d'un média : un JPEG de 1024 px au plus, en base64 ; une vidéo donne sa première image. */
async function still(p: Pick): Promise<string | null> {
  try {
    let source: CanvasImageSource
    let w: number
    let h: number
    if (p.kind === 'image') {
      const bitmap = await createImageBitmap(p.file)
      source = bitmap
      w = bitmap.width
      h = bitmap.height
    } else {
      const v = document.createElement('video')
      v.muted = true
      v.preload = 'auto'
      v.src = p.src
      await once(v, 'loadeddata', 8000)
      v.currentTime = Math.min(0.1, v.duration || 0)
      await once(v, 'seeked', 4000)
      source = v
      w = v.videoWidth
      h = v.videoHeight
    }
    const scale = Math.min(1, 1024 / Math.max(w, h))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(w * scale)
    canvas.height = Math.round(h * scale)
    canvas.getContext('2d')!.drawImage(source, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.8).split(',')[1] ?? null
  } catch {
    return null
  }
}

async function develop() {
  const n = net.value
  const f = fmt.value
  if (!n || !f?.text || !text.value.trim()) return
  developing.value = true
  developError.value = ''
  try {
    const media = [
      ...sent.value.files.map(p => p.kind).filter(Boolean),
      ...sent.value.urls.map(u => /\.(mp4|mov|m4v|webm)(\?|$)/i.test(u) ? 'video' : 'image'),
    ]
    const images = (await Promise.all(sent.value.files.filter(p => p.kind).slice(0, 4).map(still))).filter(Boolean)
    const r = await $fetch<{ text: string; title: string | null }>('/api/admin/socials/develop', {
      method: 'POST',
      body: { network: n.id, format: f.id, text: text.value, title: f.title ? title.value : '', media, images },
    })
    before.value = { text: text.value, title: title.value }
    text.value = r.text
    if (r.title) title.value = r.title
  } catch (e) {
    developError.value = reason(e)
  } finally {
    developing.value = false
  }
}
function undo() {
  if (!before.value) return
  text.value = before.value.text
  title.value = before.value.title
  before.value = null
}

const recent = computed(() => (board.value?.journal ?? []).filter(e => e.network === tab.value).slice(0, 6))

/* Brancher un compte */

const pasted = ref('')
const connecting = ref(false)
const connectError = ref('')
async function authorize(id: string) {
  connectError.value = ''
  try {
    const { url } = await $fetch<{ url: string }>('/api/admin/socials/connect', { query: { network: id } })
    window.location.href = url
  } catch (e) {
    connectError.value = reason(e)
  }
}
async function connect(body: { url?: string; code?: string; state?: string }) {
  connecting.value = true
  connectError.value = ''
  try {
    const r = await $fetch<{ network: string }>('/api/admin/socials/connect', { method: 'POST', body })
    pasted.value = ''
    tab.value = r.network
    await refresh()
  } catch (e) {
    connectError.value = reason(e)
  } finally {
    connecting.value = false
  }
}

/* L'onglet Info */

type Scan = { networks: { id: string; label: string; account?: string; checks: { id: string; label: string; state: 'ok' | 'warn' | 'bad' | 'off'; detail: string; fix?: string; connect?: boolean }[] }[]; journal: Entry[]; at: string }
const scan = ref<Scan | null>(null)
const scanning = ref(false)
const scanError = ref('')
async function runScan() {
  scanning.value = true
  scanError.value = ''
  try {
    scan.value = await $fetch<Scan>('/api/admin/socials/scan', { timeout: 120_000 })
  } catch (e) {
    scanError.value = reason(e)
  } finally {
    scanning.value = false
  }
}
watch(tab, (t) => { if (t === 'info' && !scan.value && !scanning.value) runScan() })

const FIX: Record<string, string> = { refresh: 'Renouveler', pending: 'Achever', forget: 'Débrancher' }
const repairing = ref('')
const notes = ref<{ at: string; text: string; bad?: boolean }[]>([])
async function repair(network: string, fix: string) {
  repairing.value = `${network}.${fix}`
  try {
    const { message } = await $fetch<{ message: string }>('/api/admin/socials/scan', { method: 'POST', body: { network, fix } })
    notes.value.unshift({ at: new Date().toISOString(), text: message })
  } catch (e) {
    notes.value.unshift({ at: new Date().toISOString(), text: reason(e), bad: true })
  } finally {
    repairing.value = ''
  }
}
async function repairOne(network: string, fix: string) {
  if (fix === 'forget' && !confirm(`Oublier le jeton ${label(network)} ? Il faudra rebrancher le compte.`)) return
  await repair(network, fix)
  await Promise.all([runScan(), refresh()])
}
/** Tout ce qui se répare sans geste : renouveler les jetons, achever les publications prêtes. */
const fixable = computed(() => {
  const seen = new Map<string, { network: string; fix: string }>()
  for (const n of scan.value?.networks ?? []) {
    for (const c of n.checks) if (c.fix && c.fix !== 'forget') seen.set(`${n.id}.${c.fix}`, { network: n.id, fix: c.fix })
  }
  return [...seen.values()]
})
async function repairAll() {
  for (const { network, fix } of fixable.value) await repair(network, fix)
  await Promise.all([runScan(), refresh()])
}
const journal = computed(() => scan.value?.journal ?? board.value?.journal ?? [])
const oauthConnected = (id: string) => {
  const n = board.value?.networks.find(x => x.id === id)
  return !!n?.setup.oauth && n.connected
}

onMounted(() => {
  const { code, state, error, error_description: described } = route.query
  if (typeof code === 'string' && typeof state === 'string') {
    tab.value = state.split('.')[0] || tab.value
    router.replace({ query: { tab: tab.value } })
    connect({ code, state })
  } else if (typeof error === 'string') {
    connectError.value = `Autorisation refusée : ${typeof described === 'string' ? described : error}`
    router.replace({ query: { tab: tab.value } })
  }
  if (tab.value === 'info') runScan()
})
</script>

<template>
  <div class="socials">
    <header class="top">
      <div>
        <p class="eyebrow">Admin — réseaux</p>
        <h1 class="name">Réseaux sociaux</h1>
      </div>
      <nav class="tabs" role="tablist">
        <button
          v-for="n in board?.networks"
          :key="n.id"
          type="button"
          role="tab"
          :aria-selected="tab === n.id"
          :class="['tab', { on: tab === n.id }]"
          @click="tab = n.id"
        >
          <span class="pill" :class="n.connected ? 'good' : n.ready ? 'warn' : 'muted'" />{{ n.label }}
        </button>
        <button type="button" role="tab" :aria-selected="tab === 'info'" :class="['tab', { on: tab === 'info' }]" @click="tab = 'info'">
          Info
        </button>
      </nav>
    </header>

    <main class="wrap">
      <!-- Un réseau : le brouillon à gauche, le branchement et les derniers envois à droite -->
      <section v-if="net && fmt" class="cols">
        <div class="panel">
          <div class="chips" role="radiogroup" :aria-label="`Formats ${net.label}`">
            <button
              v-for="f in net.formats"
              :key="f.id"
              type="button"
              role="radio"
              :aria-checked="fmt.id === f.id"
              :class="['chip', { on: fmt.id === f.id }]"
              @click="chosen[net.id] = f.id"
            >
              {{ f.label }}
            </button>
          </div>
          <p v-if="fmt.note" class="muted small">{{ fmt.note }}</p>

          <label v-if="fmt.title" class="field">
            <span class="k">{{ fmt.title.label }}<em :class="{ bad: title.trim().length > fmt.title.max }">{{ title.trim().length }} / {{ fmt.title.max }}</em></span>
            <input v-model="title" type="text">
          </label>

          <template v-if="fmt.text">
            <label class="field">
              <span class="k">{{ fmt.text.label }}<em :class="{ bad: text.trim().length > fmt.text.max }">{{ text.trim().length }} / {{ fmt.text.max }}</em></span>
              <textarea v-model="text" rows="8" :disabled="developing" />
            </label>
            <div class="assist">
              <button type="button" class="btn" :disabled="developing || !text.trim()" @click="develop">
                {{ developing ? 'L’IA écrit…' : 'Développer' }}
              </button>
              <button v-if="before && !developing" type="button" class="btn" @click="undo">Annuler</button>
              <span v-if="developError" class="bad small">{{ developError }}</span>
              <span v-else-if="!text.trim()" class="muted small">Quelques mots suffisent : l’IA les développe pour {{ net.label }} · {{ fmt.label }}{{ picks.length && fmt.media ? ', en voyant les images' : '' }}.</span>
            </div>
          </template>
          <p v-else-if="text.trim()" class="muted small">Ce format ne prend pas de texte : il reste gardé pour les autres.</p>

          <div v-if="fmt.media" class="field">
            <span class="k">Médias<em>{{ count }} / {{ fmt.media.min === fmt.media.max ? fmt.media.max : `${fmt.media.min}–${fmt.media.max}` }}</em></span>
            <label v-if="fmt.media.files" class="drop" @dragover.prevent @drop.prevent="take($event.dataTransfer?.files)">
              <input type="file" multiple :accept="accept" class="sr" @change="pick">
              Déposer ou choisir des {{ kinds }}
            </label>
            <ol v-if="sent.files.length" class="picks">
              <li
                v-for="(p, i) in sent.files"
                :key="p.src"
                :class="{ odd: !p.kind || !(fmt.media.kinds as string[]).includes(p.kind) }"
              >
                <video v-if="p.kind === 'video'" :src="p.src" muted preload="metadata" />
                <img v-else-if="p.kind === 'image'" :src="p.src" alt="">
                <span v-else class="thumb-x">?</span>
                <span class="pick-name">{{ i + 1 }}. {{ p.file.name }}<small>{{ size(p.file.size) }}</small></span>
                <span class="pick-tools">
                  <button type="button" :disabled="i === 0" aria-label="Avancer" @click="move(i, -1)">←</button>
                  <button type="button" :disabled="i === sent.files.length - 1" aria-label="Reculer" @click="move(i, 1)">→</button>
                  <button type="button" aria-label="Retirer" @click="remove(i)">×</button>
                </span>
              </li>
            </ol>
            <p v-if="!fmt.media.files && picks.length" class="muted small">Les fichiers choisis ne partent pas dans ce format.</p>
            <label v-if="fmt.media.urls" class="field">
              <span class="k">Adresses publiques, une par ligne<em>.mp4 .mov .webm = vidéo</em></span>
              <textarea v-model="urls" rows="2" />
            </label>
          </div>
          <p v-else-if="picks.length || urlList.length" class="muted small">Ce format ne prend pas de média : les fichiers restent gardés pour les autres.</p>

          <div v-if="fmt.options?.length" class="opts">
            <template v-for="o in fmt.options" :key="o.id">
              <label v-if="o.type === 'check'" class="check">
                <input v-model="opts[o.id]" type="checkbox"> {{ o.label }}
              </label>
              <label v-else-if="o.type === 'select'" class="field">
                <span class="k">{{ o.label }}</span>
                <select v-model="opts[o.id]">
                  <option v-for="c in ('choices' in o ? o.choices : [])" :key="c.value" :value="c.value">{{ c.label }}</option>
                </select>
              </label>
              <label v-else-if="o.type === 'lines'" class="field">
                <span class="k">{{ o.label }}</span>
                <textarea v-model="opts[o.id]" rows="4" />
              </label>
              <label v-else class="field">
                <span class="k">{{ o.label }}</span>
                <input v-model="opts[o.id]" type="text">
              </label>
            </template>
          </div>

          <ul v-if="problems.length" class="problems">
            <li v-for="p in problems" :key="p">{{ p }}</li>
          </ul>
          <button type="button" class="publish" :disabled="sending || !!problems.length || !net.connected" @click="publish">
            {{ sending ? 'Envoi en cours…' : !net.connected ? `${net.label} à brancher` : `Publier sur ${net.label} · ${fmt.label}` }}
          </button>
          <p v-if="sending" class="muted small">Les vidéos montent puis le réseau les traite : ça peut prendre quelques minutes, ne pas fermer la page.</p>
          <p v-if="outcome?.error" class="bad">{{ outcome.error }}</p>
          <p v-else-if="outcome?.entry" :class="outcome.entry.state === 'done' ? 'good' : 'warn'">
            {{ outcome.entry.state === 'done' ? 'Publié.' : 'Envoyé, le réseau termine.' }}
            {{ outcome.entry.detail }}
            <a v-if="outcome.entry.url" :href="outcome.entry.url" target="_blank" rel="noopener" class="link">voir →</a>
          </p>
        </div>

        <aside class="panel">
          <h2>{{ net.label }} <span>{{ net.connected ? 'branché' : net.ready ? 'à brancher' : 'identifiants manquants' }}</span></h2>

          <template v-if="!net.connected">
            <ol class="steps">
              <li v-for="s in net.setup.steps" :key="s">{{ s }}</li>
            </ol>
            <p class="small">Au .env : <code v-for="e in net.setup.env" :key="e" class="env">{{ e }}</code></p>
            <p v-if="net.setup.redirect" class="small">Adresse de retour à déclarer : <code class="select">{{ net.setup.redirect }}</code></p>
            <template v-if="net.setup.oauth && net.ready">
              <button type="button" class="btn" @click="authorize(net.id)">Brancher {{ net.label }} →</button>
              <form class="paste" @submit.prevent="connect({ url: pasted })">
                <input v-model="pasted" type="url" :aria-label="`Adresse où ${net.label} est revenu`">
                <button type="submit" class="btn" :disabled="!pasted || connecting">{{ connecting ? '…' : 'Coller le retour' }}</button>
              </form>
              <p class="muted small">Si le réseau revient ailleurs qu’ici, coller l’adresse complète de la barre.</p>
            </template>
            <p v-else-if="!net.ready" class="muted small">La page relit le .env à chaque chargement ; relancer nuxt dev s’il ne le voit pas.</p>
          </template>
          <p v-else class="muted small">L’état détaillé (jeton, permissions, quotas) est dans l’onglet <a href="#" class="link" @click.prevent="tab = 'info'">Info</a>.</p>
          <p v-if="connectError" class="bad small">{{ connectError }}</p>

          <h2 class="sub">Derniers envois</h2>
          <p v-if="!recent.length" class="muted small">Rien encore.</p>
          <ul v-else class="wire">
            <li v-for="e in recent" :key="e.id">
              <span class="t">{{ when(e.at) }}</span>
              <span class="tag" :class="e.state === 'done' ? 'good' : e.state === 'pending' ? 'warn' : 'bad'">{{ formatLabel(e.network, e.format) }}</span>
              <span>{{ e.excerpt }}</span>
              <span v-if="e.detail" class="muted small"> — {{ e.detail }}</span>
              <a v-if="e.url" :href="e.url" target="_blank" rel="noopener" class="link"> voir</a>
            </li>
          </ul>
        </aside>
      </section>

      <!-- Info : l'état de chaque réseau et ce qui se répare -->
      <section v-else-if="tab === 'info'" class="info">
        <div class="bar">
          <button type="button" class="btn" :disabled="scanning" @click="runScan">{{ scanning ? 'Lecture…' : 'Scanner' }}</button>
          <button type="button" class="btn" :disabled="scanning || !!repairing || !fixable.length" @click="repairAll">
            Tout réparer{{ fixable.length ? ` (${fixable.length})` : '' }}
          </button>
          <span v-if="scan" class="muted small">lu à {{ when(scan.at) }}</span>
          <span v-if="scanError" class="bad small">{{ scanError }}</span>
        </div>
        <ul v-if="notes.length" class="notes">
          <li v-for="n in notes.slice(0, 6)" :key="n.at + n.text" :class="n.bad ? 'bad' : 'good'"><span class="t">{{ when(n.at) }}</span> {{ n.text }}</li>
        </ul>

        <div class="cards">
          <article v-for="n in scan?.networks ?? []" :key="n.id" class="panel">
            <h2>
              <span class="pill" :class="n.checks.some(c => c.state === 'bad') ? 'bad' : n.checks.some(c => c.state === 'warn') ? 'warn' : n.checks.every(c => c.state === 'off') ? 'muted' : 'good'" />{{ n.label }}
              <span>{{ n.account ?? '' }}</span>
            </h2>
            <ul class="checks">
              <li v-for="c in n.checks" :key="c.id">
                <span class="state" :class="{ ok: 'good', warn: 'warn', bad: 'bad', off: 'muted' }[c.state]">{{ { ok: 'OK', warn: 'À voir', bad: 'Bloqué', off: 'Absent' }[c.state] }}</span>
                <span class="k">{{ c.label }}</span>
                <span class="detail">{{ c.detail }}</span>
                <span class="actions">
                  <button v-if="c.fix" type="button" class="btn" :disabled="!!repairing" @click="repairOne(n.id, c.fix)">
                    {{ repairing === `${n.id}.${c.fix}` ? '…' : FIX[c.fix] }}
                  </button>
                  <button v-if="c.connect" type="button" class="btn" @click="authorize(n.id)">Rebrancher</button>
                  <button v-if="c.state === 'off'" type="button" class="btn" @click="tab = n.id">Brancher</button>
                </span>
              </li>
            </ul>
            <button v-if="oauthConnected(n.id)" type="button" class="link small forget" :disabled="!!repairing" @click="repairOne(n.id, 'forget')">Débrancher</button>
          </article>
          <p v-if="!scan && scanning" class="muted">Lecture des réseaux…</p>
        </div>

        <div class="panel">
          <h2>Journal <span>{{ journal.length }} envois gardés</span></h2>
          <p v-if="!journal.length" class="muted small">Rien encore.</p>
          <div v-else class="scroll">
            <table class="tbl">
              <thead>
                <tr><th>Quand</th><th>Réseau</th><th>Format</th><th>Post</th><th>État</th><th /></tr>
              </thead>
              <tbody>
                <tr v-for="e in journal" :key="e.id">
                  <td class="t">{{ when(e.at) }}</td>
                  <td>{{ label(e.network) }}</td>
                  <td>{{ formatLabel(e.network, e.format) }}</td>
                  <td>{{ e.excerpt }}</td>
                  <td :class="e.state === 'done' ? 'good' : e.state === 'pending' ? 'warn' : 'bad'">
                    {{ { done: 'en ligne', pending: 'en cours', failed: 'échec' }[e.state] }}<span v-if="e.detail" class="muted"> — {{ e.detail }}</span>
                  </td>
                  <td><a v-if="e.url" :href="e.url" target="_blank" rel="noopener" class="link">voir</a></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.socials {
  --up: #3ddc84;
  --down: #ff5c5c;
  --warn: #ffb547;
  --panel: rgba(255, 255, 255, 0.025);
  --line: rgba(255, 255, 255, 0.09);
  --muted: rgb(var(--ink-300));
  min-height: 100dvh;
  background: #05070a;
  color: rgb(var(--ink-100));
  font-size: 13px;
}

.eyebrow, .k, .panel h2, .tab, .chip, .state {
  font-family: Futura, 'Avenir Next', 'Century Gothic', 'Trebuchet MS', system-ui, sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.18em;
}

.top {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 24px 0;
  border-bottom: 1px solid var(--line);
  background: linear-gradient(#0a0d12, #05070a);
}
.eyebrow { font-size: 10px; color: rgb(var(--neon-400) / 0.8); letter-spacing: 0.4em; }
.name { font-size: 20px; letter-spacing: 0.12em; margin: 4px 0 14px; }

.tabs { display: flex; gap: 2px; overflow-x: auto; max-width: 100%; }
.tab { font-size: 11px; padding: 10px 14px; color: var(--muted); border-bottom: 2px solid transparent; white-space: nowrap; display: inline-flex; align-items: center; }
.tab:hover { color: rgb(var(--ink-100)); }
.tab.on { color: rgb(var(--neon-300)); border-bottom-color: rgb(var(--neon-400)); }
.pill { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: currentColor; box-shadow: 0 0 6px currentColor; margin-right: 8px; flex: none; }

.good { color: var(--up); }
.bad { color: var(--down); }
.warn { color: var(--warn); }
.muted { color: var(--muted); }
.small { font-size: 11px; }

.wrap { padding: 20px 24px 40px; }
.cols { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 20px; align-items: start; }
@media (max-width: 900px) { .cols { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 600px) {
  .top, .wrap { padding-left: 16px; padding-right: 16px; }
}

.panel { background: var(--panel); border: 1px solid var(--line); padding: 14px 16px; display: grid; gap: 12px; align-content: start; min-width: 0; }
.panel h2 { font-size: 11px; display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: center; }
.panel h2 span:not(.pill) { font-size: 9px; color: var(--muted); letter-spacing: 0.14em; }
.panel h2.sub { margin-top: 8px; }

.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { font-size: 10px; padding: 6px 12px; border: 1px solid var(--line); color: rgb(var(--ink-200)); }
.chip:hover { border-color: rgb(var(--neon-500) / 0.5); }
.chip.on { border-color: rgb(var(--neon-400)); color: rgb(var(--neon-300)); background: rgb(var(--neon-500) / 0.08); }

.field { display: grid; gap: 6px; }
.k { font-size: 9px; color: var(--muted); display: flex; justify-content: space-between; gap: 12px; }
.k em { font-style: normal; letter-spacing: 0.06em; text-transform: none; }
.k em.bad { color: var(--down); }
input[type='text'], input[type='url'], textarea, select {
  width: 100%;
  background: rgb(var(--ink-800) / 0.5);
  border: 0;
  border-bottom: 1px solid rgb(var(--steel-600));
  padding: 8px 10px;
  color: rgb(var(--ink-100));
  font: inherit;
  outline: none;
}
textarea { resize: vertical; line-height: 1.5; }
input:focus, textarea:focus, select:focus { border-bottom-color: rgb(var(--neon-400)); }
select option { background: #0a0d12; }

.drop { border: 1px dashed rgb(var(--steel-600)); padding: 18px; text-align: center; color: rgb(var(--ink-200)); cursor: pointer; }
.drop:hover { border-color: rgb(var(--neon-400)); color: rgb(var(--neon-300)); }
.sr { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }

.picks { display: grid; gap: 6px; }
.picks li { display: grid; grid-template-columns: 56px minmax(0, 1fr) auto; gap: 10px; align-items: center; border: 1px solid var(--line); padding: 4px; }
.picks li.odd { border-color: rgb(255 92 92 / 0.5); }
.picks img, .picks video, .thumb-x { width: 56px; height: 56px; object-fit: cover; background: #000; display: grid; place-items: center; }
.pick-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pick-name small { color: var(--muted); margin-left: 8px; }
.pick-tools { display: flex; gap: 2px; }
.pick-tools button { width: 26px; height: 26px; border: 1px solid var(--line); color: rgb(var(--ink-200)); }
.pick-tools button:hover:not(:disabled) { border-color: rgb(var(--neon-500) / 0.6); }
.pick-tools button:disabled { opacity: 0.3; }

.opts { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 10px 16px; align-items: end; }
.check { display: flex; gap: 8px; align-items: center; color: rgb(var(--ink-200)); }
.check input { accent-color: rgb(var(--neon-400)); }

.assist { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: -4px; }
.problems { color: var(--warn); font-size: 12px; display: grid; gap: 2px; }
.publish {
  font-family: Futura, 'Avenir Next', 'Century Gothic', 'Trebuchet MS', system-ui, sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-size: 11px;
  padding: 12px;
  border: 1px solid rgb(var(--neon-400));
  color: rgb(var(--neon-300));
  background: rgb(var(--neon-500) / 0.1);
}
.publish:hover:not(:disabled) { background: rgb(var(--neon-500) / 0.2); }
.publish:disabled { opacity: 0.4; border-color: var(--line); color: var(--muted); background: none; }

.btn { border: 1px solid var(--line); padding: 4px 10px; font-size: 11px; color: rgb(var(--ink-200)); white-space: nowrap; justify-self: start; }
.btn:hover:not(:disabled) { border-color: rgb(var(--neon-500) / 0.6); }
.btn:disabled { opacity: 0.5; }
.link { color: rgb(var(--neon-300)); }
.link:hover { text-decoration: underline; text-underline-offset: 4px; }
code { font-family: 'Courier New', monospace; color: rgb(var(--neon-300) / 0.9); font-size: 12px; word-break: break-all; }
code.env { margin-right: 10px; }
.select { user-select: all; }

.steps { list-style: decimal; padding-left: 18px; display: grid; gap: 6px; color: rgb(var(--ink-200)); line-height: 1.5; }
.paste { display: flex; gap: 8px; }
.paste input { flex: 1; min-width: 0; }

.wire { display: grid; gap: 6px; }
.wire > li { border-top: 1px solid var(--line); padding-top: 6px; line-height: 1.5; }
.wire > li > * { margin-right: 6px; }
.tag { font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; border: 1px solid currentColor; padding: 0 5px; }
.t { color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }

.info { display: grid; gap: 20px; }
.bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.notes { display: grid; gap: 2px; font-size: 12px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 380px), 1fr)); gap: 16px; }
.checks { display: grid; gap: 0; }
.checks li { display: grid; grid-template-columns: 64px 110px minmax(0, 1fr); gap: 4px 10px; align-items: baseline; border-top: 1px solid var(--line); padding: 7px 0; }
.checks .actions { grid-column: 3; display: flex; flex-wrap: wrap; gap: 6px; }
.checks .actions:empty { display: none; }
.checks .detail { color: rgb(var(--ink-200)); line-height: 1.45; }
.state { font-size: 9px; letter-spacing: 0.12em; }
.forget { justify-self: end; font-size: 11px; }
@media (max-width: 600px) {
  .checks li { grid-template-columns: 56px minmax(0, 1fr); }
  .checks .detail, .checks .actions { grid-column: 1 / -1; }
}

.scroll { overflow-x: auto; }
.tbl { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.tbl th { text-align: left; font-weight: normal; font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); padding: 4px 8px 6px 0; }
.tbl td { border-top: 1px solid var(--line); padding: 5px 8px 5px 0; vertical-align: top; }
</style>

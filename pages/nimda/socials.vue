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

// Voir middleware/admin.ts : en production, derrière le mot de passe (utils/admin-access.ts).
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
    if (n.id === 'x') loadCredits()
  }
}

/** Un post refusé repart tel que le serveur l'a gardé (retry.post.ts) : sa ligne rouge passe au vert. */
async function retry(e: Entry) {
  if (sending.value || !confirm(`Relancer sur ${label(e.network)} : « ${e.excerpt} » ?`)) return
  sending.value = true
  outcome.value = null
  try {
    outcome.value = { entry: await $fetch<Entry>('/api/admin/socials/retry', { method: 'POST', body: { id: e.id } }) }
  } catch (err) {
    outcome.value = { error: reason(err) }
  } finally {
    sending.value = false
    refresh()
    if (e.network === 'x') loadCredits()
  }
}

/* Développer : le champ devient un post fini, écrit par l'IA (server/socials/develop.ts) */

const developing = ref(false)
const developError = ref('')
/** Le texte d'avant chaque passage de l'IA (développer, corriger), pour « Annuler ». */
const undos = ref<{ text: string; title: string }[]>([])
/** La consigne de « Corriger », offert une fois le texte développé ; vide = relecture. */
const fixNote = ref('')
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

async function develop(fix?: string) {
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
      body: { network: n.id, format: f.id, text: text.value, title: f.title ? title.value : '', media, images, fix },
    })
    undos.value.push({ text: text.value, title: title.value })
    text.value = r.text
    if (r.title) title.value = r.title
    if (fix !== undefined) fixNote.value = ''
  } catch (e) {
    developError.value = reason(e)
  } finally {
    developing.value = false
  }
}
function undo() {
  const last = undos.value.pop()
  if (!last) return
  text.value = last.text
  title.value = last.title
}

const recent = computed(() => (board.value?.journal ?? []).filter(e => e.network === tab.value).slice(0, 6))

/* Les posts du compte et leurs pubs Meta (server/socials/ads.ts), dans les onglets Instagram et Facebook */

const metaNet = computed(() => tab.value === 'instagram' || tab.value === 'facebook' ? tab.value : null)
const fetchAds = (network: 'instagram' | 'facebook') => $fetch('/api/admin/socials/ads', { query: { network } })
type AdsBoard = Awaited<ReturnType<typeof fetchAds>>
type AdPost = AdsBoard['posts'][number]
type Promo = AdPost['ads'][number]
const adsBoard = ref<AdsBoard | null>(null)
const adsLoading = ref(false)
const adsError = ref('')
async function loadAds() {
  const n = metaNet.value
  if (!n || !net.value?.connected) return
  adsLoading.value = true
  adsError.value = ''
  try {
    const r = await fetchAds(n)
    if (metaNet.value === n) adsBoard.value = r
  } catch (e) {
    adsError.value = reason(e)
  } finally {
    adsLoading.value = false
  }
}
const AD_STATUS: Record<string, string> = {
  ACTIVE: 'active', PAUSED: 'en pause', CAMPAIGN_PAUSED: 'en pause', ADSET_PAUSED: 'en pause', IN_PROCESS: 'en examen', PENDING_REVIEW: 'en examen',
  PREAPPROVED: 'pré-approuvée', DISAPPROVED: 'refusée', WITH_ISSUES: 'à revoir', PENDING_BILLING_INFO: 'paiement à régler', ARCHIVED: 'archivée', ENDED: 'finie',
}
/** Les pubs d'aucun post listé viennent en dernière ligne, sans post (id vide) ni « Promouvoir ». */
const adRows = computed(() => {
  const b = adsBoard.value
  if (!b?.others.length) return b?.posts ?? []
  return [...b.posts, { id: '', at: '', excerpt: '', thumb: undefined, url: undefined, eligible: null, ads: b.others }]
})
const money = (v: number, currency = adsBoard.value?.currency ?? wallet.value?.currency ?? 'EUR') => new Intl.NumberFormat('fr-FR', { style: 'currency', currency }).format(v)

const promoting = ref<string | null>(null)
type Interest = { id: string; name: string }
const promo = reactive({ budget: 10, days: 3, audience: '', placements: 'instagram', link: '' })
/** L'audience enregistrée ou le groupe de cibles choisi pour la pub. */
const audience = computed(() => adsBoard.value?.audiences.find(a => a.id === promo.audience) ?? null)
const promoBusy = ref(false)
const promoError = ref('')
watch(metaNet, () => {
  adsBoard.value = null
  promoting.value = null
  loadAds()
})
function openPromo(p: AdPost) {
  promoting.value = p.id
  promoError.value = ''
  promo.placements = metaNet.value ?? 'instagram'
  promo.link = `https://farnight.online/?c=${adsBoard.value?.nextTag ?? 'e1'}`
  promo.audience ||= adsBoard.value?.audiences[0]?.id ?? ''
}
async function createPromo(p: AdPost) {
  const network = metaNet.value
  if (!network || !confirm(`Créer une pub de ${money(promo.budget)} sur ${promo.days} jour(s), en pause ? Rien n’est dépensé avant « Lancer ».`)) return
  promoBusy.value = true
  promoError.value = ''
  try {
    await $fetch('/api/admin/socials/ads', {
      method: 'POST',
      body: { action: 'promote', network, post: p.id, excerpt: p.excerpt, ...promo },
    })
    promoting.value = null
    await loadAds()
  } catch (e) {
    promoError.value = reason(e)
  } finally {
    promoBusy.value = false
  }
}
const switching = ref('')
async function switchCampaign(a: Promo, status: 'ACTIVE' | 'PAUSED') {
  if (status === 'ACTIVE' && !confirm(`Lancer la pub${a.tag ? ` ${a.tag}` : ''} ? Meta dépensera jusqu’à ${a.budget == null ? 'son budget' : `${money(a.budget)}${a.daily ? ' par jour' : ''}`}.`)) return
  switching.value = a.campaign
  adsError.value = ''
  try {
    await $fetch('/api/admin/socials/ads', { method: 'POST', body: { action: 'status', campaign: a.campaign, status } })
    await Promise.all([loadAds(), loadWallet()])
  } catch (e) {
    adsError.value = reason(e)
  } finally {
    switching.value = ''
  }
}

/* Les groupes de cibles : rangés sur le poste, Meta ne laisse pas l'API créer d'audience enregistrée ; communs à Instagram et Facebook */

type Place = AdsBoard['audiences'][number]['aim']['places'][number]
const blankGroup = () => ({
  id: '', name: '', places: [{ type: 'country', key: 'FR', name: 'France', country: 'FR' }] as Place[], excluded: [] as Place[],
  ageMin: 18, ageMax: 65, genders: '', interests: [] as Interest[],
})
/** Le groupe en cours : vide = nouveau, sinon celui que « modifier » a repris. */
const group = reactive(blankGroup())
/** Le ciblage du groupe tel que le serveur le lit. */
const aim = () => ({
  places: group.places,
  excluded: group.excluded,
  ageMin: group.ageMin,
  ageMax: group.ageMax,
  genders: group.genders ? [Number(group.genders)] : [],
  interests: group.interests,
})
function editGroup(a?: AdsBoard['audiences'][number]) {
  Object.assign(group, blankGroup(), a && {
    id: a.id,
    name: a.name,
    places: a.aim.places.map(p => ({ ...p })),
    excluded: a.aim.excluded.map(p => ({ ...p })),
    ageMin: a.aim.ageMin,
    ageMax: a.aim.ageMax,
    genders: a.aim.genders.length === 1 ? String(a.aim.genders[0]) : '',
    interests: [...a.aim.interests],
  })
  interestHits.value = []
  placeHits.value = []
  targetNote.value = null
}
const interestQuery = ref('')
const interestHits = ref<(Interest & { size: number | null; path: string })[]>([])
const targetBusy = ref('')
const targetNote = ref<{ text: string; bad?: boolean } | null>(null)
const people = (n: number | null) => n == null ? '?' : new Intl.NumberFormat('fr-FR', { notation: 'compact' }).format(n)
async function target(what: string, run: () => Promise<void>) {
  targetBusy.value = what
  targetNote.value = null
  try {
    await run()
  } catch (e) {
    targetNote.value = { text: reason(e), bad: true }
  } finally {
    targetBusy.value = ''
  }
}
const findInterests = () => interestQuery.value.trim().length >= 2 && target('search', async () => {
  interestHits.value = await $fetch('/api/admin/socials/interests', { query: { q: interestQuery.value.trim() } })
  if (!interestHits.value.length) targetNote.value = { text: 'Aucun intérêt pour ce mot chez Meta.' }
})
function addInterest(i: Interest) {
  if (!group.interests.some(x => x.id === i.id)) group.interests.push({ id: i.id, name: i.name })
}
const estimateReach = () => target('estimate', async () => {
  const r = await $fetch<{ min: number | null; max: number | null }>('/api/admin/socials/ads', { method: 'POST', body: { action: 'estimate', ...aim() } })
  targetNote.value = r.max === 0
    ? { text: '0 personne : Meta refuse ce mélange sans le dire. Deux lieux visés qui se recouvrent (un point dans une ville visée), ou une cible trop étroite.', bad: true }
    : { text: `Environ ${people(r.min)} à ${people(r.max)} personnes par mois.` }
})

/** Les types de lieux de Meta, dans les mots de la page. */
const KIND: Record<string, string> = {
  country: 'pays', country_group: 'zone', region: 'région', large_geo_area: 'grande zone', medium_geo_area: 'département', city: 'ville',
  subcity: 'commune', neighborhood: 'quartier', zip: 'code postal', geo_market: 'marché', electoral_district: 'circonscription', pin: 'point',
}
const placeQuery = ref('')
const placeHits = ref<Place[]>([])
const findPlaces = (pin = false) => placeQuery.value.trim().length >= 2 && target(pin ? 'pin' : 'place', async () => {
  placeHits.value = await $fetch('/api/admin/socials/places', { query: { q: placeQuery.value.trim(), pin: pin ? 1 : undefined } })
  if (!placeHits.value.length) targetNote.value = { text: pin ? 'Aucune adresse trouvée.' : 'Aucun lieu pour ce mot chez Meta.' }
})
const same = (a: Place, b: Place) => a.type === b.type && a.key === b.key
/** Meta compte 0 personne quand deux lieux visés se recouvrent : un pays et l'une de ses villes, une région et l'une de ses villes. */
const inside = (p: Place, q: Place) => (q.type === 'country' && q.key === p.country) || (q.type === 'region' && q.key === p.region)
function addPlace(p: Place, out = false) {
  const list = out ? group.excluded : group.places
  if (list.some(x => same(x, p))) return
  const clash = out ? null : group.places.find(q => inside(p, q) || inside(q, p))
  if (clash) {
    targetNote.value = { text: `« ${p.name} » et « ${clash.name} » se recouvrent : Meta compterait 0 personne. Retirer l’un des deux, ou exclure « ${p.name} » de « ${clash.name} ».`, bad: true }
    return
  }
  list.push({ ...p })
  targetNote.value = null
}
const saveGroup = () => group.name.trim() && target('save', async () => {
  const g = await $fetch<AdsBoard['audiences'][number]>('/api/admin/socials/ads', {
    method: 'POST',
    body: { action: 'group', id: group.id || undefined, name: group.name.trim(), ...aim() },
  })
  const b = adsBoard.value
  if (b) b.audiences = [...b.audiences.filter(a => !(a.local && (a.name === g.name || a.id === g.id))), g]
  promo.audience = g.id
  group.id = g.id
  targetNote.value = { text: `Groupe « ${g.name} » enregistré : il est dans le menu Audience de « Promouvoir ».` }
})
function dropGroup(id: string) {
  if (!confirm('Supprimer ce groupe ? Les pubs déjà créées gardent leur ciblage.')) return
  target('drop', async () => {
    await $fetch('/api/admin/socials/ads', { method: 'POST', body: { action: 'ungroup', id } })
    const b = adsBoard.value
    if (b) b.audiences = b.audiences.filter(a => a.id !== id)
    if (promo.audience === id) promo.audience = b?.audiences[0]?.id ?? ''
    if (group.id === id) editGroup()
  })
}

/* La caisse du compte pub (server/socials/ads.ts, wallet) : Meta n'a pas d'API pour payer, le plafond est la seule commande */

const fetchWallet = () => $fetch('/api/admin/socials/wallet')
const wallet = ref<Awaited<ReturnType<typeof fetchWallet>> | null>(null)
const walletError = ref('')
async function loadWallet() {
  try {
    wallet.value = await fetchWallet()
    walletError.value = ''
  } catch (e) {
    walletError.value = reason(e)
  }
}
const capInput = ref('')
const capBusy = ref(false)
async function saveCap(amount: number | null) {
  if (amount !== null && !(amount >= 1)) return
  const ask = amount === null
    ? 'Retirer le plafond ? La carte paiera tout ce que les pubs en marche dépensent.'
    : `Fixer le plafond du compte à ${money(amount)} ? Meta coupe toutes les pubs quand il est atteint. 10 changements par jour au plus.`
  if (!confirm(ask)) return
  capBusy.value = true
  walletError.value = ''
  try {
    await $fetch('/api/admin/socials/ads', { method: 'POST', body: { action: 'cap', amount } })
    capInput.value = ''
    await loadWallet()
  } catch (e) {
    walletError.value = reason(e)
  } finally {
    capBusy.value = false
  }
}

/* Les crédits API X (server/socials/x.ts, xCredits) : payés à l'appel, rechargés dans la console de X */

const fetchCredits = () => $fetch('/api/admin/socials/credits')
const credits = ref<Awaited<ReturnType<typeof fetchCredits>> | null>(null)
const creditsError = ref('')
async function loadCredits() {
  try {
    credits.value = await fetchCredits()
    creditsError.value = ''
  } catch (e) {
    creditsError.value = reason(e)
  }
}
watch(tab, (t) => {
  if (t === 'x') Promise.all([loadCredits(), loadXAds()])
})

/* Les promotions X des posts (server/socials/x-ads.ts) : l'Ads API, à part de la publication ; Promouvoir, Pause et Lancer partagent l'état de Meta */

const fetchXAds = () => $fetch('/api/admin/socials/x-ads')
type XAds = Awaited<ReturnType<typeof fetchXAds>>
type XPost = Extract<XAds, { configured: true }>['posts'][number]
type XPlace = { key: string; name: string; type: string; country?: string }
const xAds = ref<XAds | null>(null)
const xReady = computed(() => xAds.value?.configured ? xAds.value : null)
const xAdsLoading = ref(false)
const xAdsError = ref('')
async function loadXAds() {
  xAdsLoading.value = true
  xAdsError.value = ''
  try {
    xAds.value = await fetchXAds()
  } catch (e) {
    xAdsError.value = reason(e)
  } finally {
    xAdsLoading.value = false
  }
}
/** Comme chez Meta, les promotions d'aucun post listé viennent en dernière ligne, sans post (id vide). */
const xRows = computed((): XPost[] => {
  const b = xReady.value
  if (!b?.others.length) return b?.posts ?? []
  return [...b.posts, { id: '', at: '', excerpt: '', thumb: undefined, url: '', link: null, tag: null, eligible: false, ads: b.others }]
})
const ageLabel = (a: string) => a.replace(/^AGE_OVER_(\d+)$/, '$1 ans et plus').replace(/^AGE_(\d+)_TO_(\d+)$/, '$1–$2 ans')
const xPromo = reactive({ budget: 10, days: 3, places: [] as XPlace[], age: '', gender: '' })
const xPlaceQuery = ref('')
const xPlaceHits = ref<XPlace[]>([])
const xPlaceNote = ref('')
const xSearching = ref(false)
async function findXPlaces() {
  const q = xPlaceQuery.value.trim()
  if (q.length < 2) return
  xSearching.value = true
  xPlaceNote.value = ''
  try {
    xPlaceHits.value = await $fetch('/api/admin/socials/places', { query: { q, x: 1 } })
    if (!xPlaceHits.value.length) xPlaceNote.value = 'Aucun lieu pour ce mot chez X.'
  } catch (e) {
    xPlaceNote.value = reason(e)
  } finally {
    xSearching.value = false
  }
}
function openXPromo(p: XPost) {
  promoting.value = p.id
  promoError.value = ''
}
async function createXPromo(p: XPost) {
  const currency = xReady.value?.currency
  if (!confirm(`Créer une promotion X de ${money(xPromo.budget, currency)} sur ${xPromo.days} jour(s), en pause ? Rien n’est dépensé avant « Lancer ».`)) return
  promoBusy.value = true
  promoError.value = ''
  try {
    await $fetch('/api/admin/socials/x-ads', {
      method: 'POST',
      body: { action: 'promote', post: p.id, excerpt: p.excerpt, budget: xPromo.budget, days: xPromo.days, places: xPromo.places.map(x => x.key), age: xPromo.age, gender: xPromo.gender },
    })
    promoting.value = null
    await loadXAds()
  } catch (e) {
    promoError.value = reason(e)
  } finally {
    promoBusy.value = false
  }
}
async function switchXCampaign(a: XPost['ads'][number], status: 'ACTIVE' | 'PAUSED') {
  if (status === 'ACTIVE' && !confirm(`Lancer la promotion X ? X dépensera jusqu’à ${a.budget == null ? 'son budget' : `${money(a.budget, xReady.value?.currency)}${a.daily ? ' par jour' : ''}`}.`)) return
  switching.value = a.campaign
  xAdsError.value = ''
  try {
    await $fetch('/api/admin/socials/x-ads', { method: 'POST', body: { action: 'status', campaign: a.campaign, status } })
    await loadXAds()
  } catch (e) {
    xAdsError.value = reason(e)
  } finally {
    switching.value = ''
  }
}

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
  loadAds()
  loadWallet()
  if (tab.value === 'x') Promise.all([loadCredits(), loadXAds()])
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
      <!-- La caisse du compte pub, au-dessus de tous les onglets -->
      <section v-if="wallet || walletError" class="till panel">
        <h2 v-if="wallet">
          Caisse pub · {{ wallet.name }}
          <span>{{ wallet.funding ?? (wallet.prepaid ? 'prépayé' : 'aucun moyen de paiement') }}</span>
        </h2>
        <dl v-if="wallet" class="figures">
          <div><dt>Dépensé</dt><dd>{{ money(wallet.spent, wallet.currency) }}</dd></div>
          <div v-if="!wallet.prepaid"><dt>À prélever</dt><dd>{{ money(wallet.due, wallet.currency) }}</dd></div>
          <div><dt>Plafond</dt><dd :class="{ warn: wallet.cap == null }">{{ wallet.cap == null ? 'aucun' : money(wallet.cap, wallet.currency) }}</dd></div>
          <div v-if="wallet.left != null"><dt>Reste</dt><dd :class="wallet.left < wallet.engaged ? 'warn' : 'good'">{{ money(wallet.left, wallet.currency) }}</dd></div>
          <div>
            <dt>Engagé<em>{{ wallet.running }} pub(s) en marche</em></dt>
            <dd>{{ money(wallet.engaged, wallet.currency) }}<small v-if="wallet.perDay"> + {{ money(wallet.perDay, wallet.currency) }} par jour</small></dd>
          </div>
        </dl>
        <form v-if="wallet" class="assist" @submit.prevent="saveCap(Number(capInput.replace(',', '.').replace(/[\s€]/g, '')))">
          <input v-model="capInput" type="text" inputmode="decimal" class="fix" placeholder="nouveau plafond, en euros" aria-label="Nouveau plafond du compte" :disabled="capBusy">
          <button type="submit" class="btn" :disabled="capBusy || !capInput.trim()">{{ capBusy ? '…' : 'Fixer le plafond' }}</button>
          <button v-if="wallet.cap != null" type="button" class="btn" :disabled="capBusy" @click="saveCap(null)">Retirer le plafond</button>
          <a :href="wallet.billing" target="_blank" rel="noopener" class="link small">Payer, changer de carte chez Meta →</a>
        </form>
        <p v-if="wallet?.cap == null" class="warn small">Sans plafond, la carte paie tout ce que les pubs en marche dépensent.</p>
        <p v-else-if="wallet.left != null && wallet.left < wallet.engaged" class="warn small">Les pubs en marche peuvent dépenser plus que le reste : Meta les coupera toutes au plafond.</p>
        <p v-for="o in wallet?.others ?? []" :key="o.id" class="muted small">
          {{ o.name }} ({{ o.prepaid ? 'prépayé' : 'carte' }}, lecture seule) :
          {{ o.left != null ? `${money(o.left, o.currency)} avant le plafond` : 'sans plafond' }} · {{ money(o.spent, o.currency) }} dépensés ·
          <a :href="o.billing" target="_blank" rel="noopener" class="link">ajouter des fonds →</a>
        </p>
        <p v-if="walletError" class="bad small">{{ walletError }}</p>
      </section>

      <!-- Les crédits API X, sur son onglet : sans solde, X refuse tout post -->
      <section v-if="tab === 'x'" class="till panel">
        <h2>Crédits API X <span>payés à l’appel, l’écriture s’arrête à zéro</span></h2>
        <dl v-if="credits" class="figures">
          <div><dt>Solde</dt><dd :class="credits.total > 0 ? 'good' : 'warn'">{{ money(credits.total, 'USD') }}</dd></div>
          <div><dt>Acheté</dt><dd>{{ money(credits.prepaid, 'USD') }}</dd></div>
          <div>
            <dt>Offert<em v-if="credits.expires">jusqu’au {{ new Date(credits.expires).toLocaleDateString('fr-FR') }}</em></dt>
            <dd>{{ money(credits.free, 'USD') }}</dd>
          </div>
        </dl>
        <p class="assist">
          <button type="button" class="btn" @click="loadCredits">Relire le solde</button>
          <a href="https://console.x.com" target="_blank" rel="noopener" class="link small">Acheter des crédits, régler la recharge auto chez X →</a>
        </p>
        <p v-if="credits && credits.total <= 0" class="warn small">Une carte enregistrée ne suffit pas : il faut acheter des crédits ou activer la recharge auto.</p>
        <p v-if="creditsError" class="bad small">{{ creditsError }}</p>
      </section>

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
              <button type="button" class="btn" :disabled="developing || !text.trim()" @click="develop()">
                {{ developing ? 'L’IA écrit…' : 'Développer' }}
              </button>
              <button v-if="undos.length && !developing" type="button" class="btn" @click="undo">Annuler</button>
              <template v-if="undos.length">
                <input v-model="fixNote" type="text" class="fix" placeholder="Ce qu’il faut corriger (vide : relecture)" :disabled="developing" @keydown.enter.prevent="!developing && text.trim() && develop(fixNote)">
                <button type="button" class="btn" :disabled="developing || !text.trim()" @click="develop(fixNote)">Corriger</button>
              </template>
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
              <button v-if="e.state === 'failed' && e.retry" type="button" class="tag bad again" title="Relancer ce post" :disabled="sending" @click="retry(e)">{{ formatLabel(e.network, e.format) }} ↻</button>
              <span v-else class="tag" :class="e.state === 'done' ? 'good' : e.state === 'pending' ? 'warn' : 'bad'">{{ formatLabel(e.network, e.format) }}</span>
              <span>{{ e.excerpt }}</span>
              <span v-if="e.detail" class="muted small"> — {{ e.detail }}</span>
              <a v-if="e.url" :href="e.url" target="_blank" rel="noopener" class="link"> voir</a>
            </li>
          </ul>

          <template v-if="metaNet && net.connected">
            <h2 class="sub">
              Groupes de cibles
              <span>communs à Instagram et Facebook</span>
            </h2>
            <p v-if="adsBoard && !adsBoard.audiences.length" class="muted small">Aucun groupe encore : composer le premier ci-dessous.</p>
            <ul v-if="adsBoard?.audiences.length" class="targets">
              <li v-for="a in adsBoard.audiences" :key="a.id" :class="{ on: group.id === a.id }">
                <span class="tag" :class="a.local ? 'good' : 'muted'">{{ a.local ? 'groupe' : 'Meta' }}</span>
                <span>{{ a.name }}</span>
                <span class="small">
                  {{ a.places.join(', ') || 'partout' }}<template v-if="a.excluded.length"> sauf {{ a.excluded.join(', ') }}</template> · {{ a.age }} · {{ a.genders }}<template v-if="a.interests.length">
                    · <span class="muted">{{ a.interests.join(', ') }}</span></template><span v-if="a.advantage" class="muted"> · Advantage+</span>
                </span>
                <template v-if="a.local">
                  <button type="button" class="link small" :disabled="!!targetBusy" @click="editGroup(a)">modifier</button>
                  <button type="button" class="link small" :disabled="!!targetBusy" @click="dropGroup(a.id)">supprimer</button>
                </template>
                <button v-else type="button" class="link small" :disabled="!!targetBusy" @click="editGroup({ ...a, id: '', name: '' })">partir de celle-ci</button>
              </li>
            </ul>
            <form class="promo" @submit.prevent="saveGroup">
              <p class="wide small">
                {{ group.id ? 'Modification du groupe' : 'Nouveau groupe' }}
                <button v-if="group.id" type="button" class="link" :disabled="!!targetBusy" @click="editGroup()"> · en composer un autre</button>
              </p>
              <label class="field wide">
                <span class="k">Nom</span>
                <input v-model="group.name" type="text" maxlength="60" required>
              </label>
              <div class="field wide">
                <span class="k">Lieux<em>Meta touche ceux qui y vivent ou y sont passés récemment, il ne fait plus la différence</em></span>
                <ul v-if="group.places.length || group.excluded.length" class="geo">
                  <li v-for="(p, n) in [...group.places, ...group.excluded]" :key="(n < group.places.length ? '+' : '-') + p.type + p.key">
                    <span class="tag" :class="n < group.places.length ? 'good' : 'bad'">{{ n < group.places.length ? '' : 'sauf · ' }}{{ KIND[p.type] ?? p.type }}</span>
                    <span>{{ p.name }}</span>
                    <label v-if="p.type === 'city' || p.type === 'pin'" class="radius">
                      +<input
                        v-model.number="p.radius" type="number" :min="p.type === 'pin' ? 1 : 17" max="80" step="1" :required="p.type === 'pin'"
                        :placeholder="p.type === 'city' ? 'ville seule' : ''" :aria-label="`Rayon autour de ${p.name}, en kilomètres`"
                      >km
                    </label>
                    <button type="button" class="link small" @click="n < group.places.length ? group.places.splice(n, 1) : group.excluded.splice(n - group.places.length, 1)">retirer</button>
                  </li>
                </ul>
                <p v-if="!group.places.length" class="warn small">Aucun lieu visé : en chercher un.</p>
                <span class="assist">
                  <input v-model="placeQuery" type="text" class="fix" aria-label="Chercher un lieu chez Meta, ou une adresse" @keydown.enter.prevent="findPlaces()">
                  <button type="button" class="btn" :disabled="!!targetBusy || placeQuery.trim().length < 2" @click="findPlaces()">{{ targetBusy === 'place' ? '…' : 'Chercher un lieu' }}</button>
                  <button type="button" class="btn" :disabled="!!targetBusy || placeQuery.trim().length < 2" @click="findPlaces(true)">{{ targetBusy === 'pin' ? '…' : 'Poser un point' }}</button>
                </span>
                <ul v-if="placeHits.length" class="hits">
                  <li v-for="h in placeHits" :key="h.type + h.key">
                    <span class="tag muted">{{ KIND[h.type] ?? h.type }}</span> {{ h.name }} <span class="muted small">{{ h.detail }}</span>
                    <button type="button" class="link small" :disabled="group.places.some(x => same(x, h))" @click="addPlace(h)"> viser</button>
                    <button type="button" class="link small" :disabled="group.excluded.some(x => same(x, h))" @click="addPlace(h, true)"> exclure</button>
                  </li>
                </ul>
                <p class="muted small">« Chercher un lieu » : pays, zones (Europe…), régions, départements, villes, quartiers, codes postaux, chez Meta. « Poser un point » : une adresse (OpenStreetMap), puis 1 à 80 km autour. Une ville se vise seule ou avec 17 à 80 km autour. Exclure retire un morceau d’un lieu visé : Paris de la France, un quartier d’une ville.</p>
              </div>
              <label class="field">
                <span class="k">Âge min.</span>
                <input v-model.number="group.ageMin" type="number" min="18" max="65" step="1" required>
              </label>
              <label class="field">
                <span class="k">Âge max.</span>
                <input v-model.number="group.ageMax" type="number" min="18" max="65" step="1" required>
              </label>
              <label class="field">
                <span class="k">Sexe</span>
                <select v-model="group.genders">
                  <option value="">Tous</option>
                  <option value="2">Femmes</option>
                  <option value="1">Hommes</option>
                </select>
              </label>
              <div class="field wide">
                <span class="k">Intérêts<em>{{ group.interests.length ? `${group.interests.length}, l’un ou l’autre` : 'aucun : tout le monde' }}</em></span>
                <span v-if="group.interests.length" class="chips">
                  <button v-for="(i, n) in group.interests" :key="i.id" type="button" class="chip on" @click="group.interests.splice(n, 1)">{{ i.name }} ×</button>
                </span>
                <span class="assist">
                  <input v-model="interestQuery" type="text" class="fix" aria-label="Chercher un intérêt chez Meta" @keydown.enter.prevent="findInterests">
                  <button type="button" class="btn" :disabled="!!targetBusy || interestQuery.trim().length < 2" @click="findInterests">{{ targetBusy === 'search' ? '…' : 'Chercher' }}</button>
                </span>
                <ul v-if="interestHits.length" class="hits">
                  <li v-for="h in interestHits" :key="h.id">
                    <button type="button" class="link" :disabled="group.interests.some(x => x.id === h.id)" @click="addInterest(h)">+ {{ h.name }}</button>
                    <span class="muted small"> {{ people(h.size) }}{{ h.path ? ` · ${h.path}` : '' }}</span>
                  </li>
                </ul>
              </div>
              <span class="wide assist">
                <button type="button" class="btn" :disabled="!!targetBusy || !group.places.length" @click="estimateReach">{{ targetBusy === 'estimate' ? '…' : 'Estimer' }}</button>
                <button type="submit" class="btn" :disabled="!!targetBusy || !group.name.trim() || !group.places.length">{{ targetBusy === 'save' ? '…' : group.id ? 'Enregistrer les changements' : 'Enregistrer le groupe' }}</button>
              </span>
              <p v-if="targetNote" :class="['small', 'wide', targetNote.bad ? 'bad' : 'good']">{{ targetNote.text }}</p>
              <p class="muted small wide">Rangé sur le poste (l’API de Meta ne crée pas d’audience enregistrée), puis choisi dans « Promouvoir ». Un nom déjà pris remplace l’ancien groupe ; une modification vaut pour les pubs à venir, celles déjà créées gardent leur ciblage. Partir d’une audience Meta en reprend lieux, âge, sexe et intérêts, sans Advantage+ : le groupe s’en tient à ses limites.</p>
            </form>

            <h2 class="sub">
              Posts du compte
              <button type="button" class="link small" :disabled="adsLoading" @click="loadAds">{{ adsLoading ? 'lecture…' : 'relire' }}</button>
            </h2>
            <p v-if="adsError" class="bad small">{{ adsError }}</p>
            <p v-if="adsBoard?.blocked" class="warn small">On voit les pubs, on n’en crée pas et on ne les met pas en pause. {{ adsBoard.blocked }}</p>
            <p v-if="adsBoard && !adsBoard.posts.length" class="muted small">Aucun post.</p>
            <ul v-if="adsBoard" class="posts">
              <li v-for="p in adRows" :key="p.id">
                <img v-if="p.thumb" :src="p.thumb" alt="" loading="lazy">
                <span v-else class="thumb-x">—</span>
                <div class="post-body">
                  <p v-if="p.id">
                    <span class="t">{{ when(p.at) }}</span> {{ p.excerpt || 'sans texte' }}
                    <a v-if="p.url" :href="p.url" target="_blank" rel="noopener" class="link">voir</a>
                  </p>
                  <p v-else class="muted small">Pubs d’aucun post de la liste : un post plus ancien, ou une pub montée avec son propre post invisible.</p>
                  <p v-for="a in p.ads" :key="a.id" class="ad">
                    <span class="tag" :class="a.running ? 'good' : a.status === 'DISAPPROVED' || a.status === 'WITH_ISSUES' ? 'bad' : 'muted'">{{ AD_STATUS[a.status] ?? a.status }}</span>
                    <span v-if="!p.id">{{ a.title }}</span>
                    <code>{{ a.tag ? `?c=${a.tag}` : 'sans étiquette' }}</code>
                    <span>{{ money(a.spend) }}{{ a.budget == null ? '' : ` / ${money(a.budget)}${a.daily ? ' par jour' : ''}` }} · {{ a.clicks }} clic(s)</span>
                    <span v-if="!a.toSite" class="bad small">pas de lien vers le site</span>
                    <button v-if="a.running" type="button" class="btn" :disabled="!adsBoard.writable || !!switching" @click="switchCampaign(a, 'PAUSED')">
                      {{ switching === a.campaign ? '…' : 'Pause' }}
                    </button>
                    <button v-else-if="a.status !== 'ENDED' && a.status !== 'ARCHIVED'" type="button" class="btn" :disabled="!adsBoard.writable || !!switching" @click="switchCampaign(a, 'ACTIVE')">
                      {{ switching === a.campaign ? '…' : 'Lancer' }}
                    </button>
                  </p>
                  <template v-if="!p.id" />
                  <template v-else-if="promoting !== p.id">
                    <button type="button" class="btn" :disabled="!adsBoard.writable || p.eligible === false" @click="openPromo(p)">Promouvoir</button>
                    <span v-if="p.eligible === false" class="muted small"> Meta ne le juge pas promouvable.</span>
                  </template>
                  <form v-else class="promo" @submit.prevent="createPromo(p)">
                    <label class="field">
                      <span class="k">Budget total<em>{{ adsBoard.currency }}</em></span>
                      <input v-model.number="promo.budget" type="number" min="1" max="500" step="0.5" required>
                    </label>
                    <label class="field">
                      <span class="k">Durée<em>jours</em></span>
                      <input v-model.number="promo.days" type="number" min="1" max="30" step="1" required>
                    </label>
                    <label class="field wide">
                      <span class="k">Audience<em>les groupes de cibles, plus haut</em></span>
                      <select v-model="promo.audience" required>
                        <option v-for="a in adsBoard.audiences" :key="a.id" :value="a.id">{{ a.name }}{{ a.local ? ' · groupe' : '' }}</option>
                      </select>
                    </label>
                    <p v-if="audience" class="small wide">
                      {{ audience.places.join(', ') || 'partout' }}<template v-if="audience.excluded.length"> sauf {{ audience.excluded.join(', ') }}</template> · {{ audience.age }} · {{ audience.genders }}<template v-if="audience.interests.length">
                        · {{ audience.interests.length }} intérêt(s) : <span class="muted">{{ audience.interests.join(', ') }}</span></template>
                      <span v-if="audience.advantage" class="muted"> · Advantage+ : Meta peut élargir au-delà.</span>
                    </p>
                    <p v-else class="warn small wide">Aucune audience : composer d’abord un groupe dans « Groupes de cibles », plus haut.</p>
                    <label class="field">
                      <span class="k">Emplacements</span>
                      <select v-model="promo.placements">
                        <option value="instagram">Instagram</option>
                        <option value="facebook">Facebook</option>
                        <option value="both">Les deux</option>
                      </select>
                    </label>
                    <label class="field wide">
                      <span class="k">Lien</span>
                      <input v-model="promo.link" type="text" required>
                    </label>
                    <p class="muted small wide">Le <code>?c=</code> de la fin est l’étiquette de la pub : le moniteur compte grâce à lui les ventes qu’elle amène. On peut l’enlever et garder farnight.online tout court ; la pub sera alors « sans étiquette ».</p>
                    <p class="muted small wide">Objectif : clics vers le site. Créée en pause, rien n’est dépensé avant « Lancer ».</p>
                    <p v-if="promoError" class="bad small wide">{{ promoError }}</p>
                    <span class="wide assist">
                      <button type="submit" class="btn" :disabled="promoBusy || !audience">{{ promoBusy ? 'Création…' : 'Créer en pause' }}</button>
                      <button type="button" class="btn" :disabled="promoBusy" @click="promoting = null">Annuler</button>
                    </span>
                  </form>
                </div>
              </li>
            </ul>
          </template>

          <template v-if="tab === 'x'">
            <h2 class="sub">
              Promotions X
              <button type="button" class="link small" :disabled="xAdsLoading" @click="loadXAds">{{ xAdsLoading ? 'lecture…' : 'relire' }}</button>
            </h2>
            <p v-if="xAdsError" class="bad small">{{ xAdsError }}</p>
            <template v-if="xAds && !xAds.configured">
              <ol class="steps">
                <li>Demander l’accès à l’Ads API pour l’app, niveau « Standard Access » : <a href="https://docs.x.com/x-ads-api/getting-started/step-by-step-guide" target="_blank" rel="noopener" class="link">formulaire « Ads API Access » →</a></li>
                <li>Ouvrir le compte pub sur <a href="https://ads.x.com" target="_blank" rel="noopener" class="link">ads.x.com</a> avec le compte X du jeu, et y enregistrer une carte.</li>
                <li>Une fois l’accès accordé : dans console.x.com, l’app, générer l’Access Token et son Secret (ceux d’avant l’accord n’ouvrent pas l’Ads API).</li>
                <li>Les mettre au .env, puis relancer nuxt dev.</li>
              </ol>
              <p class="small">Manquent au .env : <code v-for="e in xAds.missing" :key="e" class="env">{{ e }}</code></p>
            </template>
            <template v-else-if="xReady">
              <p class="small">
                Compte pub {{ xReady.account }} · {{ xReady.card?.name ?? 'aucune carte' }} ·
                7 derniers jours : {{ xReady.spent == null ? '?' : money(xReady.spent, xReady.currency) }} ·
                {{ xReady.running }} en marche, {{ money(xReady.engaged, xReady.currency) }} engagés<template v-if="xReady.perDay"> + {{ money(xReady.perDay, xReady.currency) }} par jour</template> ·
                <a href="https://ads.x.com" target="_blank" rel="noopener" class="link">carte et factures chez X →</a>
              </p>
              <p v-if="!xReady.card?.able" class="warn small">Pas de carte en état de payer{{ xReady.card?.reasons.length ? ` (${xReady.card.reasons.join(', ')})` : '' }} : X refusera la promotion. L’enregistrer sur ads.x.com.</p>
              <p v-if="!xReady.posts.length" class="muted small">Aucun post.</p>
              <ul class="posts">
                <li v-for="p in xRows" :key="p.id">
                  <img v-if="p.thumb" :src="p.thumb" alt="" loading="lazy">
                  <span v-else class="thumb-x">—</span>
                  <div class="post-body">
                    <p v-if="p.id">
                      <span class="t">{{ when(p.at) }}</span> {{ p.excerpt || 'sans texte' }}
                      <a :href="p.url" target="_blank" rel="noopener" class="link">voir</a>
                    </p>
                    <p v-else class="muted small">Promotions d’un post plus ancien que la liste.</p>
                    <p v-for="a in p.ads" :key="a.id" class="ad">
                      <span class="tag" :class="a.running ? 'good' : a.status === 'DISAPPROVED' ? 'bad' : 'muted'">{{ AD_STATUS[a.status] ?? a.status }}</span>
                      <span v-if="!p.id">{{ a.title }}</span>
                      <code>{{ a.tag ? `?c=${a.tag}` : 'sans étiquette' }}</code>
                      <span>
                        {{ a.spend == null ? '?' : money(a.spend, xReady.currency) }} et {{ a.clicks ?? '?' }} clic(s) en 7 jours{{ a.budget == null ? '' : ` · budget ${money(a.budget, xReady.currency)}${a.daily ? ' par jour' : ''}` }}
                      </span>
                      <button v-if="a.running" type="button" class="btn" :disabled="!!switching" @click="switchXCampaign(a, 'PAUSED')">
                        {{ switching === a.campaign ? '…' : 'Pause' }}
                      </button>
                      <button v-else-if="a.status !== 'ENDED'" type="button" class="btn" :disabled="!!switching" @click="switchXCampaign(a, 'ACTIVE')">
                        {{ switching === a.campaign ? '…' : 'Lancer' }}
                      </button>
                    </p>
                    <template v-if="!p.id" />
                    <template v-else-if="promoting !== p.id">
                      <button type="button" class="btn" :disabled="!p.eligible" @click="openXPromo(p)">Promouvoir</button>
                      <span v-if="!p.eligible" class="muted small"> Pas de lien dans ce post : l’objectif clics vers le site en veut un.</span>
                    </template>
                    <form v-else class="promo" @submit.prevent="createXPromo(p)">
                      <label class="field">
                        <span class="k">Budget total<em>{{ xReady.currency }}</em></span>
                        <input v-model.number="xPromo.budget" type="number" min="1" max="500" step="0.5" required>
                      </label>
                      <label class="field">
                        <span class="k">Durée<em>jours</em></span>
                        <input v-model.number="xPromo.days" type="number" min="1" max="30" step="1" required>
                      </label>
                      <div class="field wide">
                        <span class="k">Lieux<em>{{ xPromo.places.length ? `${xPromo.places.length}, l’un ou l’autre` : 'au moins un' }}</em></span>
                        <ul v-if="xPromo.places.length" class="geo">
                          <li v-for="(l, n) in xPromo.places" :key="l.key">
                            <span class="tag good">{{ l.type.toLowerCase() }}</span>
                            <span>{{ l.name }}</span>
                            <button type="button" class="link small" @click="xPromo.places.splice(n, 1)">retirer</button>
                          </li>
                        </ul>
                        <span class="assist">
                          <input v-model="xPlaceQuery" type="text" class="fix" aria-label="Chercher un lieu chez X" @keydown.enter.prevent="findXPlaces">
                          <button type="button" class="btn" :disabled="xSearching || xPlaceQuery.trim().length < 2" @click="findXPlaces">{{ xSearching ? '…' : 'Chercher un lieu' }}</button>
                        </span>
                        <ul v-if="xPlaceHits.length" class="hits">
                          <li v-for="h in xPlaceHits" :key="h.key">
                            <span class="tag muted">{{ h.type.toLowerCase() }}</span> {{ h.name }}
                            <button type="button" class="link small" :disabled="xPromo.places.some(x => x.key === h.key)" @click="xPromo.places.push({ ...h })"> viser</button>
                          </li>
                        </ul>
                        <p v-if="xPlaceNote" class="muted small">{{ xPlaceNote }}</p>
                      </div>
                      <label class="field">
                        <span class="k">Âge<em>une seule tranche chez X</em></span>
                        <select v-model="xPromo.age">
                          <option value="">Tous</option>
                          <option v-for="a in xReady.ages" :key="a" :value="a">{{ ageLabel(a) }}</option>
                        </select>
                      </label>
                      <label class="field">
                        <span class="k">Sexe</span>
                        <select v-model="xPromo.gender">
                          <option value="">Tous</option>
                          <option value="2">Femmes</option>
                          <option value="1">Hommes</option>
                        </select>
                      </label>
                      <p class="muted small wide">Objectif : clics vers le lien du post, payés au clic. Le post est promu tel quel : son <code>?c=</code> n’existe que s’il a été publié avec. Créée en pause, rien n’est dépensé avant « Lancer ».</p>
                      <p v-if="promoError" class="bad small wide">{{ promoError }}</p>
                      <span class="wide assist">
                        <button type="submit" class="btn" :disabled="promoBusy || !xPromo.places.length">{{ promoBusy ? 'Création…' : 'Créer en pause' }}</button>
                        <button type="button" class="btn" :disabled="promoBusy" @click="promoting = null">Annuler</button>
                      </span>
                    </form>
                  </div>
                </li>
              </ul>
            </template>
          </template>
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
  --neon-300: 196 160 255;
  --neon-400: 168 110 255;
  --neon-500: 140 70 255;
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
input[type='text'], input[type='url'], input[type='number'], textarea, select {
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
.assist input.fix { flex: 1 1 18ch; width: auto; padding: 4px 8px; }
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
.posts { display: grid; gap: 8px; }
.posts > li { display: grid; grid-template-columns: 56px minmax(0, 1fr); gap: 10px; border-top: 1px solid var(--line); padding-top: 8px; }
.posts img, .posts .thumb-x { width: 56px; height: 56px; object-fit: cover; background: #000; display: grid; place-items: center; }
.post-body { display: grid; gap: 6px; justify-items: start; line-height: 1.5; min-width: 0; }
.post-body .ad { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; }
.promo { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 12px; width: 100%; border: 1px solid var(--line); padding: 10px; }
.promo .wide { grid-column: 1 / -1; }
.hits { display: grid; gap: 2px; max-height: 220px; overflow-y: auto; }
.targets { display: grid; gap: 6px; margin-bottom: 10px; }
.targets li { display: flex; flex-wrap: wrap; gap: 2px 8px; align-items: baseline; padding: 6px 8px; border: 1px solid var(--line); }
.targets li.on { border-color: rgb(var(--neon-400)); }
.geo { display: grid; gap: 4px; }
.geo li { display: flex; flex-wrap: wrap; gap: 2px 8px; align-items: center; }
.radius { display: inline-flex; gap: 4px; align-items: center; font-size: 11px; color: var(--muted); }
.radius input { width: 9ch; padding: 2px 6px; }
.till { margin-bottom: 20px; }
.figures { display: flex; flex-wrap: wrap; gap: 10px 28px; }
.figures dt { font-size: 9px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.14em; }
.figures dt em { font-style: normal; text-transform: none; letter-spacing: 0.04em; margin-left: 6px; }
.figures dd { font-size: 18px; font-variant-numeric: tabular-nums; }
.figures dd small { font-size: 11px; color: var(--muted); }
.tag { font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; border: 1px solid currentColor; padding: 0 5px; }
.tag.again { cursor: pointer; }
.tag.again:hover:not(:disabled) { box-shadow: 0 0 0 1px currentColor; }
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

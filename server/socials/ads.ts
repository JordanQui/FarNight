/**
 * Les pubs Meta des posts, pour /nimda/socials : les derniers posts Instagram
 * ou Facebook du compte, publiés ici ou à la main depuis l'appli, chacun avec
 * les pubs qui le font tourner, et « Promouvoir » qui en crée une depuis lui.
 *
 * Une promotion est une campagne Trafic (clics sur le lien) vers
 * farnight.online/?c=<étiquette> : le jeu garde l'étiquette jusqu'au paiement
 * et /nimda/monitor juge la pub par les ventes qu'elle amène. Un boost lancé
 * depuis la Page part vers Messenger ; celle-ci, jamais. Elle naît en pause :
 * rien n'est dépensé avant « Lancer », qui allume la campagne. Le site n'a pas
 * de pixel Meta : on optimise les clics, pas les vues de page.
 *
 * Même jeton que meta.ts. Lire les posts demande instagram_basic et
 * pages_read_engagement ; créer, lancer ou mettre en pause, `ads_management`
 * et le droit de faire des pubs sur la page, le compte Instagram et le compte
 * publicitaire dans le portfolio.
 *
 * Les groupes de cibles se rangent sur le poste : l'API de Meta lit les
 * audiences enregistrées mais ne sait pas en créer (saved_audiences n'accepte
 * ni création, ni modification, ni suppression). Un groupe garde le ciblage
 * tel que Meta le reçoit à la création de la pub.
 */
import { bad, http } from './common'
import { findPage, get, igAccount, post, userToken } from './meta'

export type Placement = 'instagram' | 'facebook' | 'both'
export type Spec = {
  network: 'instagram' | 'facebook'
  post: string
  excerpt: string
  /** Budget total, dans la devise du compte. */
  budget: number
  days: number
  /** Une audience enregistrée du compte ou un groupe du poste (g…) : le ciblage se compose dans les groupes. */
  audience: string
  placements: Placement
  /** Sur farnight.online ; son `?c=` est l'étiquette que le moniteur suit jusqu'aux ventes. */
  link: string
}

/** Sans filtre, Meta tait les pubs archivées ; DELETED y est refusé (comme dans meta.get.ts). */
const STATUSES = ['ACTIVE', 'PAUSED', 'ARCHIVED', 'IN_PROCESS', 'WITH_ISSUES', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED', 'PENDING_REVIEW', 'DISAPPROVED', 'PREAPPROVED', 'PENDING_BILLING_INFO']
const POSTS = 12

type Paged<T> = { data: T[]; paging?: { next?: string } }
type Targeting = {
  age_min?: number
  age_max?: number
  genders?: number[]
  geo_locations?: Geo
  excluded_geo_locations?: Geo
  flexible_spec?: { interests?: { id?: string; name: string }[] }[]
  targeting_automation?: { advantage_audience?: number }
  [key: string]: unknown
}
/** Les pays et groupes de pays s'écrivent en codes ; les autres lieux en objets, avec un rayon pour les villes et les points. */
type Geo = Record<string, (string | GeoItem)[] | undefined>
type GeoItem = { key?: string; name?: string; country?: string; region_id?: string | number; radius?: number; distance_unit?: string; latitude?: number; longitude?: number; address_string?: string }
type Budget = { lifetime_budget?: string; daily_budget?: string }
type Ad = {
  id: string
  effective_status: string
  campaign?: Budget & { id: string; name: string; effective_status: string }
  adset?: Budget & { end_time?: string }
  creative?: {
    object_story_id?: string
    effective_object_story_id?: string
    effective_instagram_media_id?: string
    source_instagram_media_id?: string
    call_to_action?: { value?: { link?: string } }
  }
  insights?: { data: { spend?: string; inline_link_clicks?: string }[] }
}

const num = (v?: string) => Number(v ?? 0) || 0
const excerptOf = (s?: string) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, 90)

/**
 * Le compte publicitaire du portfolio FarNight, comme le moniteur : le jeton voit aussi l'ancien compte
 * personnel « Jo Olivier Qrt », où il ne fait que lire (choix du 16/10). Le premier sinon.
 */
async function account() {
  const { data } = await get<Paged<Account>>(
    'me/adaccounts', userToken(), { fields: 'name,currency,business,default_dsa_beneficiary,default_dsa_payor,spend_cap,amount_spent,balance,is_prepay_account' },
  )
  const acc = data.find(a => a.business) ?? data[0]
  if (!acc) throw createError({ statusCode: 502, statusMessage: 'Meta : aucun compte publicitaire pour ce jeton' })
  return { ...acc, others: data.filter(a => a !== acc) }
}
type Account = {
  id: string
  name: string
  currency: string
  business?: { id: string }
  default_dsa_beneficiary?: string
  default_dsa_payor?: string
  /** Lus en centimes de la devise du compte. */
  spend_cap?: string
  amount_spent?: string
  balance?: string
  is_prepay_account?: boolean
}

/** « Permissions error » seul ne dit pas où Meta bloque : chaque étape signe son erreur. */
function step<T>(name: string, p: Promise<T>) {
  return p.catch((e: { statusMessage?: string }) => {
    throw createError({ statusCode: 502, statusMessage: `${e.statusMessage ?? 'Meta : échec'} (${name})` })
  })
}

function tagOf(link?: string) {
  try {
    return link ? new URL(link).searchParams.get('c') : null
  } catch {
    return null
  }
}

async function ads(accountId: string) {
  const token = userToken()
  let page = await get<Paged<Ad>>(`${accountId}/ads`, token, {
    limit: 200,
    filtering: [{ field: 'effective_status', operator: 'IN', value: STATUSES }],
    fields: 'effective_status,campaign{id,name,effective_status,lifetime_budget,daily_budget},adset{lifetime_budget,daily_budget,end_time},'
      + 'creative{object_story_id,effective_object_story_id,effective_instagram_media_id,source_instagram_media_id,call_to_action},'
      + 'insights.date_preset(maximum){spend,inline_link_clicks}',
  })
  const rows = [...page.data]
  while (page.paging?.next) {
    page = await get<Paged<Ad>>(page.paging.next, token)
    rows.push(...page.data)
  }
  return rows
}

/** Une pub telle que la page la montre ; c'est la campagne qu'on lance ou qu'on met en pause. */
function promo(a: Ad) {
  const link = a.creative?.call_to_action?.value?.link
  const ended = !!a.adset?.end_time && Date.parse(a.adset.end_time) < Date.now()
  // Le budget est sur l'ensemble de pubs, ou sur la campagne quand Meta l'y a mis (boosts de l'appli).
  const b = a.adset?.lifetime_budget || a.adset?.daily_budget ? a.adset : a.campaign
  return {
    id: a.id,
    campaign: a.campaign?.id ?? '',
    /** Le nom que Meta donne au boost, nettoyé comme dans meta.get.ts. */
    title: (a.campaign?.name ?? '').replace(/^(Instagram post|Publication)\s*:\s*«?\s*/, '').split('\n')[0]!.replace(/\s*»$/, ''),
    status: ended ? 'ENDED' : a.effective_status,
    running: !ended && a.campaign?.effective_status === 'ACTIVE',
    tag: tagOf(link),
    toSite: !!link?.includes('farnight.online'),
    /** Montants Meta en centimes de la devise du compte. */
    budget: b?.lifetime_budget ? num(b.lifetime_budget) / 100 : b?.daily_budget ? num(b.daily_budget) / 100 : null,
    daily: !b?.lifetime_budget && !!b?.daily_budget,
    spend: num(a.insights?.data[0]?.spend),
    clicks: num(a.insights?.data[0]?.inline_link_clicks),
  }
}

/** Ce que la page dit d'une audience enregistrée : où, qui, et ce qui l'intéresse. */
function audience(a: { id: string; name: string; targeting: Targeting }) {
  const t = a.targeting
  return {
    id: a.id,
    name: a.name,
    places: placesOf(t.geo_locations).map(label),
    excluded: placesOf(t.excluded_geo_locations).map(label),
    age: `${t.age_min ?? 18}–${t.age_max ?? 65} ans`,
    // Meta : 1 = hommes, 2 = femmes ; les deux, ou rien, = tout le monde.
    genders: t.genders?.length === 1 && t.genders[0] ? (t.genders[0] === 1 ? 'hommes' : 'femmes') : 'tous',
    interests: (t.flexible_spec ?? []).flatMap(f => f.interests ?? []).map(i => i.name),
    /** Advantage+ audience : l'âge et les intérêts deviennent des suggestions, Meta peut élargir. */
    advantage: t.targeting_automation?.advantage_audience === 1,
    /** Un groupe du poste, que la page peut modifier ou supprimer ; les audiences de Meta se gèrent chez Meta. */
    local: a.id.startsWith('g'),
    /** Le ciblage tel que le formulaire des groupes le règle, pour en reprendre un. */
    aim: {
      places: placesOf(t.geo_locations),
      excluded: placesOf(t.excluded_geo_locations),
      ageMin: t.age_min ?? 18,
      ageMax: t.age_max ?? 65,
      genders: t.genders ?? [],
      interests: (t.flexible_spec ?? []).flatMap(f => f.interests ?? []).flatMap(i => i.id ? [{ id: i.id, name: i.name }] : []),
    },
  }
}

/** Les audiences enregistrées de tous les comptes du jeton : celles de l'ancien compte servent aussi au nouveau. */
async function savedAudiences() {
  const { data } = await get<Paged<{ id: string; saved_audiences?: Paged<{ id: string; name: string; targeting: Targeting }> }>>(
    'me/adaccounts', userToken(), { fields: 'saved_audiences.limit(50){name,targeting}' },
  )
  return data.flatMap(a => a.saved_audiences?.data ?? [])
}

/* Les lieux */

/**
 * Un lieu tel que la recherche de Meta le rend (`type`, `key`), ou un point (`pin`) posé sur une adresse.
 * Rayon en kilomètres : 17 à 80 autour d'une ville (sans rayon, la ville seule), 1 à 80 autour d'un point.
 */
export type Place = { type: string; key: string; name: string; detail?: string; country?: string; region?: string; radius?: number; lat?: number; lng?: number }

/** Le champ de geo_locations de chaque type de lieu ; tous vérifiés par delivery_estimate le 17/10. */
export const GEO: Record<string, string> = {
  country: 'countries', country_group: 'country_groups', region: 'regions', large_geo_area: 'large_geo_areas',
  medium_geo_area: 'medium_geo_areas', city: 'cities', subcity: 'subcities', neighborhood: 'neighborhoods', zip: 'zips',
  geo_market: 'geo_markets', electoral_district: 'electoral_districts', pin: 'custom_locations',
}
const BY_FIELD = Object.fromEntries(Object.entries(GEO).map(([type, field]) => [field, type]))
const countryName = new Intl.DisplayNames(['fr'], { type: 'region' })

function geoOf(places: Place[]): Geo {
  const geo: Geo = {}
  for (const p of places) {
    const item = p.type === 'country' || p.type === 'country_group'
      ? p.key
      : p.type === 'pin'
        ? { latitude: p.lat, longitude: p.lng, radius: p.radius, distance_unit: 'kilometer', address_string: p.name }
        // Le pays et la région voyagent avec le lieu (Meta les garde) : la page y voit deux lieux qui se recouvrent.
        : { key: p.key, name: p.name, ...p.country ? { country: p.country } : {}, ...p.region ? { region_id: p.region } : {}, ...p.radius ? { radius: p.radius, distance_unit: 'kilometer' } : {} }
    ;(geo[GEO[p.type]!] ??= []).push(item)
  }
  return geo
}

/** Les lieux d'un ciblage, d'où qu'il vienne : un groupe du poste ou une audience faite chez Meta (rayons en miles possibles). */
function placesOf(geo?: Geo): Place[] {
  return Object.entries(geo ?? {}).flatMap(([field, items]) => {
    const type = BY_FIELD[field]
    if (!type || !Array.isArray(items)) return []
    return items.map((i): Place => {
      if (typeof i === 'string') return type === 'country' ? { type, key: i, name: countryName.of(i) ?? i, country: i } : { type, key: i, name: i }
      const radius = i.radius ? Math.round(i.distance_unit === 'mile' ? i.radius * 1.609 : i.radius) : undefined
      return type === 'pin'
        ? { type, key: `${i.latitude},${i.longitude}`, name: i.address_string ?? i.name ?? `${i.latitude}, ${i.longitude}`, lat: i.latitude, lng: i.longitude, radius }
        : { type, key: String(i.key), name: i.name ?? String(i.key), country: i.country, region: i.region_id ? String(i.region_id) : undefined, radius }
    })
  })
}
const label = (p: Place) => p.radius ? `${p.name} +${p.radius} km` : p.name

/** Les lieux que Meta connaît pour un mot, de tous les types que la page sait écrire. */
export async function places(q: string): Promise<Place[]> {
  const { data } = await get<Paged<{ key: string; name: string; type: string; country_code?: string; country_name?: string; region?: string; region_id?: number; country_codes?: string[] }>>(
    'search', userToken(), { type: 'adgeolocation', q, location_types: Object.keys(GEO).filter(t => t !== 'pin'), limit: 15 },
  )
  return data.filter(d => GEO[d.type]).map(d => ({
    type: d.type,
    key: d.key,
    name: d.name,
    detail: d.country_codes ? `${d.country_codes.length} pays` : [d.region, d.country_name].filter(Boolean).join(', '),
    country: d.type === 'country' ? d.key : d.country_code,
    region: d.region_id ? String(d.region_id) : undefined,
  }))
}

/** Les adresses d'OpenStreetMap pour poser un point : Meta n'a pas de recherche d'adresse dans son API. */
export async function addresses(q: string): Promise<Place[]> {
  type Found = { lat: string; lon: string; name?: string; display_name: string; address?: Record<string, string | undefined> }
  const found = await http<Found[]>('OpenStreetMap', 'https://nominatim.openstreetmap.org/search', {
    query: { q, format: 'jsonv2', addressdetails: 1, limit: 6, 'accept-language': 'fr' },
    headers: { 'User-Agent': 'FarNight admin (friend@farnight.online)' },
  })
  return found.map(f => {
    const a = f.address ?? {}
    const town = a.city ?? a.town ?? a.village ?? a.municipality
    const first = [a.house_number, a.road].filter(Boolean).join(' ') || f.name || f.display_name.split(', ')[0]
    const lat = Math.round(Number(f.lat) * 1e5) / 1e5
    const lng = Math.round(Number(f.lon) * 1e5) / 1e5
    return { type: 'pin', key: `${lat},${lng}`, name: [...new Set([first, town])].filter(Boolean).join(', '), detail: f.display_name, country: a.country_code?.toUpperCase(), lat, lng, radius: 5 }
  })
}

/* Les groupes de cibles du poste */

export type Aim = { places: Place[]; excluded: Place[]; ageMin: number; ageMax: number; genders: number[]; interests: { id: string; name: string }[] }
type Group = { id: string; name: string; targeting: Targeting; at: string }
const GROUPS = 'socials:audiences'
const groups = async () => (await useStorage('data').getItem<Group[]>(GROUPS)) ?? []

/** Le ciblage du formulaire. Sans Advantage+ audience, l'âge, les lieux et les intérêts restent des limites et non des suggestions. */
function targetingOf(a: Aim): Targeting {
  return {
    geo_locations: geoOf(a.places),
    ...a.excluded.length ? { excluded_geo_locations: geoOf(a.excluded) } : {},
    age_min: a.ageMin,
    age_max: a.ageMax,
    ...a.genders.length ? { genders: a.genders } : {},
    ...a.interests.length ? { flexible_spec: [{ interests: a.interests }] } : {},
    targeting_automation: { advantage_audience: 0 },
  }
}

/** Range le groupe ; avec son `id` il est modifié en place (les pubs à venir le suivent), et un groupe du même nom est remplacé. */
export async function saveGroup(name: string, a: Aim, id?: string) {
  const g: Group = { id: id ?? `g${Date.now()}`, name, targeting: targetingOf(a), at: new Date().toISOString() }
  await useStorage('data').setItem(GROUPS, [...(await groups()).filter(x => x.name !== name && x.id !== id), g])
  return audience(g)
}

export async function dropGroup(id: string) {
  await useStorage('data').setItem(GROUPS, (await groups()).filter(g => g.id !== id))
}

/** Les intérêts que Meta propose pour un mot, avec le nombre de personnes de chacun. */
export async function interests(q: string) {
  const { data } = await get<Paged<{ id: string; name: string; audience_size_upper_bound?: number; path?: string[] }>>(
    'search', userToken(), { type: 'adinterest', q, limit: 12 },
  )
  return data.map(i => ({ id: i.id, name: i.name, size: i.audience_size_upper_bound ?? null, path: (i.path ?? []).slice(1, -1).join(' › ') }))
}

/** Combien de personnes le ciblage touche chaque mois. Meta refuse ici un intérêt retiré, et nomme son remplaçant. */
export async function estimate(a: Aim) {
  const acc = await account()
  const { data } = await step('estimation', get<Paged<{ estimate_mau_lower_bound?: number; estimate_mau_upper_bound?: number }>>(
    `${acc.id}/delivery_estimate`, userToken(), { optimization_goal: 'LINK_CLICKS', targeting_spec: targetingOf(a) },
  ))
  return { min: data[0]?.estimate_mau_lower_bound ?? null, max: data[0]?.estimate_mau_upper_bound ?? null }
}

/* La caisse */

/** Un compte pub tel que la caisse le montre, en unités de sa devise. */
function till(a: Account) {
  const cap = num(a.spend_cap) / 100
  const spent = num(a.amount_spent) / 100
  return {
    id: a.id,
    name: a.name,
    currency: a.currency,
    prepaid: !!a.is_prepay_account,
    spent,
    /** Dépensé et pas encore prélevé sur la carte. */
    due: num(a.balance) / 100,
    /** 0 chez Meta = aucun plafond. */
    cap: cap || null,
    left: cap ? Math.max(0, cap - spent) : null,
    /** La page du compte dans le Billing Hub, où l'on ajoute des fonds : elle refuse de s'ouvrir dans une autre page. */
    billing: `https://business.facebook.com/latest/billing_hub/accounts/details/?${new URLSearchParams({
      payment_account_id: a.id.replace(/^act_/, ''),
      asset_id: a.id.replace(/^act_/, ''),
      ...a.business ? { business_id: a.business.id, global_scope_id: a.business.id } : {},
    })}`,
  }
}

/**
 * Ce que le compte pub a payé, doit et peut encore dépenser. Meta n'a pas d'API pour payer : le plafond
 * est la seule commande d'argent qu'il ouvre. Les autres comptes du jeton (l'ancien prépayé) viennent en lecture.
 */
export async function wallet() {
  const acc = await account()
  const [funding, rows] = await Promise.all([
    get<{ funding_source_details?: { display_string?: string } }>(acc.id, userToken(), { fields: 'funding_source_details' })
      .then(r => r.funding_source_details?.display_string ?? null, () => null),
    ads(acc.id),
  ])
  // Le budget est celui de la campagne ; ses pubs se partagent la dépense.
  const running = new Map<string, { budget: number | null; daily: boolean; spend: number }>()
  for (const p of rows.map(promo).filter(p => p.running)) {
    const c = running.get(p.campaign) ?? { budget: p.budget, daily: p.daily, spend: 0 }
    c.spend += p.spend
    running.set(p.campaign, c)
  }
  const live = [...running.values()]
  return {
    ...till(acc),
    funding,
    running: live.length,
    /** Ce que les budgets totaux des campagnes en marche peuvent encore dépenser. */
    engaged: live.filter(c => !c.daily).reduce((t, c) => t + Math.max(0, (c.budget ?? 0) - c.spend), 0),
    /** Un budget quotidien n'a pas de reste : il dépense chaque jour jusqu'à la fin. */
    perDay: live.filter(c => c.daily).reduce((t, c) => t + (c.budget ?? 0), 0),
    others: acc.others.map(till),
  }
}

/** Fixe le plafond du compte, en unités : Meta le lit en centimes mais l'écrit en euros. null le retire. 10 changements par jour au plus. */
export async function setCap(amount: number | null) {
  const acc = await account()
  await step('plafond du compte', post(acc.id, userToken(), amount == null ? { spend_cap_action: 'delete' } : { spend_cap: amount }))
}

type Post = { id: string; at: string; excerpt: string; thumb?: string; url?: string; eligible: boolean | null }

async function instagramPosts(): Promise<Post[]> {
  const { ig } = await igAccount()
  const { data } = await get<Paged<{ id: string; caption?: string; media_url?: string; thumbnail_url?: string; permalink?: string; timestamp: string }>>(
    `${ig.id}/media`, userToken(), { fields: 'caption,media_url,thumbnail_url,permalink,timestamp', limit: POSTS },
  )
  return data.map(m => ({ id: m.id, at: m.timestamp, excerpt: excerptOf(m.caption), thumb: m.thumbnail_url ?? m.media_url, url: m.permalink, eligible: null }))
}

async function facebookPosts(): Promise<Post[]> {
  const page = await findPage()
  const { data } = await get<Paged<{ id: string; message?: string; created_time: string; permalink_url?: string; full_picture?: string; is_eligible_for_promotion?: boolean }>>(
    `${page.id}/published_posts`, page.access_token, { fields: 'message,created_time,permalink_url,full_picture,is_eligible_for_promotion', limit: POSTS },
  )
  return data.map(p => ({ id: p.id, at: p.created_time, excerpt: excerptOf(p.message), thumb: p.full_picture, url: p.permalink_url, eligible: p.is_eligible_for_promotion ?? null }))
}

/** Les derniers posts du réseau, leurs pubs, et ce qu'il faut pour en créer une. */
export async function board(network: Spec['network']) {
  const acc = await account()
  const [all, posts, { data: perms }, saved, local] = await Promise.all([
    ads(acc.id),
    network === 'instagram' ? instagramPosts() : facebookPosts(),
    get<Paged<{ permission: string; status: string }>>('me/permissions', userToken()),
    savedAudiences(),
    groups(),
  ])
  // Un boost d'Instagram garde le post d'origine dans source_instagram_media_id ; l'« effective » est sa copie publicitaire.
  const owners = (a: Ad) => network === 'instagram'
    ? [a.creative?.source_instagram_media_id, a.creative?.effective_instagram_media_id]
    : [a.creative?.object_story_id, a.creative?.effective_object_story_id]
  const linked = new Set(all.filter(a => posts.some(p => owners(a).includes(p.id))).map(a => a.id))
  // Le rôle sur le compte pub ne se juge pas d'avance : user_tasks disait ANALYZE quand Meta acceptait déjà la campagne.
  // Sans lui, Meta refuse à la création, et son message le dit.
  const blocked = perms.some(p => p.permission === 'ads_management' && p.status === 'granted')
    ? null
    : 'Le jeton n’a pas ads_management : régénérer META_ADS_TOKEN en l’ajoutant.'
  const used = all.map(a => tagOf(a.creative?.call_to_action?.value?.link)?.match(/^e(\d+)$/)?.[1]).filter(Boolean).map(Number)
  return {
    currency: acc.currency,
    writable: !blocked,
    /** Ce qui empêche de créer ou de mettre en pause : la permission du jeton. */
    blocked,
    /** Les pubs Meta s'étiquettent e1, e2… (t1… pour TikTok) : la suivante libre. */
    nextTag: `e${Math.max(0, ...used) + 1}`,
    audiences: [...saved, ...local].map(audience),
    posts: posts.map(p => ({ ...p, ads: all.filter(a => owners(a).includes(p.id)).map(promo) })),
    /**
     * Les pubs encore en vie d'aucun post listé : un post plus ancien, ou une pub montée avec son
     * propre post invisible (Meta en crée un, avec une vidéo à lui). Celles tirées d'Instagram vont
     * dans l'onglet Instagram, les autres dans l'onglet Facebook.
     */
    others: all
      .filter(a => !linked.has(a.id) && !!a.creative?.source_instagram_media_id === (network === 'instagram'))
      .map(promo)
      .filter(a => a.status !== 'ENDED' && a.status !== 'ARCHIVED'),
  }
}

/** Monte la campagne, l'ensemble de pubs, la créa tirée du post et la pub ; la campagne reste en pause. */
export async function promote(s: Spec) {
  const token = userToken()
  const acc = await account()
  // Instagram exige le compte Instagram sur la créa, même pour un post Facebook qui y passe.
  const { page, ig } = s.network === 'instagram' || s.placements !== 'facebook' ? await igAccount() : { page: await findPage(), ig: null }
  const platforms = s.placements === 'both' ? ['instagram', 'facebook'] : [s.placements]
  // Une audience enregistrée ou un groupe garde ses lieux, âges, intérêts et son Advantage+ ; seuls les emplacements viennent du formulaire.
  const kept = s.audience.startsWith('g')
    ? (await groups()).find(g => g.id === s.audience)?.targeting
    : (await step('lecture de l’audience', get<{ targeting: Targeting }>(s.audience, token, { fields: 'targeting' }))).targeting
  if (!kept) throw bad('groupe introuvable : relire la page')
  const targeting = {
    ...Object.fromEntries(Object.entries(kept).filter(([k]) => !k.endsWith('_positions'))),
    publisher_platforms: platforms,
  }
  // Le nom que Meta donne lui-même aux boosts : le moniteur y lit l'origine du post.
  const name = (s.network === 'instagram' ? `Instagram post: ${s.excerpt}` : `Publication : « ${s.excerpt} »`).slice(0, 200)
  const campaign = await step('création de la campagne', post<{ id: string }>(`${acc.id}/campaigns`, token, {
    name, objective: 'OUTCOME_TRAFFIC', status: 'PAUSED', special_ad_categories: [], is_adset_budget_sharing_enabled: false,
  }))
  try {
    const start = Math.floor(Date.now() / 1000)
    const adset = await step('ensemble de pubs', post<{ id: string }>(`${acc.id}/adsets`, token, {
      name,
      campaign_id: campaign.id,
      status: 'ACTIVE',
      lifetime_budget: Math.round(s.budget * 100),
      start_time: start,
      end_time: start + s.days * 86400,
      billing_event: 'IMPRESSIONS',
      optimization_goal: 'LINK_CLICKS',
      bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
      destination_type: 'WEBSITE',
      targeting,
      // Règle européenne (DSA) : qui profite de la pub et qui la paie. Les noms par défaut du compte, sinon ceux des boosts de l'appli.
      dsa_beneficiary: acc.default_dsa_beneficiary ?? 'FarNight',
      dsa_payor: acc.default_dsa_payor ?? 'FarNight',
    }))
    const cta = { type: 'LEARN_MORE', value: { link: s.link } }
    const creative = await step('créa tirée du post', post<{ id: string }>(`${acc.id}/adcreatives`, token, s.network === 'instagram'
      ? { name, object_id: page.id, instagram_user_id: ig!.id, source_instagram_media_id: s.post, call_to_action: cta }
      : { name, object_story_id: s.post, instagram_user_id: ig?.id, call_to_action: cta }))
    const ad = await step('pub', post<{ id: string }>(`${acc.id}/ads`, token, { name, adset_id: adset.id, creative: { creative_id: creative.id }, status: 'ACTIVE' }))
    return { campaign: campaign.id, ad: ad.id, tag: tagOf(s.link) }
  } catch (e) {
    // Une campagne à moitié montée ne reste pas dans le compte : on la retire, ensemble compris.
    await post(campaign.id, token, { status: 'DELETED' }).catch(() => {})
    throw e
  }
}

/** Lance ou met en pause la campagne de la pub. */
export async function setStatus(campaign: string, status: 'ACTIVE' | 'PAUSED') {
  const token = userToken()
  if (status === 'ACTIVE') {
    // Créée en pause et lancée plus tard : tant qu'elle n'a rien dépensé, sa fin recule pour garder toute sa durée.
    // Seule la fin bouge : Meta refuse de toucher au début d'un ensemble dont l'heure est passée.
    const { data } = await get<Paged<{ id: string; start_time: string; end_time?: string; insights?: { data: { spend?: string }[] } }>>(
      `${campaign}/adsets`, token, { fields: 'start_time,end_time,insights.date_preset(maximum){spend}' },
    )
    const now = Math.floor(Date.now() / 1000)
    for (const a of data) {
      const start = Math.floor(Date.parse(a.start_time) / 1000)
      if (!a.end_time || num(a.insights?.data[0]?.spend) > 0 || start > now) continue
      await step('dates de l’ensemble de pubs', post(a.id, token, { end_time: now + Math.floor(Date.parse(a.end_time) / 1000) - start }))
    }
  }
  await step(status === 'ACTIVE' ? 'lancement de la campagne' : 'pause de la campagne', post(campaign, token, { status }))
}

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
 */
import { findPage, get, igAccount, post, userToken } from './meta'

export type Placement = 'instagram' | 'facebook' | 'both'
export type Spec = {
  network: 'instagram' | 'facebook'
  post: string
  excerpt: string
  /** Budget total, dans la devise du compte. */
  budget: number
  days: number
  /** Une audience enregistrée du compte ; sans elle, les pays et l'âge du formulaire. */
  audience: string | null
  countries: string[]
  ageMin: number
  ageMax: number
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
  geo_locations?: { countries?: string[]; regions?: { name: string }[]; cities?: { name: string }[]; zips?: { name: string }[] }
  flexible_spec?: { interests?: { name: string }[] }[]
  targeting_automation?: { advantage_audience?: number }
  [key: string]: unknown
}
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
  const { data } = await get<Paged<{ id: string; currency: string; business?: { id: string }; default_dsa_beneficiary?: string; default_dsa_payor?: string }>>(
    'me/adaccounts', userToken(), { fields: 'currency,business,default_dsa_beneficiary,default_dsa_payor' },
  )
  const acc = data.find(a => a.business) ?? data[0]
  if (!acc) throw createError({ statusCode: 502, statusMessage: 'Meta : aucun compte publicitaire pour ce jeton' })
  return acc
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
  const g = t.geo_locations ?? {}
  return {
    id: a.id,
    name: a.name,
    places: [...g.countries ?? [], ...[...g.regions ?? [], ...g.cities ?? [], ...g.zips ?? []].map(l => l.name)],
    age: `${t.age_min ?? 18}–${t.age_max ?? 65} ans`,
    // Meta : 1 = hommes, 2 = femmes ; les deux, ou rien, = tout le monde.
    genders: t.genders?.length === 1 && t.genders[0] ? (t.genders[0] === 1 ? 'hommes' : 'femmes') : 'tous',
    interests: (t.flexible_spec ?? []).flatMap(f => f.interests ?? []).map(i => i.name),
    /** Advantage+ audience : l'âge et les intérêts deviennent des suggestions, Meta peut élargir. */
    advantage: t.targeting_automation?.advantage_audience === 1,
  }
}

/** Les audiences enregistrées de tous les comptes du jeton : celles de l'ancien compte servent aussi au nouveau. */
async function savedAudiences() {
  const { data } = await get<Paged<{ id: string; saved_audiences?: Paged<{ id: string; name: string; targeting: Targeting }> }>>(
    'me/adaccounts', userToken(), { fields: 'saved_audiences.limit(50){name,targeting}' },
  )
  return data.flatMap(a => a.saved_audiences?.data ?? [])
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
  const [all, posts, { data: perms }, saved] = await Promise.all([
    ads(acc.id),
    network === 'instagram' ? instagramPosts() : facebookPosts(),
    get<Paged<{ permission: string; status: string }>>('me/permissions', userToken()),
    savedAudiences(),
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
    audiences: saved.map(audience),
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
  // Une audience enregistrée garde ses lieux, âges, intérêts et son Advantage+ ; seuls les emplacements viennent du formulaire.
  const targeting = s.audience
    ? {
        ...Object.fromEntries(Object.entries((await step('lecture de l’audience', get<{ targeting: Targeting }>(s.audience, token, { fields: 'targeting' }))).targeting).filter(([k]) => !k.endsWith('_positions'))),
        publisher_platforms: platforms,
      }
    : {
        geo_locations: { countries: s.countries },
        age_min: s.ageMin,
        age_max: s.ageMax,
        publisher_platforms: platforms,
        // Sans Advantage+ audience, l'âge et les pays restent des limites et non des suggestions.
        targeting_automation: { advantage_audience: 0 },
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
    // Créée en pause et lancée plus tard : tant qu'elle n'a rien dépensé, ses dates glissent pour garder toute sa durée.
    const { data } = await get<Paged<{ id: string; start_time: string; end_time?: string; insights?: { data: { spend?: string }[] } }>>(
      `${campaign}/adsets`, token, { fields: 'start_time,end_time,insights.date_preset(maximum){spend}' },
    )
    const now = Math.floor(Date.now() / 1000)
    for (const a of data) {
      const start = Math.floor(Date.parse(a.start_time) / 1000)
      if (!a.end_time || num(a.insights?.data[0]?.spend) > 0 || start > now) continue
      await step('dates de l’ensemble de pubs', post(a.id, token, { start_time: now, end_time: now + Math.floor(Date.parse(a.end_time) / 1000) - start }))
    }
  }
  await step(status === 'ACTIVE' ? 'lancement de la campagne' : 'pause de la campagne', post(campaign, token, { status }))
}

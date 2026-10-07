import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import type { LimitsConfig } from '~/types/script'
import { requireSecret } from '~/server/utils/runtime-secrets'
import { isLocal } from '~/utils/app-env'

/**
 * Quota par session, tenu dans un cookie signé.
 *
 * Le problème visé est précis : un visiteur qui recharge la page en boucle
 * relance une génération de scène à chaque fois. Le compteur ne peut pas vivre
 * côté client — il serait remis à zéro — ni en mémoire serveur : sur Vercel
 * chaque invocation peut tomber sur une lambda différente.
 *
 * D'où le cookie signé en HMAC : il survit au rechargement, il voyage avec le
 * visiteur, et il est infalsifiable sans la clé. Effacer ses cookies le
 * réinitialise — c'est la limite assumée de cette approche, qui arrête l'abus
 * ordinaire sans exiger de base de données.
 */

const COOKIE = 'tg_quota'
const ACCESS_COOKIE = 'tg_access'
const LOCK_COOKIE = 'tg_lock'
const POSITION_COOKIE = 'tg_pos'

export interface SessionQuota {
  /** Identifiant de session, pour le diagnostic. */
  sid: string
  /** Générations de scène consommées. */
  scenes: number
  /** Tours de narration consommés. */
  turns: number
  /** Images générées. */
  images: number
  /** Date d'ouverture de la session, en millisecondes. */
  since: number
  /**
   * Tours joués DANS LA SCÈNE EN COURS.
   *
   * Remis à zéro à chaque scène servie. C'est le seul compteur qui permette au
   * serveur de constater qu'un joueur tourne en rond sans que le client ait à
   * le lui dire — `turnCount` vient du navigateur, il se falsifie.
   */
  scene_turns?: number
  /**
   * Échéance du verrou en cours, recopiée ici à la fermeture.
   *
   * Le cookie de verrou meurt tout seul à l'expiration, et avec lui la seule
   * trace que la scène avait été fermée. Sans ce doublon, le joueur qui revient
   * après le cycle reprend la scène que son navigateur a gardée — donc SANS
   * demander de scène neuve, donc sans remise à zéro de `scene_turns` — et se
   * fait refermer au premier tour, un cycle après l'autre, indéfiniment.
   */
  locked_until?: number
}

/**
 * Fermeture de la ville. Signée, donc infalsifiable.
 *
 * Deux motifs, deux durées. `stalled` : le joueur a passé une scène entière
 * sans en sortir, la ville se recharge le temps d'un cycle. `completed` : il a
 * traversé toute l'histoire, et elle ne se rejoue pas — ce monde-là était le
 * sien, il n'y en aura pas d'autre.
 */
export interface LockPass {
  /** Fin de la fermeture, en millisecondes. */
  until: number
  reason: 'stalled' | 'completed'
  /**
   * Le texte de l'écran, écrit pour CE joueur par le modèle : le `game_over` de
   * la scène qui s'est refermée, ou l'adieu de l'épilogue.
   *
   * Rangé dans le cookie et non côté client : c'est la seule façon qu'il
   * survive à un rechargement, à un autre onglet, à un autre jour. Court par
   * nécessité — un cookie plafonne autour de 4 ko.
   */
  text?: string
}

/** Droit d'accès ouvert par le paiement. Signé, donc infalsifiable. */
export interface AccessPass {
  /** Identifiant du paiement Square, pour le rapprochement comptable. */
  payment_id: string
  paid_at: number
  expires_at: number
}

/**
 * Où le joueur en est, en termes de scène.
 *
 * Le navigateur garde déjà la partie — la scène, le journal, l'inventaire. Mais
 * il ne peut pas décider seul jusqu'où le joueur a le droit de reprendre : la
 * première scène est gratuite, toutes les suivantes sont derrière le sas. Cette
 * position-là est donc tenue par le serveur, signée comme le droit d'accès —
 * sans quoi il suffirait de l'écrire à la main pour se faire servir une scène
 * tardive sans avoir payé.
 *
 * Ne porte AUCUNE donnée personnelle : un identifiant de scène et un rang, rien
 * d'autre. Le profil Meta ne quitte jamais la machine du joueur.
 */
export interface PositionPass {
  scene_id: string
  /** Rang dans `progression.order`. C'est lui qui dit si la scène est gratuite. */
  index: number
  /** Dernier passage, en millisecondes. */
  at: number
  /**
   * Le texte de fermeture de CETTE scène, tel que le modèle l'a écrit.
   *
   * C'est ce qui rend le game over propre à chaque scène sans rien demander au
   * navigateur : la scène servie dépose son texte ici, et le verrou le reprend
   * au moment de refermer. Le client n'a donc jamais à le renvoyer — il ne
   * pourrait ni le prouver, ni le retrouver après un rechargement.
   */
  game_over?: string
}

function freshQuota(): SessionQuota {
  return { sid: randomUUID(), scenes: 0, turns: 0, images: 0, since: Date.now(), scene_turns: 0 }
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

/** Comparaison à temps constant : une égalité naïve fuite la signature. */
function signatureMatches(expected: string, received: string): boolean {
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Encode et signe une charge utile quelconque. */
function seal(value: unknown, secret: string): string {
  const payload = Buffer.from(JSON.stringify(value), 'utf-8').toString('base64url')
  return `${payload}.${sign(payload, secret)}`
}

/** Vérifie la signature et décode. Null si absent, falsifié ou illisible. */
function unseal<T>(raw: string | undefined, secret: string): T | null {
  if (!raw) return null
  const separator = raw.lastIndexOf('.')
  if (separator < 1) return null

  const payload = raw.slice(0, separator)
  if (!signatureMatches(sign(payload, secret), raw.slice(separator + 1))) return null

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as T
  } catch {
    return null
  }
}

/**
 * Ouvre l'accès à la suite pour la durée prévue au script.
 *
 * Le cookie précédent était en clair, avec une valeur fixe : n'importe qui
 * pouvait l'envoyer et débloquer la suite sans payer. Celui-ci est signé.
 */
export function grantAccess(event: H3Event, paymentId: string, windowDays: number): AccessPass {
  const secret = requireSecret(useRuntimeConfig().nuxtSecret, 'NUXT_SECRET')
  const pass: AccessPass = {
    payment_id: paymentId,
    paid_at: Date.now(),
    expires_at: Date.now() + windowDays * 86_400_000,
  }

  setCookie(event, ACCESS_COOKIE, seal(pass, secret), {
    httpOnly: true,
    sameSite: 'lax',
    secure: !import.meta.dev,
    path: '/',
    maxAge: windowDays * 86_400,
  })
  return pass
}

/** Le droit d'accès en cours, ou null s'il est absent, falsifié ou expiré. */
export function readAccess(event: H3Event): AccessPass | null {
  const secret = requireSecret(useRuntimeConfig().nuxtSecret, 'NUXT_SECRET')
  const pass = unseal<AccessPass>(getCookie(event, ACCESS_COOKIE), secret)
  if (!pass?.expires_at || pass.expires_at < Date.now()) return null
  return pass
}

/**
 * Retire le droit d'accès : la nuit achetée a été jouée.
 *
 * Un paiement ouvre UNE nuit, pas une fenêtre de rejeu. Sans ce retrait, le
 * joueur qui s'endort reviendrait chaque jour refaire sa nuit, et c'est la
 * limite de tours par scène — non le nombre de nuits — qui borne la dépense
 * d'une vente. Rejouer passe donc par un nouveau paiement.
 */
export function revokeAccess(event: H3Event): void {
  deleteCookie(event, ACCESS_COOKIE, { path: '/' })
}

/**
 * Retient la scène servie.
 *
 * Écrit à chaque scène rendue : c'est le seul moment où le serveur sait avec
 * certitude où en est le joueur — le reste vient du navigateur, qui se
 * falsifie.
 *
 * @param windowDays aligné sur la fenêtre payante : la reprise doit tenir
 * aussi longtemps que le droit d'accès qui l'autorise.
 * @param gameOver le texte de fermeture écrit pour CETTE scène. Rangé ici parce
 * que c'est le seul endroit où le serveur le voit passer : quand la nuit se
 * refermera, il n'aura plus que ce cookie pour savoir quoi afficher.
 */
export function rememberPosition(
  event: H3Event, sceneId: string, index: number, windowDays: number, gameOver?: string,
): PositionPass {
  const secret = requireSecret(useRuntimeConfig().nuxtSecret, 'NUXT_SECRET')
  const position: PositionPass = { scene_id: sceneId, index, at: Date.now() }
  // Tronqué comme l'adieu : un cookie plafonne autour de 4 ko, et un texte
  // trop lourd ferait jeter la position tout entière, donc la reprise avec.
  if (gameOver) position.game_over = gameOver.slice(0, 700)

  setCookie(event, POSITION_COOKIE, seal(position, secret), {
    httpOnly: true,
    sameSite: 'lax',
    secure: !import.meta.dev,
    path: '/',
    maxAge: Math.ceil(windowDays * 86_400),
  })
  return position
}

/** Où le joueur en était, ou null si rien n'a été retenu ou si c'est falsifié. */
export function readPosition(event: H3Event): PositionPass | null {
  const secret = requireSecret(useRuntimeConfig().nuxtSecret, 'NUXT_SECRET')
  const position = unseal<PositionPass>(getCookie(event, POSITION_COOKIE), secret)
  if (!position?.scene_id || typeof position.index !== 'number') return null
  return position
}

/**
 * Oublie la position.
 *
 * Appelé quand l'histoire est allée jusqu'au bout : il n'y a plus rien à
 * reprendre, et laisser le cookie ferait proposer une reprise vers un épilogue
 * déjà lu.
 */
export function forgetPosition(event: H3Event): void {
  deleteCookie(event, POSITION_COOKIE, { path: '/' })
}

/**
 * Ferme la ville pour un cycle.
 *
 * Le joueur qui a tourné en rond toute une scène ne peut plus rien générer
 * jusqu'à l'expiration. Ce n'est pas une punition gratuite : chaque scène et
 * chaque tour coûtent des tokens, et la fenêtre ouverte par le paiement dure
 * plusieurs jours — sans ce frein, une partie qui patine peut consommer autant
 * qu'une partie entière, plusieurs fois de suite.
 *
 * `httpOnly`, signé, même mécanique que le quota : le client ne peut ni le lire
 * ni l'écrire. Effacer ses cookies le lève, mais fait perdre le droit d'accès
 * payant en même temps — un payant n'a donc aucun intérêt à le faire.
 */
export function lockOut(
  event: H3Event,
  hours: number,
  reason: LockPass['reason'],
  text?: string,
): LockPass {
  const secret = requireSecret(useRuntimeConfig().nuxtSecret, 'NUXT_SECRET')
  const lock: LockPass = { until: Date.now() + hours * 3600_000, reason }
  // Tronqué : au-delà, le cookie devient trop lourd et le navigateur le jette
  // en silence — on perdrait le verrou avec le texte.
  if (text) lock.text = text.slice(0, 700)

  setCookie(event, LOCK_COOKIE, seal(lock, secret), {
    httpOnly: true,
    sameSite: 'lax',
    secure: !import.meta.dev,
    path: '/',
    maxAge: Math.ceil(hours * 3600),
  })
  return lock
}

/** Le verrou en cours, ou null s'il est absent, falsifié ou expiré. */
export function readLock(event: H3Event): LockPass | null {
  const secret = requireSecret(useRuntimeConfig().nuxtSecret, 'NUXT_SECRET')
  const lock = unseal<LockPass>(getCookie(event, LOCK_COOKIE), secret)
  if (!lock?.until || lock.until < Date.now()) return null
  return lock
}

/**
 * Lève le verrou. Réservé au développement et aux phases de test.
 *
 * Effacer le cookie ne suffit pas : `scene_turns` reste plein dans le quota, et
 * le tour suivant refermerait aussitôt. On rend donc ses tours à la scène.
 */
export function clearLock(event: H3Event, limits: LimitsConfig): void {
  deleteCookie(event, LOCK_COOKIE, { path: '/' })
  const windowHours = readAccess(event) ? limits.paid.window_days * 24 : limits.window_hours
  const quota = readQuota(event, windowHours)
  quota.scene_turns = 0
  delete quota.locked_until
  writeQuota(event, quota, windowHours)
}

/**
 * Oublie tout ce que le serveur a confié au navigateur : quota, accès payé,
 * verrou, position. Réservé au développement et aux phases de test — c'est le
 * bouton « vider la mémoire » de l'accueil. La langue reste : c'est un réglage,
 * pas une partie.
 */
export function forgetEverything(event: H3Event): void {
  for (const name of [COOKIE, ACCESS_COOKIE, LOCK_COOKIE, POSITION_COOKIE]) {
    deleteCookie(event, name, { path: '/' })
  }
}

/**
 * Referme la scène en cours : le game over.
 *
 * Un seul chemin, deux appelants — le client au moment où la nuit se referme à
 * l'écran, et `consumeQuota` qui compte les tours de son côté et n'attend
 * l'accord de personne. Les deux doivent produire exactement le même verrou,
 * sinon la fermeture dépendrait de qui l'a demandée en premier.
 *
 * Le texte affiché vient de la POSITION, déposée par la scène quand elle a été
 * servie : c'est ce qui rend le game over propre à chaque scène sans jamais
 * croire le navigateur sur parole.
 */
export function closeForStalling(event: H3Event, limits: LimitsConfig): LockPass {
  // Déjà fermée : on ne repousse pas l'échéance, sinon un joueur qui insiste
  // repartirait pour un cycle entier à chaque tentative.
  const existing = readLock(event)
  if (existing) return existing

  const lock = lockOut(event, limits.lock.hours, 'stalled', readPosition(event)?.game_over)

  // On note l'échéance dans le quota : c'est elle qui, une fois passée, rendra
  // ses tours à la scène. Le cookie de verrou, lui, aura disparu sans laisser
  // de trace — voir `locked_until`.
  const windowHours = readAccess(event) ? limits.paid.window_days * 24 : limits.window_hours
  const quota = readQuota(event, windowHours)
  quota.locked_until = lock.until
  writeQuota(event, quota, windowHours)

  return lock
}

/**
 * Refuse toute requête coûteuse tant que le verrou tient.
 *
 * 423 et non 429 : ce n'est pas un quota atteint, c'est un accès suspendu. Le
 * client s'en sert pour montrer l'écran d'attente plutôt qu'une erreur.
 */
export function assertNotLocked(event: H3Event, message?: string): void {
  const lock = readLock(event)
  if (!lock) return
  throw createError({
    statusCode: 423,
    // Le message vient du pack de langue quand l'appelant en a un sous la
    // main. Le repli français reste pour les routes qui n'affichent rien —
    // le paiement, qui a son propre écran d'erreur.
    statusMessage: message ?? 'La ville se recharge.',
    // Le texte voyage avec le refus : un client qui découvre la fermeture ici
    // — autre onglet, cookie posé entre-temps — a de quoi montrer le bon écran
    // sans redemander quoi que ce soit.
    data: { lockedUntil: lock.until, text: lock.text },
  })
}

export function readQuota(event: H3Event, windowHours: number): SessionQuota {
  const secret = requireSecret(useRuntimeConfig().nuxtSecret, 'NUXT_SECRET')
  const raw = getCookie(event, COOKIE)
  if (!raw) return freshQuota()

  const separator = raw.lastIndexOf('.')
  if (separator < 1) return freshQuota()

  const payload = raw.slice(0, separator)
  const signature = raw.slice(separator + 1)
  if (!signatureMatches(sign(payload, secret), signature)) return freshQuota()

  let quota: SessionQuota
  try {
    quota = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8')) as SessionQuota
  } catch {
    return freshQuota()
  }

  // Fenêtre glissante : au-delà, la session repart à zéro.
  if (!quota.since || Date.now() - quota.since > windowHours * 3600_000) return freshQuota()

  /**
   * Le cycle est passé : la scène repart avec ses tours entiers.
   *
   * Sans cette remise à zéro, le joueur qui revient au bout des 24 h reprend la
   * scène que son navigateur a gardée — donc sans demander de scène neuve, donc
   * sans rien remettre à zéro — et se fait refermer au premier tour. Le verrou
   * cesserait d'être un cycle pour devenir une condamnation.
   */
  if (quota.locked_until && quota.locked_until <= Date.now()) {
    quota.scene_turns = 0
    delete quota.locked_until
  }
  return quota
}

/**
 * @param windowHours durée de vie du cookie, alignée sur la fenêtre en cours.
 *
 * Elle valait 24 h en dur. Pour un joueur ayant payé, dont la fenêtre dure
 * plusieurs jours, le cookie mourait donc chaque nuit et les compteurs
 * repartaient de zéro : le plafond payant ne bornait rien du tout.
 */
export function writeQuota(event: H3Event, quota: SessionQuota, windowHours: number): void {
  const secret = requireSecret(useRuntimeConfig().nuxtSecret, 'NUXT_SECRET')
  const payload = Buffer.from(JSON.stringify(quota), 'utf-8').toString('base64url')

  setCookie(event, COOKIE, `${payload}.${sign(payload, secret)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: !import.meta.dev,
    path: '/',
    maxAge: Math.ceil(windowHours * 3600),
  })
}

/**
 * Consomme une unité du quota, ou refuse la requête.
 *
 * Deux mécanismes distincts vivent ici, et ils ne répondent pas à la même
 * question.
 *
 * Le QUOTA borne la dépense : combien de scènes, de tours et d'images sur la
 * fenêtre. Il dépend du droit d'accès — un visiteur qui a payé dispose d'une
 * fenêtre bien plus large — et il se désactive en développement.
 *
 * Le VERROU borne le temps : un joueur qui a passé toute une scène sans en
 * sortir ne rejoue pas avant un cycle complet. C'est une règle de jeu, pas une
 * borne de dépense ; elle s'applique donc toujours, quotas éteints et
 * développement compris — sinon elle serait intestable. Et c'est elle qui rend
 * la fenêtre payante tenable : sans frein, une partie qui patine consomme
 * autant qu'une partie entière, plusieurs fois par jour.
 */
export function consumeQuota(
  event: H3Event,
  kind: 'scenes' | 'turns' | 'images',
  limits: LimitsConfig
): SessionQuota {
  const access = readAccess(event)
  const windowHours = access ? limits.paid.window_days * 24 : limits.window_hours
  const quota = readQuota(event, windowHours)

  const lock = limits.lock
  if (kind === 'scenes') {
    // Une scène neuve remet le compteur à zéro : c'est ce qui distingue
    // « il avance » de « il tourne en rond ».
    quota.scene_turns = 0
  } else if (kind === 'turns' && lock?.turns_per_scene) {
    const played = quota.scene_turns ?? 0
    if (played >= lock.turns_per_scene) {
      const closed = closeForStalling(event, limits)
      throw createError({
        statusCode: 423,
        statusMessage: lock.message,
        data: { lockedUntil: closed.until, text: closed.text },
      })
    }
    quota.scene_turns = played + 1
  }

  // Interrupteur global, et local : dans les deux cas on ne décompte
  // rien. Le premier est temporaire — le laisser à false en production revient
  // à n'avoir aucune borne de dépense.
  if (limits.enabled && !isLocal()) {
    const limit = access
      ? limits.paid[`${kind}_per_window` as const]
      : limits[`${kind}_per_session` as const]

    if (quota[kind] >= limit) {
      throw createError({
        statusCode: 429,
        statusMessage: access ? limits.paid.messages[kind] : limits.messages[kind],
      })
    }
    quota[kind] += 1
  }

  writeQuota(event, quota, windowHours)
  return quota
}

/**
 * Le bouton « Développer » de /nimda/socials : ce qui est écrit dans le champ
 * sert de matière et de consigne, Claude le développe en post fini pour le
 * réseau et le format choisis, en voyant les images jointes (et la première
 * image de chaque vidéo). La route est server/api/admin/socials/develop.post.ts.
 *
 * Fonction pure, sans Nitro : le prompt se rend hors ligne, sans appel.
 */

type TextFormat = { id: string; label: string; text?: { label: string; max: number }; title?: { label: string; max: number } }

/** Ce que Claude doit savoir du jeu pour en parler, et ce qu'il ne doit jamais écrire. */
export const BRIEF = `CE QU'IL FAUT SAVOIR DU JEU
- Titres : « La Nuit du Bout du Monde » en français, « Far Night » dans toutes les autres langues. Ce sont deux noms, pas une traduction l'un de l'autre.
- Un jeu qui se joue dans le navigateur : une nuit, seul, dans une mégapole battue par la pluie. On tape ce qu'on veut faire, comme dans les jeux d'aventure textuels des années 80. En anglais on dit « text adventure », jamais « RPG ».
- Sa formule, en français : « jeu de rôle textuel à intrication dynamique générative », les trois mots dans cet ordre. C'est l'innovation à mettre en avant : la ville, ses habitants et la quête de la nuit sont calculés depuis le dossier d'admission du joueur (son nom, sa date de naissance, et s'il le veut son heure et sa ville de naissance) ; chaque lieu est écrit et illustré à son arrivée, rien n'est dessiné à l'avance.
- Le dossier se remplit en une minute ; on peut aussi jouer avec un avatar. Quinze langues.
- La première scène est gratuite. À la fin, un PDF de la nuit est offert : un document à lire et relire.
- L'accroche du site : « Personne ne peut vous voler votre nuit ».
- Ce qu'on voit : tours à gradins, néon rose magenta, pluie, ombres noires qui avalent tout, silhouettes de film noir. Décris ce qu'on voit ; n'écris jamais « Art Déco ».
- En fond, sans jamais le citer : le sommeil comme dernier temps qu'on ne peut pas vous prendre, les vitrines allumées pour personne, les écrans qui ne s'éteignent pas, l'insomnie.
- Le site : https://farnight.online

RÈGLES
- Ton film noir : sobre, évocateur, mélancolique, intrigant ; jamais criard ni agressif, ni compte à rebours ni fausse urgence.
- Ne révèle rien de la structure de l'aventure : ni actes, ni nombre de lieux, ni fin, ni solutions.
- Ne nomme pas le concepteur.
- N'invente ni chiffre, ni prix, ni date, ni fonctionnalité qui ne soient ci-dessus ou dans le brouillon.`

const IG = 'Légende Instagram : 3 à 6 lignes courtes. La première est l’accroche, elle seule s’affiche avant « plus ». Les liens n’y sont pas cliquables : finis par un appel à jouer qui renvoie au lien en bio. Deux emoji au plus. Après une ligne vide, 5 hashtags : #textgame #divination #ecodata puis deux de ton choix.'
const FB = 'Post Facebook : 2 à 5 paragraphes courts, l’accroche en premier. Le lien y est cliquable : finis par https://farnight.online. Deux emoji au plus, deux hashtags au plus.'
const TT = 'Les liens ne sont pas cliquables sur TikTok : renvoie au lien en bio. Puis 3 à 5 hashtags.'
const YT = 'la première ligne doit donner envie, c’est elle qu’on voit sous la vidéo ; mets le lien https://farnight.online et 3 hashtags sur la dernière ligne.'

/** Comment s'écrit le texte de chaque format : `réseau.format`. */
const GUIDES: Record<string, string> = {
  'instagram.post': IG,
  'instagram.carousel': `${IG} C’est un carrousel : donne envie de faire défiler.`,
  'instagram.reel': `${IG} C’est un Reel : la légende accompagne la vidéo sans la raconter.`,
  'facebook.text': `${FB} Le post n’a que du texte.`,
  'facebook.photos': FB,
  'facebook.video': `${FB} C’est la description d’une vidéo.`,
  'facebook.reel': 'Description d’un Reel Facebook : 1 à 3 lignes, l’accroche d’abord, le lien https://farnight.online, deux hashtags au plus.',
  'tiktok.video': `Légende TikTok : une à trois lignes, l’accroche d’abord, moins de 300 signes avant les hashtags. ${TT}`,
  'tiktok.photos': `Description d’un carrousel photo TikTok : quelques lignes qui donnent envie de faire défiler. ${TT}`,
  'youtube.video': `Description YouTube : 2 ou 3 paragraphes courts ; ${YT}`,
  'youtube.short': `Description de Short : 1 à 3 lignes ; ${YT} L’un des hashtags est #Shorts.`,
  'x.post': 'Post X : 280 signes au plus, lien compris (un lien compte pour 23 signes). Une seule idée, l’accroche d’abord, termine par https://farnight.online. Un hashtag au plus.',
  'x.thread': 'Fil X : de 3 à 6 posts, séparés par une ligne qui ne contient que ---. Chaque post fait 280 signes au plus et se lit seul ; pas de numérotation. Le premier accroche, le dernier donne https://farnight.online.',
  'x.poll': 'Question d’un sondage X : 280 signes au plus, une question qui donne envie de voter. Les réponses s’écrivent à part : ne les écris pas.',
}

const TITLES: Record<string, string> = {
  youtube: 'Titre YouTube : intrigant, autour de 60 signes, sans hashtag ni capitales criardes.',
  tiktok: 'Titre du carrousel TikTok : court et intrigant.',
}

/**
 * La limite que Claude doit tenir : X ne compte que 280 signes sans Premium,
 * même si l'API en accepte plus ; un fil n'a que la limite de chaque post.
 */
function limit(networkId: string, format: TextFormat) {
  if (networkId === 'x') return format.id === 'thread' ? '' : '\nLimite stricte : 280 signes.'
  return format.text ? `\nLimite stricte : ${format.text.max} signes.` : ''
}

export function developPrompt(p: {
  networkId: string
  network: string
  format: TextFormat
  text: string
  title: string
  /** Les médias du brouillon, dans l'ordre : 'image' ou 'video'. */
  media: string[]
  /** Combien d'images sont jointes au message. */
  images: number
}) {
  const key = `${p.networkId}.${p.format.id}`
  const wantTitle = !!p.format.title && !p.title
  const images = p.media.filter(m => m === 'image').length
  const videos = p.media.length - images
  const media = p.media.length
    ? `Médias du post : ${[images && `${images} image${images > 1 ? 's' : ''}`, videos && `${videos} vidéo${videos > 1 ? 's' : ''}`].filter(Boolean).join(', ')}.${p.images ? ' Les visuels sont joints à ce message, une vidéo par sa première image : écris d’après ce qu’on y voit.' : ''}`
    : 'Le post n’a pas de média.'

  return `${BRIEF}

LE POST : ${p.network}, format « ${p.format.label} ».
${media}
${GUIDES[key] ?? `${p.format.text?.label ?? 'Texte'} pour ${p.network}.`}${limit(p.networkId, p.format)}${wantTitle ? `\n${TITLES[p.networkId] ?? 'Titre court.'} ${p.format.title!.max} signes au plus.` : ''}${p.title ? `\nTitre déjà choisi : ${p.title}` : ''}

LE BROUILLON DE L'AUTEUR, entre les balises : c'est à la fois la matière et la consigne. Garde ses idées, ses mots forts et son intention, et développe-le en post fini. S'il donne une consigne (ton, angle, longueur, langue), suis-la.
<brouillon>
${p.text}
</brouillon>

Écris dans la langue du brouillon, sauf s'il en demande une autre.
Réponds uniquement en JSON : {"text": "…"${wantTitle ? ', "title": "…"' : ''}}`
}

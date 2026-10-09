/**
 * Thème natal à partir de la date de naissance.
 *
 * Positions géocentriques tropicales du Soleil, de la Lune et des huit
 * planètes, par les éléments orbitaux de Paul Schlyter (« How to compute
 * planetary positions ») : une à deux minutes d'arc pour les planètes, bien
 * moins que la largeur d'un signe. Sans heure ni lieu de naissance, le thème
 * est dressé à midi UT : pas d'ascendant ni de maisons, et la Lune — qui
 * parcourt un signe en deux jours et demi — est donnée à cheval quand elle
 * frôle une frontière.
 *
 * Comme utils/zodiac.ts, ce fichier ne contient AUCUN texte de jeu : il rend
 * des positions. Ce qu'elles font dans la nuit vit dans game/script.json.
 */
import { parseBirthday } from '~/utils/zodiac'

const SIGNS = [
  'Bélier', 'Taureau', 'Gémeaux', 'Cancer', 'Lion', 'Vierge',
  'Balance', 'Scorpion', 'Sagittaire', 'Capricorne', 'Verseau', 'Poissons',
]
const ELEMENTS = ['Feu', 'Terre', 'Air', 'Eau']
const MODES = ['cardinal', 'fixe', 'mutable']

const RAD = Math.PI / 180
const rev = (x: number) => ((x % 360) + 360) % 360
const sin = (x: number) => Math.sin(x * RAD)
const cos = (x: number) => Math.cos(x * RAD)
const atan2 = (y: number, x: number) => Math.atan2(y, x) / RAD

type Elements = { N: number; i: number; w: number; a: number; e: number; M: number }

/** Éléments orbitaux au jour d (jours depuis le 0 janvier 2000, 0 h UT). */
function elementsOf(body: string, d: number): Elements {
  switch (body) {
    case 'sun': return { N: 0, i: 0, w: 282.9404 + 4.70935e-5 * d, a: 1, e: 0.016709 - 1.151e-9 * d, M: 356.0470 + 0.9856002585 * d }
    case 'moon': return { N: 125.1228 - 0.0529538083 * d, i: 5.1454, w: 318.0634 + 0.1643573223 * d, a: 60.2666, e: 0.0549, M: 115.3654 + 13.0649929509 * d }
    case 'mercury': return { N: 48.3313 + 3.24587e-5 * d, i: 7.0047 + 5e-8 * d, w: 29.1241 + 1.01444e-5 * d, a: 0.387098, e: 0.205635 + 5.59e-10 * d, M: 168.6562 + 4.0923344368 * d }
    case 'venus': return { N: 76.6799 + 2.4659e-5 * d, i: 3.3946 + 2.75e-8 * d, w: 54.891 + 1.38374e-5 * d, a: 0.72333, e: 0.006773 - 1.302e-9 * d, M: 48.0052 + 1.6021302244 * d }
    case 'mars': return { N: 49.5574 + 2.11081e-5 * d, i: 1.8497 - 1.78e-8 * d, w: 286.5016 + 2.92961e-5 * d, a: 1.523688, e: 0.093405 + 2.516e-9 * d, M: 18.6021 + 0.5240207766 * d }
    case 'jupiter': return { N: 100.4542 + 2.76854e-5 * d, i: 1.303 - 1.557e-7 * d, w: 273.8777 + 1.64505e-5 * d, a: 5.20256, e: 0.048498 + 4.469e-9 * d, M: 19.895 + 0.0830853001 * d }
    case 'saturn': return { N: 113.6634 + 2.3898e-5 * d, i: 2.4886 - 1.081e-7 * d, w: 339.3939 + 2.97661e-5 * d, a: 9.55475, e: 0.055546 - 9.499e-9 * d, M: 316.967 + 0.0334442282 * d }
    case 'uranus': return { N: 74.0005 + 1.3978e-5 * d, i: 0.7733 + 1.9e-8 * d, w: 96.6612 + 3.0565e-5 * d, a: 19.18171 - 1.55e-8 * d, e: 0.047318 + 7.45e-9 * d, M: 142.5905 + 0.011725806 * d }
    default: return { N: 131.7806 + 3.0173e-5 * d, i: 1.77 - 2.55e-7 * d, w: 272.8461 - 6.027e-6 * d, a: 30.05826 + 3.313e-8 * d, e: 0.008606 + 2.15e-9 * d, M: 260.2471 + 0.005995147 * d }
  }
}

/** Longitude, latitude écliptiques et distance, sur l'orbite propre du corps. */
function orbit({ N, i, w, a, e, M }: Elements) {
  M = rev(M)
  let E = M + (e / RAD) * sin(M) * (1 + e * cos(M))
  for (let k = 0; k < 10; k++) {
    const dE = (E - (e / RAD) * sin(E) - M) / (1 - e * cos(E))
    E -= dE
    if (Math.abs(dE) < 1e-6) break
  }
  const xv = a * (cos(E) - e)
  const yv = a * Math.sqrt(1 - e * e) * sin(E)
  const v = atan2(yv, xv)
  const r = Math.hypot(xv, yv)
  const x = r * (cos(N) * cos(v + w) - sin(N) * sin(v + w) * cos(i))
  const y = r * (sin(N) * cos(v + w) + cos(N) * sin(v + w) * cos(i))
  const z = r * sin(v + w) * sin(i)
  return { lon: rev(atan2(y, x)), lat: atan2(z, Math.hypot(x, y)), r }
}

/** Les longitudes géocentriques de tous les corps, en degrés. */
function longitudes(d: number): Record<string, number> {
  const sunEl = elementsOf('sun', d)
  const sun = orbit(sunEl)
  const xs = sun.r * cos(sun.lon)
  const ys = sun.r * sin(sun.lon)
  const Ms = rev(sunEl.M)

  // La Lune : ses douze plus fortes perturbations, le reste tient sous le degré.
  const moonEl = elementsOf('moon', d)
  const Mm = rev(moonEl.M)
  const Lm = rev(moonEl.N + moonEl.w + Mm)
  const Ls = rev(sunEl.w + Ms)
  const D = Lm - Ls
  const F = Lm - moonEl.N
  const moon = rev(orbit(moonEl).lon
    - 1.274 * sin(Mm - 2 * D) + 0.658 * sin(2 * D) - 0.186 * sin(Ms)
    - 0.059 * sin(2 * Mm - 2 * D) - 0.057 * sin(Mm - 2 * D + Ms) + 0.053 * sin(Mm + 2 * D)
    + 0.046 * sin(2 * D - Ms) + 0.041 * sin(Mm - Ms) - 0.035 * sin(D)
    - 0.031 * sin(Mm + Ms) - 0.015 * sin(2 * F - 2 * D) + 0.011 * sin(Mm - 4 * D))

  const Mj = rev(elementsOf('jupiter', d).M)
  const Mt = rev(elementsOf('saturn', d).M)
  const Mu = rev(elementsOf('uranus', d).M)
  const perturbation: Record<string, number> = {
    jupiter: -0.332 * sin(2 * Mj - 5 * Mt - 67.6) - 0.056 * sin(2 * Mj - 2 * Mt + 21)
      + 0.042 * sin(3 * Mj - 5 * Mt + 21) - 0.036 * sin(Mj - 2 * Mt) + 0.022 * cos(Mj - Mt)
      + 0.023 * sin(2 * Mj - 3 * Mt + 52) - 0.016 * sin(Mj - 5 * Mt - 69),
    saturn: 0.812 * sin(2 * Mj - 5 * Mt - 67.6) - 0.229 * cos(2 * Mj - 4 * Mt - 2)
      + 0.119 * sin(Mj - 2 * Mt - 3) + 0.046 * sin(2 * Mj - 6 * Mt - 69) + 0.014 * sin(Mj - 3 * Mt + 32),
    uranus: 0.04 * sin(Mt - 2 * Mu + 6) + 0.035 * sin(Mt - 3 * Mu + 33) - 0.015 * sin(Mj - Mu + 20),
  }

  const geocentric = (lon: number, lat: number, r: number) => {
    const x = r * cos(lon) * cos(lat) + xs
    const y = r * sin(lon) * cos(lat) + ys
    return rev(atan2(y, x))
  }

  const out: Record<string, number> = { sun: sun.lon, moon }
  for (const body of ['mercury', 'venus', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']) {
    const h = orbit(elementsOf(body, d))
    out[body] = geocentric(h.lon + (perturbation[body] ?? 0), h.lat, h.r)
  }

  // Pluton n'a pas d'éléments stables : la série de Schlyter, valable 1885-2099.
  const S = 50.03 + 0.033459652 * d
  const P = 238.95 + 0.003968789 * d
  const plon = 238.9508 + 0.00400703 * d
    - 19.799 * sin(P) + 19.848 * cos(P) + 0.897 * sin(2 * P) - 4.956 * cos(2 * P)
    + 0.61 * sin(3 * P) + 1.211 * cos(3 * P) - 0.341 * sin(4 * P) - 0.19 * cos(4 * P)
    + 0.128 * sin(5 * P) - 0.034 * cos(5 * P) - 0.066 * sin(6 * P) + 0.139 * cos(6 * P)
    + 0.506 * sin(S - P) - 0.074 * cos(S - P) + 0.015 * sin(2 * S - P) - 0.024 * cos(2 * S - P)
    - 0.026 * sin(S - 2 * P) + 0.023 * cos(S - 2 * P)
  const plat = -3.9082 - 5.453 * sin(P) - 14.975 * cos(P) + 3.527 * sin(2 * P) + 1.673 * cos(2 * P)
    - 1.051 * sin(3 * P) + 0.328 * cos(3 * P) + 0.179 * sin(4 * P) - 0.292 * cos(4 * P)
  const pr = 40.72 + 6.68 * sin(P) + 6.9 * cos(P) - 1.18 * sin(2 * P) - 0.03 * cos(2 * P)
    + 0.15 * sin(3 * P) - 0.14 * cos(3 * P)
  out.pluto = geocentric(plon, plat, pr)

  return out
}

const NAMES: Record<string, string> = {
  sun: 'Soleil', moon: 'Lune', mercury: 'Mercure', venus: 'Vénus', mars: 'Mars',
  jupiter: 'Jupiter', saturn: 'Saturne', uranus: 'Uranus', neptune: 'Neptune', pluto: 'Pluton',
}

const ASPECTS = [
  { angle: 0, name: 'conjonction', orb: 7 },
  { angle: 60, name: 'sextile', orb: 4 },
  { angle: 90, name: 'carré', orb: 6 },
  { angle: 120, name: 'trigone', orb: 6 },
  { angle: 180, name: 'opposition', orb: 7 },
]

/** Les planètes personnelles et sociales : celles qui distinguent un joueur
 * d'un autre né la même année. Les trois lentes sont celles d'une génération. */
const PERSONAL = ['sun', 'mercury', 'venus', 'mars', 'jupiter', 'saturn']

/** Demi-course de la Lune en douze heures, plus la marge de calcul. */
const MOON_DOUBT = 7

const signOf = (lon: number) => SIGNS[Math.floor(lon / 30)]

/** Le thème occidental : dix corps, les aspects serrés, les dominantes. */
function westernLines(lon: Record<string, number>): string[] {
  const lines = Object.keys(NAMES).map((body) => {
    const deg = Math.floor(lon[body] % 30)
    if (body === 'moon' && (deg < MOON_DOUBT || deg >= 30 - MOON_DOUBT)) {
      const other = signOf(rev(lon[body] + (deg < MOON_DOUBT ? -30 : 30)))
      return `  - Lune : ${signOf(lon[body])} ou ${other} (à cheval, l'heure de naissance tranche)`
    }
    return `  - ${NAMES[body]} : ${signOf(lon[body])} ${deg}°`
  })

  const aspects: Array<{ text: string; gap: number }> = []
  for (let a = 0; a < PERSONAL.length; a++) {
    for (let b = a + 1; b < PERSONAL.length; b++) {
      const sep = Math.abs(rev(lon[PERSONAL[a]] - lon[PERSONAL[b]] + 180) - 180)
      for (const asp of ASPECTS) {
        const gap = Math.abs(sep - asp.angle)
        if (gap <= asp.orb) {
          aspects.push({ text: `${NAMES[PERSONAL[a]]} ${asp.name} ${NAMES[PERSONAL[b]]}`, gap })
        }
      }
    }
  }
  aspects.sort((x, y) => x.gap - y.gap)

  const count = (labels: string[], of: (i: number) => number) => {
    const tally = labels.map(() => 0)
    for (const body of PERSONAL) tally[of(Math.floor(lon[body] / 30))]++
    const max = Math.max(...tally)
    return labels.filter((_, i) => tally[i] === max).join(', ').replace(/, ([^,]+)$/, ' et $1')
  }

  return [
    ...lines,
    aspects.length ? `  - Aspects majeurs : ${aspects.slice(0, 5).map(a => a.text).join(', ')}` : '',
    `  - Élément dominant : ${count(ELEMENTS, i => i % 4)} ; mode dominant : ${count(MODES, i => i % 3)}`,
  ]
}

const STEMS = ['Jia', 'Yi', 'Bing', 'Ding', 'Wu', 'Ji', 'Geng', 'Xin', 'Ren', 'Gui']
const WU_XING = ['Bois', 'Feu', 'Terre', 'Métal', 'Eau']
/** L'élément propre de chaque branche, du Rat au Cochon. */
const BRANCH_ELEMENT = [4, 2, 0, 0, 2, 1, 1, 2, 3, 3, 2, 4]
const ANIMALS: Record<'zh' | 'vi' | 'ja', string[]> = {
  zh: ['Rat', 'Bœuf', 'Tigre', 'Lièvre', 'Dragon', 'Serpent', 'Cheval', 'Chèvre', 'Singe', 'Coq', 'Chien', 'Cochon'],
  // Le zodiaque vietnamien a le Buffle et le Chat, le japonais le Sanglier.
  vi: ['Rat', 'Buffle', 'Tigre', 'Chat', 'Dragon', 'Serpent', 'Cheval', 'Chèvre', 'Singe', 'Coq', 'Chien', 'Cochon'],
  ja: ['Rat', 'Bœuf', 'Tigre', 'Lièvre', 'Dragon', 'Serpent', 'Cheval', 'Chèvre', 'Singe', 'Coq', 'Chien', 'Sanglier'],
}

/**
 * Les trois piliers du BaZi — année, mois, jour ; le quatrième, l'heure,
 * manque. L'année et le mois changent aux termes solaires (Lichun à 315°),
 * pas au Nouvel An lunaire : c'est la règle des praticiens, pas celle des
 * calendriers populaires.
 */
function chineseLines(lon: Record<string, number>, year: number, jdn: number, lang: 'zh' | 'vi' | 'ja'): string[] {
  const animals = ANIMALS[lang]
  const month = Math.floor(rev(lon.sun - 315) / 30) // 0 = mois du Tigre
  // Avant Lichun, on est encore dans l'année d'avant : janvier et début février.
  const y = month >= 10 && lon.sun < 315 && lon.sun > 270 ? year - 1 : year
  const yStem = ((y - 4) % 10 + 10) % 10
  const yBranch = ((y - 4) % 12 + 12) % 12
  const mBranch = (month + 2) % 12
  const mStem = ((yStem % 5) * 2 + 2 + month) % 10
  const day = (jdn + 49) % 60
  const dStem = day % 10
  const dBranch = day % 12

  const pillar = (stem: number, branch: number) =>
    `${STEMS[stem]} — ${WU_XING[Math.floor(stem / 2)]} ${stem % 2 ? 'yin' : 'yang'}, ${animals[branch]}`

  const tally = WU_XING.map(() => 0)
  for (const stem of [yStem, mStem, dStem]) tally[Math.floor(stem / 2)]++
  for (const branch of [yBranch, mBranch, dBranch]) tally[BRANCH_ELEMENT[branch]]++

  return [
    '  - Tradition : astrologie chinoise des piliers (BaZi), sans pilier de l\'heure',
    `  - Pilier de l'année : ${pillar(yStem, yBranch)}`,
    `  - Pilier du mois : ${pillar(mStem, mBranch)}`,
    `  - Pilier du jour (le maître du jour, son propre élément) : ${pillar(dStem, dBranch)}`,
    `  - Cinq phases sur six caractères : ${WU_XING.map((e, i) => `${e} ${tally[i]}`).join(', ')}`,
  ]
}

const MANAZIL = [
  'al-Sharatain', 'al-Butain', 'al-Thurayya', 'al-Dabaran', "al-Haq'a", "al-Han'a", "al-Dhira'",
  'al-Nathra', 'al-Tarf', 'al-Jabha', 'al-Zubra', 'al-Sarfa', "al-'Awwa", 'al-Simak',
  'al-Ghafr', 'al-Zubana', 'al-Iklil', 'al-Qalb', 'al-Shawla', "al-Na'aim", 'al-Balda',
  'Sa\'d al-Dhabih', "Sa'd Bula'", "Sa'd al-Su'ud", "Sa'd al-Akhbiya", 'al-Fargh al-Muqaddam',
  "al-Fargh al-Mu'akhkhar", 'Batn al-Hut',
]

/**
 * La tradition arabe : le thème hérité de Ptolémée, plus la demeure lunaire
 * (manzil), l'une des vingt-huit stations de la Lune. Le poids abjad du nom,
 * lui, est déjà dans la numérologie.
 */
function arabicLines(lon: Record<string, number>): string[] {
  const width = 360 / 28
  const at = Math.floor(lon.moon / width)
  const into = lon.moon - at * width
  // La Lune parcourt une demeure en un jour : à midi, la veille ou le
  // lendemain restent possibles près des bords.
  const manzil = into < MOON_DOUBT || into > width - MOON_DOUBT
    ? `${MANAZIL[at]} ou ${MANAZIL[(at + (into < MOON_DOUBT ? 27 : 1)) % 28]} (l'heure de naissance tranche)`
    : MANAZIL[at]
  return [
    '  - Tradition : astrologie arabe (thème des sept astres et demeures de la Lune)',
    ...westernLines(lon),
    `  - Demeure lunaire : ${manzil}`,
  ]
}

const HARI = ['Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu', 'Minggu']
const HARI_NEPTU = [4, 3, 7, 8, 6, 9, 5]
const PASARAN = ['Legi', 'Pahing', 'Pon', 'Wage', 'Kliwon']
const PASARAN_NEPTU = [5, 9, 7, 4, 8]

/** Le weton javanais : le jour de la semaine croisé avec le marché de cinq jours. */
function wetonLines(jdn: number): string[] {
  const hari = jdn % 7 // 0 = lundi
  const pasaran = jdn % 5 // le 17 août 1945, Jumat Legi
  return [
    '  - Tradition : primbon javanais (weton)',
    `  - Weton : ${HARI[hari]} ${PASARAN[pasaran]}, neptu ${HARI_NEPTU[hari] + PASARAN_NEPTU[pasaran]}`,
  ]
}

/** Numéro du jour julien d'une date civile grégorienne. */
function julianDay(y: number, m: number, d: number): number {
  const a = Math.floor((14 - m) / 12)
  const yy = y + 4800 - a
  const mm = m + 12 * a - 3
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4)
    - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045
}

/**
 * Le thème rendu en lignes de prompt, dans la tradition de la langue jouée,
 * ou '' si la date manque ou si l'année sort de la plage où les séries tiennent.
 */
export function natalChartLines(birthday?: string, lang = 'fr'): string {
  const md = parseBirthday(birthday)
  const year = Number(birthday?.trim().slice(0, 4))
  if (!md || !Number.isInteger(year) || year < 1900 || year > 2099) return ''

  const { month: m, day } = md
  const d = 367 * year - Math.floor((7 * (year + Math.floor((m + 9) / 12))) / 4)
    + Math.floor((275 * m) / 9) + day - 730530 + 0.5
  const lon = longitudes(d)
  const jdn = julianDay(year, m, day)

  const western = ['  - Tradition : astrologie occidentale (thème natal tropical)', ...westernLines(lon)]
  // Le BaZi sans l'heure et le weton laissent des trous — pas de liens entre
  // composantes, trop peu de composantes pour un casting : le thème
  // occidental les comble. L'arabe le contient déjà.
  const lines = lang === 'zh' || lang === 'vi' || lang === 'ja'
    ? [...chineseLines(lon, year, jdn, lang), ...western]
    : lang === 'ar' ? arabicLines(lon)
      : lang === 'id' ? [...wetonLines(jdn), ...western]
        : western
  return lines.filter(Boolean).join('\n')
}

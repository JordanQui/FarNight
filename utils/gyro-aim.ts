/**
 * La visée au gyroscope, réduite à des fonctions pures.
 *
 * Isolée du composable pour être vérifiable : cette géométrie est la source des
 * sauts qu'on a longtemps mis sur le compte du lissage ou du capteur, et elle
 * se prouve à froid, sans appareil.
 */

export type Up = [number, number, number]

/**
 * La verticale, exprimée dans le repère de l'appareil.
 *
 * On ne compare pas des angles d'Euler bruts : ils sont DISCONTINUS. Quand le
 * tangage traverse 90° — le téléphone tenu droit devant soi — la spécification
 * bascule gamma de +g à -g et bêta de 180-b pour décrire la MÊME orientation.
 * La différence d'angles faisait alors sauter l'oeil de près d'un quart
 * d'écran d'un coup.
 *
 * Ce vecteur est la troisième ligne de Rx(bêta)·Ry(gamma). Il ne dépend pas
 * d'alpha — donc ni de la boussole ni de sa dérive, seconde source de sauts —
 * et il est continu partout, y compris à la singularité. C'est ce qui permet
 * aux deux postures de se décrire dans le même repère alors que l'une lit
 * l'écran par-dessus et l'autre par-dessous.
 */
export function upVector(beta: number, gamma: number): Up {
  const b = (beta * Math.PI) / 180
  const g = (gamma * Math.PI) / 180
  return [-Math.cos(b) * Math.sin(g), Math.sin(b), Math.cos(b) * Math.cos(g)]
}

function clamp(v: number, min = 0): number {
  return Math.min(1, Math.max(min, v))
}

/**
 * Où viser, en fraction d'écran.
 *
 * LE ZÉRO EST ABSOLU : il ne se mesure pas au moment où le joueur appuie, il
 * est déclaré. `restBeta` est le tangage de la posture au repos — 0° pour un
 * appareil posé à plat, 90° pour un appareil tenu debout au-dessus de soi —, et
 * c'est lui, et lui seul, qui décide de l'origine. Le calibrage par
 * échantillonnage qu'il remplace prenait pour zéro l'attitude de la main à
 * l'instant du tap : deux activations de suite ne donnaient pas la même visée,
 * et rien ne permettait au joueur de savoir laquelle il avait.
 *
 * La bille roule vers le bas de la pente : c'est le modèle, et il vaut dans les
 * deux postures sans changer un signe. Relever le bord opposé fait descendre
 * l'oeil dans le texte — le geste naturel pour parcourir une page —, rouler
 * vers la droite l'envoie à droite.
 *
 * LE TANGAGE SE LIT COMME UN ANGLE, pas comme une hauteur de gravité. La version
 * précédente comparait directement `up[1]`, c'est-à-dire sin(bêta) : elle allait
 * bien tant que l'origine était l'appareil à plat, où le sinus est raide et
 * monotone. Une origine à 90° la cassait net — le sinus y est à son MAXIMUM,
 * donc de pente nulle et symétrique : pencher l'appareil dans un sens ou dans
 * l'autre faisait monter l'oeil pareil, et il n'y avait plus aucun moyen de le
 * faire descendre. `atan2(up[1], up[2])` rend l'angle lui-même : monotone
 * partout, de pente constante, et identique à l'ancienne formule à 2,5 % près
 * autour de zéro — la posture assise ne bouge pas.
 *
 * LA MONTÉE ET LA DESCENTE PEUVENT AVOIR DES GAINS DIFFÉRENTS (`riseScale`).
 * Rien ne dit qu'un poignet parcoure autant de degrés dans les deux sens : le
 * bras replié au-dessus du visage ramène le haut de l'appareil vers soi bien
 * plus facilement qu'il ne le pousse. À gain égal, l'oeil remontait donc trop
 * vite. Le facteur ne s'applique qu'au sens de la montée, et il ne déplace pas
 * l'origine — le repos reste exactement là où la posture le déclare.
 *
 * `neutralY` EST LA HAUTEUR DE REPOS, et elle dépend de la posture : ce n'est
 * pas la même chose de poser l'appareil à plat sur une table et de le tenir
 * au-dessus de soi. Posé, l'oeil se range EN HAUT et tout le débattement sert à
 * le faire descendre. Tenu à bout de bras, il se range AU MILIEU : le poignet
 * peut aller dans les deux sens, et il n'a pas de quoi traverser un écran
 * entier dans un seul.
 *
 * LES DEUX AXES SE LISENT SUR LE MÊME VECTEUR, et c'est ce qui les rend valides
 * dans les deux postures. Le geste de viser à gauche n'est pourtant pas le même
 * geste selon qu'on est posé ou debout : à plat, on soulève le bord gauche de
 * l'appareil — c'est gamma ; debout, on fait basculer le haut de l'écran vers
 * l'épaule — c'est une rotation autour de la normale à l'écran, que la
 * décomposition d'Euler range ailleurs et qui fait sauter gamma à ±90°. Les deux
 * déplacent la verticale de la même façon dans le repère de l'appareil, donc
 * `up[0]` les mesure toutes les deux, sans rien savoir de la posture. Raisonner
 * sur les angles bruts, lui, aurait vu un mouvement dans un cas et un saut dans
 * l'autre.
 */
export function aimFrom(
  up: Up,
  restBeta: number,
  rangeDeg: number,
  neutralY: number,
  riseScale = 1,
  restUp = upVector(restBeta, 0),
  topY = 0,
  flatY?: number,
): { x: number; y: number } {
  // Le tangage, en radians, mesuré depuis l'origine déclarée de la posture.
  const delta = Math.atan2(up[1], up[2]) - Math.atan2(restUp[1], restUp[2])
  // Crossing ±180° must not fling the reclining cursor across the screen.
  const pitch = Math.atan2(Math.sin(delta), Math.cos(delta))
  const raw = pitch / ((rangeDeg * Math.PI) / 180)

  // La montée et la descente n'ont pas le même gain quand la posture le demande.
  // Un `dy` négatif fait REMONTER l'oeil : c'est celui-là, et lui seul, que
  // `riseScale` tempère.
  let dy = raw < 0 ? raw * riseScale : raw

  // `flatY` : la hauteur de l'oeil appareil POSÉ À PLAT, quand le repos est
  // ailleurs (allongé, debout). Le côté du plat descend alors en douceur jusqu'à
  // `flatY`, sur toute la course depuis le repos ; l'autre côté fait remonter.
  if (flatY !== undefined && restBeta) {
    const rest = (restBeta * Math.PI) / 180
    dy = pitch <= 0
      ? 2 * (flatY - neutralY) * Math.min(1, -pitch / rest)
      : -raw * riseScale
  }

  // Le roulis : la projection de la verticale sur la largeur de l'écran.
  const dx = -(up[0] - restUp[0]) / Math.sin((rangeDeg * Math.PI) / 180)

  // `topY` peut être négatif : l'oeil bute alors juste au-dessus de l'écran.
  return { x: clamp(0.5 + dx / 2), y: clamp(neutralY + dy / 2, topY) }
}

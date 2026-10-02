<script setup lang="ts">
import { LANG_CODES } from '~/types/i18n'
import { dirOf, pack, translate } from '~/utils/languages'

/**
 * Ce que le jeu dit de lui aux moteurs et aux réseaux.
 *
 * Le fixe est dans `nuxt.config.ts`. Ne restent ici que les choses qui ont
 * besoin du DOMAINE SERVI : l'adresse canonique, l'image de partage et les
 * données structurées. `useRequestURL()` le donne au rendu serveur comme au
 * client, ce qui évite d'inscrire une URL en dur — le jeu tourne sur une
 * préproduction Vercel comme sur son domaine définitif, et les deux doivent
 * s'annoncer correctement.
 */
// `xForwardedHost` : derrière le proxy de Vercel, c'est le seul en-tête qui
// porte le domaine public. Sans lui, une préproduction s'annoncerait sous son
// nom interne.
const { origin } = useRequestURL({ xForwardedHost: true })
const { lang } = useLang()
const price = useRuntimeConfig().public.paywallPrice as { amount: number; currency: string }

const NAME = 'La Nuit du Bout du Monde'
const CREATOR = 'Jordan Quiqueret'

/**
 * Les données structurées : le jeu, et qui l'a fait.
 *
 * `creator` ET `author` pointent la même personne — les moteurs ne lisent pas
 * les deux, et c'est le seul endroit du site où la paternité est déclarée de
 * façon lisible par une machine.
 *
 * L'offre reprend le prix du script : la première scène est gratuite, la suite
 * de la nuit s'ouvre une fois.
 */
const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'VideoGame',
      '@id': `${origin}/#jeu`,
      name: NAME,
      url: `${origin}/`,
      // Les douze langues jouables, pas seulement celle de cette visite : la
      // page est la même pour tout le monde, c'est le jeu qui change de langue.
      inLanguage: LANG_CODES,
      description:
        "Un jeu de rôle textuel, jouable en douze langues. Le joueur déclare qui il est dans un "
        + "formulaire d'admission, et la ville qu'il traverse — ses lieux, ses habitants, "
        + "sa quête — est bâtie sur ses réponses. Huit scènes illustrées, du comptoir à l'aube, "
        + "dans une mégapole verticale battue par la pluie. On y joue en tapant ce qu'on "
        + 'veut faire, et la nuit ne se rejoue pas.',
      genre: ['Jeu de rôle', 'Fiction interactive', 'Aventure textuelle'],
      gamePlatform: 'Navigateur web',
      applicationCategory: 'GameApplication',
      operatingSystem: 'Tout navigateur moderne',
      playMode: 'SinglePlayer',
      image: `${origin}/og.png`,
      creator: { '@id': `${origin}/#concepteur` },
      author: { '@id': `${origin}/#concepteur` },
      publisher: { '@id': `${origin}/#concepteur` },
      offers: {
        '@type': 'Offer',
        price: price.amount.toFixed(2),
        priceCurrency: price.currency,
        description: "La première scène est gratuite ; la suite de la nuit s'ouvre une fois.",
        availability: 'https://schema.org/InStock',
        url: `${origin}/`,
      },
    },
    {
      '@type': 'Person',
      '@id': `${origin}/#concepteur`,
      name: CREATOR,
      jobTitle: 'Concepteur',
    },
  ],
}

useHead({
  /**
   * Le titre de l'onglet suit la langue jouée.
   *
   * `nuxt.config.ts` en pose un par défaut, en français : c'est celui que voit
   * un robot d'indexation, qui n'a pas de cookie et arrive donc sur la version
   * canonique. Un VISITEUR, lui, en a un — ou un en-tête `Accept-Language` —
   * et mérite de retrouver son onglet dans sa langue.
   */
  title: computed(() => translate(lang.value, 'seo.title')),
  // La balise `lang` suit le joueur : elle décide de la coupure des mots, de
  // la voix de synthèse et de ce qu'un lecteur d'écran prononce. La laisser à
  // « fr » aurait fait lire un texte anglais avec un accent français.
  // `dir` aussi : l'arabe se lit de droite à gauche, et tout le document suit.
  htmlAttrs: {
    lang: computed(() => pack(lang.value).tag),
    dir: computed(() => dirOf(lang.value)),
  },
  link: [{ rel: 'canonical', href: `${origin}/` }],
  meta: [
    { property: 'og:url', content: `${origin}/` },
    { property: 'og:image', content: `${origin}/og.png` },
    { name: 'twitter:image', content: `${origin}/og.png` },
  ],
  script: [{ type: 'application/ld+json', innerHTML: JSON.stringify(jsonLd) }],
})
</script>

<template>
  <NuxtPage />
</template>

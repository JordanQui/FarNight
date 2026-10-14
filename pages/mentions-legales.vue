<script setup lang="ts">
/**
 * Mentions légales, licence, vente et données.
 *
 * En français seulement : l'éditeur est en France, c'est la version qui fait
 * foi. Le prix et la durée d'accès viennent de la config, comme au paywall —
 * les recopier ici garantirait qu'ils finissent par diverger.
 */
const config = useRuntimeConfig().public
const price = config.paywallPrice as { amount: number; currency: string; keepsake: number }
const days = config.memoryDays as number
const priceLabel = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: price.currency,
  minimumFractionDigits: Number.isInteger(price.amount) ? 0 : 2,
}).format(price.amount)
const keepsakeLabel = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: price.currency,
  minimumFractionDigits: Number.isInteger(price.keepsake) ? 0 : 2,
}).format(price.keepsake)

/**
 * Ce que la loi exige et que le dépôt ne connaît pas. Les crochets restent
 * visibles tant qu'ils ne sont pas remplis : mieux vaut un trou qui se voit
 * qu'une mention inventée.
 */
const EDITOR = {
  name: 'Jordan Quiqueret',
  status: '[statut et SIRET]',
  address: '[adresse postale]',
  phone: '[téléphone]',
  email: 'friend@farnight.online',
}
const VAT = '[mention TVA]'
const MEDIATOR = '[médiateur de la consommation : nom, adresse, site]'

const LICENSE_URL = 'https://creativecommons.org/licenses/by-nc-nd/4.0/deed.fr'

useHead({
  title: 'Mentions légales — La Nuit du Bout du Monde',
  // La page est en français quelle que soit la langue jouée.
  htmlAttrs: { lang: 'fr', dir: 'ltr' },
})
</script>

<template>
  <div class="min-h-[100dvh] px-5 py-10 sm:px-8">
    <div class="legal mx-auto w-full max-w-xl space-y-10 text-ink-200/85 text-sm leading-relaxed">
      <header class="space-y-4">
        <p class="font-display text-[10px] uppercase tracking-[0.4em] text-neon-400/80">La Nuit du Bout du Monde — Far Night</p>
        <h1 class="neon-text font-display uppercase text-2xl sm:text-3xl tracking-[0.05em]">Mentions légales</h1>
        <div class="neon-rule w-32" />
      </header>

      <section>
        <h2>Éditeur</h2>
        <p>
          {{ EDITOR.name }} — {{ EDITOR.status }}<br>
          {{ EDITOR.address }}<br>
          {{ EDITOR.phone }} — <a :href="`mailto:${EDITOR.email}`">{{ EDITOR.email }}</a>
        </p>
        <p>Directeur de la publication : l'éditeur.</p>
      </section>

      <section>
        <h2>Hébergement</h2>
        <p>
          Vercel Inc., 440 N Barranca Avenue #4133, Covina, CA 91723, États-Unis —
          <a href="https://vercel.com" rel="noopener">vercel.com</a>
        </p>
      </section>

      <section id="licence">
        <h2>Propriété intellectuelle et licence</h2>
        <p>
          Les textes, le scénario, les images, les illustrations et l'interface de ce jeu sont © 2026 l'éditeur,
          diffusés sous licence
          <a :href="LICENSE_URL" rel="license noopener">Creative Commons Attribution – Pas d'utilisation commerciale
            – Pas de modification 4.0 International (CC BY-NC-ND 4.0)</a>.
        </p>
        <p>Vous pouvez les copier et les partager, sur tout support, tels quels, à trois conditions :</p>
        <ul>
          <li><strong>Attribution</strong> — citer le titre du jeu et l'adresse du site, avec un lien vers la licence ;</li>
          <li><strong>Pas d'utilisation commerciale</strong> — aucune vente, aucune exploitation payante, aucune publicité ;</li>
          <li><strong>Pas de modification</strong> — ni adaptation, ni traduction, ni remontage, ni œuvre dérivée.</li>
        </ul>
        <p>
          Les scènes générées pendant une partie, textes et images, naissent de cette œuvre et suivent la même
          licence : une capture partagée telle quelle, avec le nom du jeu, est la bienvenue.
        </p>
        <p>
          Restent hors licence, tous droits réservés : le code source, ainsi que les titres « La Nuit du Bout du
          Monde » et « Far Night » et le logo, qui ne peuvent désigner aucun autre produit. Tout usage qui sort de ce
          cadre demande une autorisation écrite de l'éditeur ; à défaut, il constitue une contrefaçon (articles
          L335-2 et suivants du Code de la propriété intellectuelle).
        </p>
      </section>

      <section id="fouille">
        <h2>Fouille de textes et de données</h2>
        <p>
          L'éditeur s'oppose à toute fouille de textes et de données sur ce site, notamment pour entraîner des
          systèmes d'intelligence artificielle (article L122-5-3 III du Code de la propriété intellectuelle,
          article 4 de la directive (UE) 2019/790). Cette opposition est aussi exprimée sous forme lisible par
          machine, dans le fichier robots.txt et par le protocole TDMRep.
        </p>
      </section>

      <section id="vente">
        <h2>Conditions de vente</h2>
        <p>
          La première scène est gratuite. La suite de la nuit s'ouvre par un paiement unique de {{ priceLabel }} TTC,
          qui donne accès au jeu pendant {{ days }} jours dans le navigateur utilisé. {{ VAT }}
        </p>
        <p>
          La nuit se joue une fois : après l'épilogue, elle ne se rouvre pas. Si une scène n'avance plus, la ville
          peut se fermer pendant 24 heures.
        </p>
        <p>
          À la fin de la nuit, son récit — les lieux traversés, les réponses trouvées, le texte de fin — peut être
          emporté en PDF, par un paiement unique de {{ keepsakeLabel }} TTC. Il reste téléchargeable pendant
          {{ days }} jours dans le navigateur utilisé.
        </p>
        <p>
          Le paiement est traité par <a href="https://stripe.com/fr/privacy" rel="noopener">Stripe</a> ; les données
          de carte ne passent pas par nos serveurs.
        </p>
        <p>
          Le jeu et son PDF sont des contenus numériques fournis dès le paiement. En payant, vous demandez leur
          exécution immédiate et renoncez expressément à votre droit de rétractation (article L221-28 13° du Code de la consommation).
        </p>
        <p>
          En cas de difficulté, écrivez à <a :href="`mailto:${EDITOR.email}`">{{ EDITOR.email }}</a>. Faute
          d'accord, vous pouvez recourir gratuitement au médiateur de la consommation : {{ MEDIATOR }}.
        </p>
      </section>

      <section id="donnees">
        <h2>Données personnelles</h2>
        <p>
          Le responsable du traitement est l'éditeur. Le formulaire d'admission demande un nom et une date de
          naissance, pour écrire l'aventure que vous demandez (article 6.1.b du RGPD).
        </p>
        <p>
          Vos réponses restent dans votre navigateur, avec votre partie, pendant {{ days }} jours, et ne sont pas
          conservées sur nos serveurs. Le temps d'écrire chaque scène, elles sont transmises à OpenAI
          (États-Unis), qui génère les textes et les images ; OpenAI ne s'en sert pas pour entraîner ses modèles et
          peut les garder jusqu'à 30 jours pour prévenir les abus.
        </p>
        <p>
          L'adresse e-mail saisie avec un code d'invitation sert à vérifier ce code et n'est pas conservée. Vercel
          tient des journaux techniques (adresses IP) et mesure l'audience de façon anonyme, sans cookie. Stripe
          traite les données de paiement selon sa propre politique.
        </p>
        <p>
          Vous pouvez accéder à vos données, les rectifier, les effacer ou vous opposer à leur traitement en
          écrivant à <a :href="`mailto:${EDITOR.email}`">{{ EDITOR.email }}</a>, et saisir la
          <a href="https://www.cnil.fr" rel="noopener">CNIL</a>. Effacer les données du site dans votre navigateur
          efface votre partie.
        </p>
      </section>

      <section id="cookies">
        <h2>Cookies</h2>
        <ul>
          <li><code>tg_lang</code> — la langue choisie ;</li>
          <li><code>tg_quota</code>, <code>tg_access</code>, <code>tg_pos</code>, <code>tg_lock</code> — signés : la scène gratuite, l'accès payé, l'endroit où vous en êtes, la fermeture de la ville ;</li>
          <li><code>__stripe_mid</code>, <code>__stripe_sid</code> — déposés par Stripe contre la fraude au paiement.</li>
        </ul>
        <p>
          Tous servent au fonctionnement du jeu ou à la sécurité du paiement : ils ne demandent pas de consentement.
          Aucun cookie publicitaire, aucun cookie de mesure d'audience.
        </p>
      </section>

      <footer class="space-y-4 border-t border-steel-600/40 pt-6 text-xs">
        <p class="text-steel-400">Mise à jour le 13 octobre 2026.</p>
        <NuxtLink to="/" class="font-display uppercase tracking-[0.28em] text-[10px]">Retour au jeu</NuxtLink>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.legal section { display: flex; flex-direction: column; gap: 0.75rem; }
.legal h2 {
  font-family: Futura, 'Avenir Next', 'Century Gothic', 'Trebuchet MS', system-ui, sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-size: 0.75rem;
  color: rgb(var(--ink-100));
}
.legal ul { display: flex; flex-direction: column; gap: 0.4rem; padding-left: 1rem; list-style: square; }
.legal strong { color: rgb(var(--ink-100)); font-weight: 500; }
.legal code { color: rgb(var(--neon-300)); font-size: 0.8em; }
.legal a { color: rgb(var(--neon-300)); text-decoration: underline; text-underline-offset: 3px; }
.legal a:hover { color: rgb(var(--neon-200)); }
</style>

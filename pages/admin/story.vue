<script setup lang="ts">
/**
 * La trame fixée.
 *
 * Ce que le script impose à toutes les nuits — l'ordre des lieux, ce qu'on
 * obtient dans chacun, comment une scène se résout, les objets et le deck de
 * moments — séparé de ce que le modèle écrit pour chaque joueur. Tout est lu
 * par server/api/admin/story.get.ts : rien n'est recopié ici.
 */

// Voir middleware/admin.ts : la page n'existe qu'en local.
definePageMeta({ middleware: 'admin' })

const { data, error } = await useFetch('/api/admin/story')

type Data = NonNullable<typeof data.value>
type Scene = Data['scenes'][number]
type Play = Data['deck'][number]['play']

const ACQUISITION: Record<string, { label: string; how: string }> = {
  informant_then_holder: {
    label: 'Informateur puis détenteur',
    how: 'Un personnage sait qui a l’objet et le dit à son heure. Le détenteur ne lâche rien tant que le joueur n’a pas été mis sur la piste, puis cède après ses échanges.',
  },
  holder: {
    label: 'Détenteur seul',
    how: 'Un seul personnage a l’objet, sans intermédiaire. Il cède après ses échanges.',
  },
  found: {
    label: 'Trouvé dans le lieu',
    how: 'Personne ne l’a. Il est inscrit ou posé dans le décor ; les gens d’ici peuvent seulement dire où regarder.',
  },
}

const NATURE: Record<string, string> = {
  'augmentation': 'Augmentation',
  'carte d\'accès': 'Carte d’accès',
  'fréquence': 'Fréquence',
  'code': 'Code',
  'séquence d\'opération': 'Séquence d’opération',
  'objet-clé': 'Objet-clé',
}

const FACET: Record<string, string> = { terrain: 'Ce que la nuit oppose', reception: 'Accueil du monde', destiny: 'Forme de l’objectif' }

const scenesById = computed(() => new Map((data.value?.scenes ?? []).map(s => [s.id, s])))
const titleOf = (id: string | null) => {
  if (!id) return '—'
  if (id === 'PAYWALL') return 'le paiement'
  const s = scenesById.value.get(id)
  return s ? `${s.id} — ${s.title}` : id
}

/** L'auberge n'appartient à aucun acte du script : on lui fait son chapitre. */
const chapters = computed(() => {
  const d = data.value
  if (!d) return []
  const opening = d.scenes.filter(s => !d.acts.some(a => a.scenes.includes(s.id)))
  return [
    {
      id: 'ouverture',
      title: 'L’Ouverture',
      arc: opening[0]?.objective?.statement ?? '',
      ends_on: 'Le joueur franchit le sas — et paie pour continuer.',
      scenes: opening,
    },
    ...d.acts.map(a => ({ ...a, scenes: a.scenes.map(id => scenesById.value.get(id)!).filter(Boolean) })),
  ]
})

const facetOf = (scenes: Scene[]) => scenes.find(s => s.theme_focus)?.theme_focus?.facet_label ?? ''

function playLabel(p: Play): string {
  switch (p.kind) {
    case 'command': return 'Canal # — aucun appel'
    case 'exit': return 'Sortie vers la scène suivante'
    case 'pickup': return 'Ramassage — aucun appel'
    case 'local': return `Réponse déjà écrite (${p.say}) — aucun appel`
    case 'model': return `Tour facturé${p.mode ? ` · ${p.mode}` : ''}`
  }
}
const isFree = (p: Play) => p.kind !== 'model'

/** Les schémas arrivent en « string (consigne) » : on garde la consigne. */
const clean = (v: unknown) => String(v ?? '').replace(/^string\s*\(/, '').replace(/\)$/, '')

const nightSchema = computed(() => {
  const n = data.value?.schema.night as Record<string, any> | undefined
  if (!n) return null
  const act = n.acts?.[0] ?? {}
  return {
    top: ['goal', 'tension', 'release'].map(k => ({ key: `night.${k}`, text: clean(n[k]) })),
    act: [{ key: 'acts[].title', text: clean(act.title) }],
    place: Object.entries(act.scenes?.[0] ?? {}).map(([k, v]) => ({ key: `scenes[].${k}`, text: clean(v) })),
  }
})
const fieldsOf = (o: unknown, prefix: string) =>
  Object.entries((o ?? {}) as Record<string, unknown>).map(([k, v]) => ({ key: `${prefix}.${k}`, text: clean(v) }))

const ruleNote = (id: string) => data.value?.rules.find(r => r.id === id)?.note ?? ''

const NAV = [
  ['trame', 'La trame'],
  ['resolution', 'Résoudre une scène'],
  ['actes', 'Scène par scène'],
  ['objets', 'Les objets'],
  ['deck', 'Le deck de moments'],
  ['dossier', 'Ce que le dossier décide'],
  ['genere', 'Ce que le modèle écrit'],
  ['regles', 'Les consignes en entier'],
] as const
</script>

<template>
  <div class="min-h-[100dvh] px-5 py-10 sm:px-8">
    <div class="mx-auto w-full max-w-5xl space-y-12">

      <div v-if="error" class="border border-neon-600/40 p-6 space-y-2">
        <p class="font-display uppercase tracking-[0.2em] text-neon-400 text-xs">Données indisponibles</p>
        <p class="text-ink-200/80 text-sm">
          Impossible de lire <code class="text-neon-300">game/script.json</code> :
          {{ error.statusMessage ?? error.message }}
        </p>
      </div>

      <template v-else-if="data">
        <header class="space-y-4">
          <p class="font-display text-[10px] uppercase tracking-[0.4em] text-neon-400/80">
            Histoire — script {{ data.meta.version }}
          </p>
          <h1 class="neon-text font-display uppercase text-2xl sm:text-3xl tracking-[0.05em]">La trame fixée</h1>
          <div class="neon-rule w-32" />
          <p class="text-ink-200/85 text-sm leading-relaxed max-w-3xl">
            Aucun décor n’est écrit d’avance. Le script fixe la <strong class="text-ink-100">mécanique</strong> :
            l’ordre des {{ data.scenes.length }} scènes, ce qu’on obtient dans chacune, comment on l’obtient et à
            quelle condition on sort. Le reste — le but de la nuit, les six lieux, les personnages, les noms des
            objets — est écrit par le modèle pour chaque joueur, à partir de son dossier d’admission.
          </p>
          <div class="flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.14em]">
            <span class="border border-neon-600/50 px-2 py-0.5 text-neon-300">fixé par le script</span>
            <span class="border border-steel-600/60 px-2 py-0.5 text-steel-400">écrit par le modèle, par joueur</span>
          </div>
          <nav class="flex flex-wrap gap-x-4 gap-y-1.5 pt-2 text-xs">
            <a v-for="[id, label] in NAV" :key="id" :href="`#${id}`" class="text-ink-300 hover:text-neon-300 underline-offset-4 hover:underline">
              {{ label }}
            </a>
          </nav>
        </header>

        <!-- ─────────────── La frise ─────────────── -->
        <section id="trame" class="space-y-4 scroll-mt-6">
          <h2 class="font-display text-[11px] uppercase tracking-[0.28em] text-ink-100">
            La trame <span class="text-steel-400">— de l’auberge à l’épilogue</span>
          </h2>
          <div class="overflow-x-auto pb-2">
            <div class="flex items-stretch gap-3 min-w-max">
              <template v-for="(ch, i) in chapters" :key="ch.id">
                <div class="border border-steel-600/60 p-3 space-y-2">
                  <p class="font-display text-[10px] uppercase tracking-[0.2em] text-neon-400/80">{{ ch.title }}</p>
                  <p v-if="facetOf(ch.scenes)" class="text-steel-400 text-[10px]">{{ facetOf(ch.scenes) }}</p>
                  <div class="flex gap-2">
                    <a
                      v-for="s in ch.scenes" :key="s.id" :href="`#scene-${s.id}`"
                      class="block w-32 border border-steel-700/70 hover:border-neon-600/60 p-2 space-y-1"
                    >
                      <p class="font-display text-neon-300/90 text-xs">{{ s.order }}. {{ s.id }}</p>
                      <p class="text-ink-100 text-[11px] leading-snug">
                        {{ s.ending ? 'Épilogue' : NATURE[s.key_item?.nature ?? ''] }}
                      </p>
                      <p class="text-steel-400 text-[10px] leading-snug">
                        {{ s.ending ? 'aube + texte de fin' : ACQUISITION[s.key_item?.acquisition ?? '']?.label }}
                      </p>
                    </a>
                  </div>
                </div>
                <div v-if="i === 0" class="flex flex-col items-center justify-center px-1 text-center">
                  <span class="font-display text-[9px] uppercase tracking-[0.18em] text-red-400">Paiement</span>
                  <span class="text-red-400/80 text-[10px]">{{ data.paywall.amount }} {{ data.paywall.currency }}</span>
                  <span class="text-red-400 text-lg leading-none">›</span>
                </div>
              </template>
            </div>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <div v-for="ch in chapters" :key="ch.id" class="border border-steel-700/60 p-4 space-y-1.5">
              <p class="font-display text-[10px] uppercase tracking-[0.2em] text-ink-100">{{ ch.title }}</p>
              <p class="text-ink-200/80 text-xs leading-relaxed">{{ ch.arc }}</p>
              <p v-if="ch.ends_on" class="text-neon-300/80 text-xs">Se termine quand : {{ ch.ends_on }}</p>
            </div>
          </div>
        </section>

        <!-- ─────────────── Résolution ─────────────── -->
        <section id="resolution" class="space-y-5 scroll-mt-6">
          <h2 class="font-display text-[11px] uppercase tracking-[0.28em] text-ink-100">
            Comment une scène se résout <span class="text-steel-400">— la même boucle partout</span>
          </h2>
          <ol class="grid gap-3 sm:grid-cols-5 text-xs">
            <li v-for="(step, i) in [
              { t: 'Arriver', d: 'La scène est générée sur son lieu du plan : texte, personnages, objets, image. L’auberge garde son image figée.' },
              { t: 'Parler, regarder', d: 'On parle à quelqu’un en tapant son nom. La Majuscule signale ce qui se manipule ; sans nom lisible, pas d’interaction.' },
              { t: 'Obtenir l’objet-clé', d: 'Selon la scène : un détenteur le cède, un informateur mène au détenteur, ou il est trouvé dans le lieu.' },
              { t: 'Le déchiffrer', d: 'Son nom est brouillé : l’augmentation le rend lisible. À l’auberge, il faut s’en être servi une fois pour sortir.' },
              { t: 'Sortir', d: 'Les mots de sortie ouvrent la porte si l’objet-clé est en main. La sortie mène à la scène suivante — ou au paiement.' },
            ]" :key="step.t" class="border border-steel-600/60 p-3 space-y-1">
              <p class="font-display text-neon-300 text-[11px]">{{ i + 1 }}. {{ step.t }}</p>
              <p class="text-ink-200/80 leading-relaxed">{{ step.d }}</p>
            </li>
          </ol>

          <div class="grid gap-3 sm:grid-cols-3">
            <div v-for="(a, key) in ACQUISITION" :key="key" class="border border-steel-700/60 p-4 space-y-1.5">
              <p class="font-display text-[10px] uppercase tracking-[0.18em] text-ink-100">{{ a.label }}</p>
              <p class="text-ink-200/80 text-xs leading-relaxed">{{ a.how }}</p>
              <p class="text-steel-400 text-[11px]">
                {{ data.scenes.filter(s => s.key_item?.acquisition === key).map(s => s.id).join(' · ') }}
              </p>
            </div>
          </div>

          <div class="border border-neon-600/40 p-5 space-y-3">
            <p class="font-display text-[10px] uppercase tracking-[0.28em] text-neon-400/80">Le temps d’une scène, en tours</p>
            <ul class="text-ink-200/85 text-sm space-y-1.5">
              <li><span class="text-neon-300 tabular-nums">{{ data.pacing.exchanges_before_steer }} échanges</span> — avec un même personnage, avant qu’il livre ce qu’il sait.</li>
              <li><span class="text-neon-300 tabular-nums">Tour {{ data.pacing.steer_after_turns }}</span> — le narrateur commence à orienter vers la sortie (ou vers l’objet qui manque).</li>
              <li><span class="text-red-400 tabular-nums">Tour {{ data.pacing.lock_turns }}</span> — sans objet-clé, la nuit se referme et la ville reste fermée {{ data.pacing.lock_hours }} h. Seule une remise imminente passe avant.</li>
              <li><span class="text-steel-400 tabular-nums">Tour {{ data.pacing.hard_turn_cap }}</span> — plafond de tours facturés ; la fermeture arrive avant.</li>
              <li><span class="text-steel-400">Après l’épilogue</span> — la ville reste fermée {{ data.pacing.completed_days }} jours : l’histoire ne se rejoue pas.</li>
            </ul>
          </div>
        </section>

        <!-- ─────────────── Scène par scène ─────────────── -->
        <section id="actes" class="space-y-8 scroll-mt-6">
          <h2 class="font-display text-[11px] uppercase tracking-[0.28em] text-ink-100">
            Scène par scène <span class="text-steel-400">— ce que chaque lieu impose</span>
          </h2>

          <div v-for="ch in chapters" :key="ch.id" class="space-y-3">
            <div class="flex flex-wrap items-baseline gap-x-3">
              <p class="font-display text-sm uppercase tracking-[0.2em] text-neon-300">{{ ch.title }}</p>
              <p v-if="facetOf(ch.scenes)" class="text-steel-400 text-xs">facette : {{ facetOf(ch.scenes) }}</p>
            </div>

            <article
              v-for="s in ch.scenes" :id="`scene-${s.id}`" :key="s.id"
              class="border border-steel-600/60 p-5 space-y-4 scroll-mt-6"
            >
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-display text-neon-300/90">{{ s.order }}. {{ s.id }}</span>
                <span class="text-ink-100 text-sm">{{ s.title }}</span>
                <span v-if="s.free" class="border border-neon-600/50 px-1.5 text-[9px] uppercase tracking-[0.14em] text-neon-300">offerte</span>
                <span v-if="s.gate" class="border border-red-400/50 px-1.5 text-[9px] uppercase tracking-[0.14em] text-red-400">sas payant</span>
                <span v-if="s.static_image" class="border border-steel-600/60 px-1.5 text-[9px] uppercase tracking-[0.14em] text-steel-400">image figée</span>
                <span v-if="s.ending" class="border border-steel-600/60 px-1.5 text-[9px] uppercase tracking-[0.14em] text-steel-400">épilogue</span>
              </div>

              <p v-if="s.theme_focus" class="text-steel-400 text-xs leading-relaxed">
                Étape {{ s.theme_focus.step }}/9 — {{ s.theme_focus.axis }}
              </p>

              <dl class="grid gap-x-6 gap-y-3 sm:grid-cols-2 text-xs">
                <div v-if="s.mechanic || s.objective?.statement" class="space-y-0.5">
                  <dt class="text-steel-400 uppercase tracking-[0.14em] text-[10px]">Mécanique</dt>
                  <dd class="text-ink-100">{{ s.mechanic || s.objective?.statement }}</dd>
                </div>
                <div v-if="s.objective?.requirement" class="space-y-0.5">
                  <dt class="text-steel-400 uppercase tracking-[0.14em] text-[10px]">Pour passer</dt>
                  <dd class="text-ink-100">{{ s.objective.requirement }}</dd>
                </div>
                <div v-if="s.key_item" class="space-y-0.5">
                  <dt class="text-steel-400 uppercase tracking-[0.14em] text-[10px]">Objet-clé</dt>
                  <dd class="text-ink-100">
                    {{ NATURE[s.key_item.nature] }} · {{ ACQUISITION[s.key_item.acquisition]?.label }}
                    <span v-if="s.key_item.acquisition !== 'found'" class="text-steel-400">
                      — cédé après {{ s.key_item.exchanges_before_handover }} échanges
                    </span>
                  </dd>
                </div>
                <div v-if="s.npc_count" class="space-y-0.5">
                  <dt class="text-steel-400 uppercase tracking-[0.14em] text-[10px]">Personnages</dt>
                  <dd class="text-ink-100">
                    {{ s.npc_count }}
                    <span v-if="s.key_item?.holder_stance" class="text-steel-400">— détenteur {{ s.key_item.holder_stance }}</span>
                    <span v-if="s.key_item?.informant_stance" class="text-steel-400">, informateur {{ s.key_item.informant_stance }}</span>
                  </dd>
                </div>
                <div v-for="e in s.exits" :key="e.label" class="space-y-0.5">
                  <dt class="text-steel-400 uppercase tracking-[0.14em] text-[10px]">Sortie</dt>
                  <dd class="text-ink-100">
                    « {{ e.label }} » → {{ titleOf(e.leads_to) }}
                    <span class="text-steel-400">— porte {{ e.min_turns ? `dès le tour ${e.min_turns}` : 'ouverte d’emblée' }}</span>
                  </dd>
                </div>
              </dl>

              <p v-if="s.exits.length && !s.ending" class="text-neon-300/70 text-[11px]">
                Titre, lieu, élément focal et nom du passage sont remplacés par le plan de la nuit — le script ne garde ici que des replis.
              </p>

              <div v-if="s.cast_stances.length" class="flex flex-wrap gap-2">
                <span v-for="(c, i) in s.cast_stances" :key="c.posture + i" class="border border-steel-700/70 px-2 py-0.5 text-[11px]">
                  <span class="text-neon-300">{{ i + 1 }}. {{ c.posture }}</span>
                  <span class="text-ink-300"> {{ c.means }}</span>
                </span>
              </div>

              <!-- Ce que la salle apprend : propre à l'auberge -->
              <div v-if="s.knowledge.length" class="space-y-2">
                <p class="text-steel-400 uppercase tracking-[0.14em] text-[10px]">Ce que la salle apprend — un morceau par personnage</p>
                <div class="overflow-x-auto">
                  <table class="w-full text-xs border-collapse">
                    <tbody>
                      <tr v-for="f in s.knowledge" :key="f.npc" class="border-t border-steel-700/60 align-top">
                        <td class="py-2 pr-3 text-neon-300/90 whitespace-nowrap">{{ f.npc }}</td>
                        <td class="py-2 pr-3 text-steel-400 whitespace-nowrap">{{ f.act }}</td>
                        <td class="py-2 pr-3 text-ink-200/85 leading-relaxed">{{ f.holds }}</td>
                        <td class="py-2 text-ink-300 leading-relaxed">{{ f.told_as }}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              <div v-if="s.counsel" class="space-y-1.5">
                <p class="text-steel-400 uppercase tracking-[0.14em] text-[10px]">La lecture finale — registres possibles</p>
                <ul class="text-ink-200/85 text-xs list-disc pl-4 space-y-0.5">
                  <li v-for="r in s.counsel.registers" :key="r">{{ r }}</li>
                </ul>
              </div>

              <details v-if="s.npc_instruction || s.key_item" class="text-xs">
                <summary class="cursor-pointer text-steel-400 hover:text-neon-300">Consignes de la scène</summary>
                <div class="pt-3 space-y-3">
                  <div v-if="s.npc_instruction">
                    <p class="text-neon-300/80 text-[10px] uppercase tracking-[0.14em] mb-1">Personnages</p>
                    <p class="text-ink-200/80 leading-relaxed whitespace-pre-line">{{ s.npc_instruction }}</p>
                  </div>
                  <div v-if="s.key_item">
                    <p class="text-neon-300/80 text-[10px] uppercase tracking-[0.14em] mb-1">Objet-clé</p>
                    <p class="text-ink-200/80 leading-relaxed whitespace-pre-line">{{ s.key_item.instruction }}</p>
                  </div>
                </div>
              </details>
            </article>
          </div>
        </section>

        <!-- ─────────────── Les objets ─────────────── -->
        <section id="objets" class="space-y-4 scroll-mt-6">
          <h2 class="font-display text-[11px] uppercase tracking-[0.28em] text-ink-100">
            Les objets <span class="text-steel-400">— ce qui se porte d’une scène à l’autre</span>
          </h2>
          <div class="grid gap-3 sm:grid-cols-3">
            <div v-for="k in [
              { tag: 'OUVRE', name: 'Carte, code, fréquence', text: 'L’objet-clé des scènes 2 à 10. Il déverrouille. Chaque carte a sa couleur, et chaque serrure affiche la sienne. Ne se troque jamais.' },
              { tag: 'ÉCLAIRE', name: 'Objet de récit', text: 'Pris dans le décor, déchiffré à la loupe. N’ouvre rien : sa valeur est ce qu’il apprend du joueur et de la quête.' },
              { tag: 'ÉCHANGE', name: 'Objet d’échange', text: 'Vaut pour quelqu’un d’autre. C’est le seul qu’un personnage peut réclamer, et il ne se reprend pas.' },
            ]" :key="k.tag" class="border border-steel-600/60 p-4 space-y-1.5">
              <span class="border border-neon-600/50 px-1.5 text-[9px] uppercase tracking-[0.14em] text-neon-300">{{ k.tag }}</span>
              <p class="text-ink-100 text-sm">{{ k.name }}</p>
              <p class="text-ink-200/80 text-xs leading-relaxed">{{ k.text }}</p>
            </div>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            <div class="border border-neon-600/40 p-4 space-y-1.5">
              <p class="font-display text-[10px] uppercase tracking-[0.18em] text-neon-400/80">L’augmentation</p>
              <p class="text-ink-200/85 text-xs leading-relaxed">
                Le seul objet à obtenir à l’auberge. Elle porte un nom propre soudé (PascalCase), le seul lisible de la
                nuit. Elle déchiffre les noms du dehors ; <code class="text-neon-300">resolving_action</code> dit ce
                qu’elle permet d’accomplir. Elle traverse toute la partie.
              </p>
            </div>
            <div class="border border-steel-600/60 p-4 space-y-1.5">
              <p class="font-display text-[10px] uppercase tracking-[0.18em] text-ink-100">L’objet scellé</p>
              <p class="text-ink-200/85 text-xs leading-relaxed">{{ ruleNote('sealed') }}</p>
            </div>
            <div class="border border-steel-600/60 p-4 space-y-1.5 sm:col-span-2">
              <p class="font-display text-[10px] uppercase tracking-[0.18em] text-ink-100">L’échange rend une chose, jamais deux</p>
              <ul class="text-ink-200/85 text-xs space-y-1 list-disc pl-4">
                <li><strong class="text-ink-100">ce qu’il sait</strong> — un morceau que personne d’autre ne dira ;</li>
                <li><strong class="text-ink-100">un objet</strong> — le sien, usé, qui entre dans l’inventaire ;</li>
                <li><strong class="text-ink-100">un morceau du décor caché</strong> — un élément absent du texte, qui n’existe qu’une fois montré.</li>
              </ul>
              <p class="text-steel-400 text-[11px]">Au plus un personnage réclame quelque chose par scène, et seulement un objet marqué ÉCHANGE que le joueur porte déjà.</p>
            </div>
          </div>
        </section>

        <!-- ─────────────── Le deck ─────────────── -->
        <section id="deck" class="space-y-4 scroll-mt-6">
          <h2 class="font-display text-[11px] uppercase tracking-[0.28em] text-ink-100">
            Le deck de moments <span class="text-steel-400">— ce que le jeu répond à une saisie, par priorité</span>
          </h2>
          <p class="text-ink-300 text-xs leading-relaxed">
            À chaque saisie, on tire le premier moment dont les conditions sont remplies. L’ordre de la liste est la
            priorité. Lu dans <code class="text-neon-300">utils/storylets.ts</code>.
          </p>
          <div class="overflow-x-auto">
            <table class="w-full text-xs border-collapse">
              <thead>
                <tr class="text-steel-400 font-display text-[10px] uppercase tracking-[0.16em]">
                  <th class="text-left py-2 pr-3 font-normal">#</th>
                  <th class="text-left py-2 pr-3 font-normal">Moment</th>
                  <th class="text-left py-2 pr-3 font-normal">Quand</th>
                  <th class="text-left py-2 font-normal">Ce qu’il joue</th>
                </tr>
              </thead>
              <tbody class="text-ink-200/85">
                <tr v-for="(m, i) in data.deck" :key="m.id" class="border-t border-steel-700/60 align-top">
                  <td class="py-2 pr-3 tabular-nums text-steel-400">{{ i + 1 }}</td>
                  <td class="py-2 pr-3 font-display text-neon-300/90 whitespace-nowrap">{{ m.id }}</td>
                  <td class="py-2 pr-3 leading-relaxed">{{ m.note }}</td>
                  <td class="py-2 leading-relaxed" :class="isFree(m.play) ? 'text-neon-300/80' : 'text-ink-100'">
                    {{ playLabel(m.play) }}
                    <span v-if="m.after.length" class="block text-steel-400">puis : {{ m.after.join(', ') }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <!-- ─────────────── Le dossier ─────────────── -->
        <section id="dossier" class="space-y-5 scroll-mt-6">
          <h2 class="font-display text-[11px] uppercase tracking-[0.28em] text-ink-100">
            Ce que le dossier décide <span class="text-steel-400">— la dynamique du joueur</span>
          </h2>
          <div class="grid gap-3 sm:grid-cols-3 text-xs">
            <div class="border border-steel-600/60 p-4 space-y-1.5">
              <p class="font-display text-[10px] uppercase tracking-[0.18em] text-ink-100">Date de naissance → signe</p>
              <p class="text-ink-200/80 leading-relaxed">Donne la <strong class="text-ink-100">tension</strong> et la <strong class="text-ink-100">résolution</strong> : le but de la nuit, ce que les lieux font traverser, et la fin.</p>
            </div>
            <div class="border border-steel-600/60 p-4 space-y-1.5">
              <p class="font-display text-[10px] uppercase tracking-[0.18em] text-ink-100">Date de naissance et nom → nombres</p>
              <p class="text-ink-200/80 leading-relaxed">
                Chaque acte est gouverné par une facette :
                <span v-for="(ch, i) in chapters.slice(1, 4)" :key="ch.id">{{ i ? ', ' : '' }}{{ ch.title }} → {{ facetOf(ch.scenes) }}</span>.
                Ce que la nuit oppose au joueur choisit aussi le porteur de l’augmentation. Aucun nombre ne dicte ses gestes.
              </p>
            </div>
            <div class="border border-steel-600/60 p-4 space-y-1.5">
              <p class="font-display text-[10px] uppercase tracking-[0.18em] text-ink-100">Syllabe de posture → personnage</p>
              <p class="text-ink-200/80 leading-relaxed">Chaque scène impose la position de ses personnages face à la tension. La syllabe termine leur nom et décide de leur voix.</p>
            </div>
          </div>

          <div class="flex flex-wrap gap-2">
            <span v-for="(means, syl) in data.dossier.postures" :key="syl" class="border border-steel-700/70 px-2 py-0.5 text-[11px]">
              <span class="text-neon-300">{{ syl }}</span><span class="text-ink-300"> {{ means }}</span>
            </span>
          </div>

          <details class="text-xs">
            <summary class="cursor-pointer text-steel-400 hover:text-neon-300">Les 12 signes — tension et résolution</summary>
            <div class="overflow-x-auto pt-3">
              <table class="w-full border-collapse">
                <tbody>
                  <tr v-for="sg in data.dossier.signs" :key="sg.name" class="border-t border-steel-700/60 align-top">
                    <td class="py-2 pr-3 text-neon-300/90 whitespace-nowrap">{{ sg.name }} <span class="text-steel-400">{{ sg.element }}</span></td>
                    <td class="py-2 pr-3 text-ink-200/85 leading-relaxed">{{ sg.tension }}</td>
                    <td class="py-2 text-ink-300 leading-relaxed">{{ sg.resolution }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </details>
          <details class="text-xs">
            <summary class="cursor-pointer text-steel-400 hover:text-neon-300">Les nombres — ce que la nuit oppose, objectif, accueil, héritage</summary>
            <div class="overflow-x-auto pt-3">
              <table class="w-full border-collapse">
                <thead>
                  <tr class="text-steel-400 text-[10px] uppercase tracking-[0.14em]">
                    <th class="text-left py-2 pr-3 font-normal">N</th>
                    <th class="text-left py-2 pr-3 font-normal">{{ FACET.terrain }}</th>
                    <th class="text-left py-2 pr-3 font-normal">{{ FACET.destiny }}</th>
                    <th class="text-left py-2 pr-3 font-normal">{{ FACET.reception }}</th>
                    <th class="text-left py-2 font-normal">Héritage</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="nb in data.dossier.numbers" :key="nb.n" class="border-t border-steel-700/60 align-top text-ink-200/85">
                    <td class="py-2 pr-3 text-neon-300/90">{{ nb.n }}</td>
                    <td class="py-2 pr-3 leading-relaxed">{{ nb.terrain }}</td>
                    <td class="py-2 pr-3 leading-relaxed">{{ nb.destiny }}</td>
                    <td class="py-2 pr-3 leading-relaxed">{{ nb.reception }}</td>
                    <td class="py-2 leading-relaxed">{{ nb.heritage }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </details>
        </section>

        <!-- ─────────────── Ce que le modèle écrit ─────────────── -->
        <section id="genere" class="space-y-4 scroll-mt-6">
          <h2 class="font-display text-[11px] uppercase tracking-[0.28em] text-ink-100">
            Ce que le modèle écrit <span class="text-steel-400">— les champs, pas le contenu</span>
          </h2>
          <p class="text-ink-300 text-xs leading-relaxed">
            L’auberge écrit la quête de la nuit en premier ; elle est ensuite portée par le journal et jamais
            régénérée. Chaque scène suivante reçoit son lieu du plan et écrit sa propre quête, ses personnages et son
            objet-clé dessus.
          </p>
          <div v-for="group in [
            { title: 'La quête de la nuit — écrite une fois, à l’auberge', rows: nightSchema ? [...nightSchema.top, ...nightSchema.act, ...nightSchema.place] : [] },
            { title: 'La quête — réécrite à chaque scène', rows: fieldsOf(data.schema.quest, 'quest') },
            { title: 'L’objet-clé', rows: fieldsOf(data.schema.key_item, 'key_item') },
            { title: 'L’objet scellé', rows: fieldsOf(data.schema.sealed_object, 'sealed_object') },
          ]" :key="group.title" class="space-y-2">
            <details class="text-xs border border-steel-700/60 p-4" :open="group.title.startsWith('La quête de la nuit')">
              <summary class="cursor-pointer font-display text-[10px] uppercase tracking-[0.18em] text-ink-100">{{ group.title }}</summary>
              <table class="w-full border-collapse mt-3">
                <tbody>
                  <tr v-for="r in group.rows" :key="r.key" class="border-t border-steel-700/60 align-top">
                    <td class="py-2 pr-3 whitespace-nowrap"><code class="text-neon-300/90">{{ r.key }}</code></td>
                    <td class="py-2 text-ink-200/85 leading-relaxed whitespace-pre-line">{{ r.text }}</td>
                  </tr>
                </tbody>
              </table>
            </details>
          </div>
        </section>

        <!-- ─────────────── Consignes ─────────────── -->
        <section id="regles" class="space-y-3 scroll-mt-6">
          <h2 class="font-display text-[11px] uppercase tracking-[0.28em] text-ink-100">
            Les consignes en entier <span class="text-steel-400">— defaults du script, communes à toutes les scènes</span>
          </h2>
          <details v-for="r in data.rules" :key="r.id" class="text-xs border border-steel-700/60 p-4">
            <summary class="cursor-pointer font-display text-[10px] uppercase tracking-[0.18em] text-ink-100">{{ r.title }}</summary>
            <div class="pt-3 space-y-3">
              <p v-if="r.note" class="text-neon-300/80 leading-relaxed">{{ r.note }}</p>
              <p class="text-ink-200/80 leading-relaxed whitespace-pre-line">{{ r.instruction }}</p>
            </div>
          </details>
        </section>
      </template>
    </div>
  </div>
</template>

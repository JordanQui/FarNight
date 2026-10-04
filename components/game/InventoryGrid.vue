<script setup lang="ts">
const { t } = useLang()

import { useInventory, type CarriedThing } from '~/composables/useInventory'

/**
 * TOUT CE QUE LE JOUEUR PORTE, ÉTALÉ.
 *
 * La barre sous le récit est faite pour le coup d'oeil : elle tient sur une
 * ligne, donc elle tronque, et au bout de trois scènes elle déborde. Une carte
 * ramassée dans la première rue s'y retrouve derrière un retour à la ligne, et
 * le joueur ne peut plus comparer sa couleur à celle d'une serrure.
 *
 * Cette grille est l'autre moitié : un nom entier par case, la couleur en
 * clair, l'endroit où la chose a été prise, et les MÊMES gestes qu'ailleurs —
 * analyser, observer, donner. Elle ne décide de rien : tout vient de
 * `useInventory`, que la barre interroge aussi.
 */
const emit = defineEmits<{ give: [id: string]; close: [] }>()

const { items, facing, actionFor, activate } = useInventory()

/**
 * Ce que la case dit d'elle-même, sous le nom.
 *
 * Trois natures, et le joueur doit les distinguer d'un coup d'oeil : ce qui
 * OUVRE porte sa couleur et ne se donne pas sans se bloquer, ce qui S'ÉCHANGE
 * ne vaut que pour quelqu'un d'autre, ce qui ÉCLAIRE ne vaut que pour lui.
 */
function natureOf(o: CarriedThing): string {
  if (o.kind === 'key') return t('game.item_key')
  return o.kind === 'trade' ? t('game.item_trade') : t('game.item_lore')
}

/** Le liseré de la case : la nature se lit avant le nom. */
function frameOf(o: CarriedThing): string {
  if (o.kind === 'key') return 'border-neon-600/45'
  return o.kind === 'trade' ? 'border-parchment/30' : 'border-steel-600/45'
}

function onActivate(o: CarriedThing) {
  activate(o)
  // Analyser ouvre l'épreuve, observer écrit dans le fil : dans les deux cas
  // ça se passe DERRIÈRE la grille, qui doit donc s'effacer.
  if (actionFor(o) !== 'none') emit('close')
}

function onGive(id: string) {
  emit('give', id)
  emit('close')
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(() => window.addEventListener('keydown', onKey))
onUnmounted(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <!--
    Pleine hauteur, mais la LISTE seule défile : le panneau ne pousse jamais
    l'écran vers le bas, quel que soit le nombre de choses portées.
  -->
  <div
    class="fixed inset-0 z-50 flex items-stretch justify-center px-4 py-4 sm:py-8"
    @click.self="emit('close')"
  >
    <div class="absolute inset-0 bg-ink-900/92" />

    <div
      class="relative z-10 w-full max-w-2xl h-full flex flex-col bg-ink-900 border border-neon-600/50 p-6"
      style="box-shadow: 0 24px 60px rgba(0,0,0,0.8), 0 0 40px rgb(var(--neon-500) / 0.12)"
    >
      <span class="absolute inset-[5px] border border-neon-500/15 pointer-events-none" />

      <div class="relative shrink-0 flex items-baseline justify-between gap-4 pb-5">
        <p class="text-neon-400/80 text-[10px] uppercase tracking-[0.32em] font-display">
          {{ t('game.inventory') }}
        </p>
        <button
          class="text-steel-400 hover:text-neon-300 text-[10px] uppercase tracking-[0.2em]
                 font-display transition-colors"
          @click="emit('close')"
        >
          {{ t('game.inventory_close') }}
        </button>
      </div>

      <!--
        La zone qui défile : le titre et la fermeture restent en place, seules
        les cases bougent quand l'inventaire déborde.
      -->
      <div class="relative flex-1 min-h-0 overflow-y-auto pr-1">
        <p v-if="!items.length" class="text-ink-200/70 text-sm leading-relaxed">
          {{ t('game.inventory_empty') }}
        </p>

        <div v-else class="grid grid-cols-2 sm:grid-cols-3 gap-2">
        <div
          v-for="o in items"
          :key="o.id"
          class="relative flex flex-col border p-3 gap-2"
          :class="frameOf(o)"
        >
          <!--
            Le pictogramme se lit avant le nom. Scellé tant que le nom l'est :
            il dit ce que l'objet signifie, et le montrer plus tôt reviendrait
            à le déchiffrer à la place du joueur.
          -->
          <ItemIcon
            :icon="o.icon"
            :kind="o.kind"
            :known="o.known"
            class="w-7 h-7"
            :class="o.known ? 'text-neon-300' : 'text-steel-600'"
          />

          <div class="flex items-center gap-2 min-w-0">
            <!-- La pastille de couleur : c'est elle qu'on compare à une serrure. -->
            <span
              v-if="o.kind === 'key'"
              class="w-2.5 h-2.5 shrink-0 border border-ink-50/25"
              :style="{ background: o.hex || 'rgb(var(--neon-500))' }"
              aria-hidden="true"
            />
            <span
              class="min-w-0 break-words text-[13px] leading-snug"
              :class="o.known
                ? (o.kind === 'key' ? 'text-neon-200' : 'text-ink-100')
                : 'font-mono text-steel-400'"
              data-thing
            >
              {{ o.known ? o.label : '••••••' }}
            </span>
          </div>

          <p class="text-steel-400 text-[10px] uppercase tracking-[0.16em] font-display">
            {{ natureOf(o) }}
            <span v-if="o.kind === 'key' && o.color" class="text-neon-400/70">· {{ o.color }}</span>
          </p>

          <p v-if="o.from" class="text-steel-400/70 text-[10px] leading-snug">
            {{ t('game.item_from', { place: o.from }) }}
          </p>

          <div class="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
            <button
              v-if="actionFor(o) !== 'none'"
              class="border px-2 py-1 text-[10px] uppercase tracking-[0.14em] font-display
                     transition-colors"
              :class="actionFor(o) === 'locked'
                ? 'border-steel-600/50 text-steel-400'
                : 'border-neon-600/50 text-neon-300 hover:bg-neon-500/10'"
              @click="onActivate(o)"
            >
              {{ actionFor(o) === 'read'
                ? t('game.action_read')
                : actionFor(o) === 'observe'
                  ? t('game.action_observe')
                  : t('game.action_locked') }}
            </button>

            <!--
              On ne donne qu'à quelqu'un : sans personne en face, le bouton
              n'aurait pas de destinataire, et un objet lâché dans le vide ne
              revient pas.
            -->
            <button
              v-if="facing"
              class="border border-steel-600/50 px-2 py-1 text-[10px] uppercase
                     tracking-[0.14em] font-display text-steel-400 hover:text-neon-300
                     transition-colors"
              :title="t('game.give_to', { name: facing.name })"
              @click="onGive(o.id)"
            >
              {{ t('game.give') }}
            </button>
          </div>
        </div>
      </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const { t } = useLang()

import { usePlayerStore } from '~/stores/player'
import { useGameStore } from '~/stores/game'
import { useInterfacePalette } from '~/composables/useInterfacePalette'
import type { EndingResponse } from '~/types/scene'
import { asJpeg, nightHeadOf, placesWithImagesOf, storeKeepsake, type Keepsake } from '~/utils/keepsake'
import { pack } from '~/utils/languages'
import { saveFile } from '~/utils/save-file'

/**
 * L'épilogue.
 *
 * Deux couches : l'image du lever du jour, générée et peuplée de ce que le joueur a
 * traversé, et par-dessus le texte de fin en HTML. C'est ce montage qui permet
 * d'avoir du vrai texte français lisible — aucun modèle d'image ne sait en
 * produire. Le HTML a été réduit côté serveur aux quatre balises autorisées.
 */
const playerStore = usePlayerStore()
const gameStore = useGameStore()
const interfacePalette = useInterfacePalette()

const ending = ref<EndingResponse | null>(null)
const image = ref<string | null>(null)
const error = ref<string | null>(null)
/** L'image est arrivée, ou a échoué : la page peut s'afficher. */
const drawn = ref(false)
/** La nuit mise de côté pour son PDF. */
const keepsake = ref<Keepsake | null>(null)

onMounted(async () => {
  try {
    ending.value = await $fetch<EndingResponse>('/api/scene/text', {
      method: 'POST',
      body: {
        sceneId: 'fin',
        user: playerStore.profile ?? undefined,
        journal: playerStore.journal,
        carried: gameStore.inventory.map(o => ({
          id: o.id,
          label: o.label,
          decrypted: gameStore.decryptedObjectIds.includes(o.id),
          from: o.from,
          kind: o.kind,
          color: o.color,
        })),
      },
    })
    // L'aube a sa propre palette : l'interface la prend aussi.
    interfacePalette.applyScene(ending.value)
  } catch (err) {
    error.value = (err as { data?: { statusMessage?: string } })?.data?.statusMessage
      ?? t('game.ending_failed')
    return
  }

  // Le texte attend son image : la page ne s'affiche qu'avec son fond.
  try {
    const res = await $fetch<{ image: string }>('/api/scene/image', {
      method: 'POST',
      body: {
        scene_id: 'fin',
        place_name: ending.value.scene_title,
        palette: ending.value.palette,
        decor: ending.value.decor,
      },
    })
    image.value = res.image
  } catch {
    // Sans image, le texte tient debout tout seul sur le fond de la palette.
  }
  drawn.value = true
  keepsake.value = await keepNight(ending.value)
})

/**
 * Ce que le PDF relira, gardé tout de suite.
 *
 * L'épilogue ne s'affiche qu'une fois : au rechargement, c'est l'écran de
 * fermeture qui revient, et il retrouve l'offre ici.
 */
async function keepNight(end: EndingResponse): Promise<Keepsake> {
  const head = nightHeadOf(playerStore.journal)
  const lang = playerStore.language
  const kept: Keepsake = {
    lang,
    name: playerStore.playerName,
    date: new Intl.DateTimeFormat(pack(lang).tag, { dateStyle: 'long' }).format(new Date()),
    title: head.title || end.scene_title,
    goal: head.goal,
    places: await placesWithImagesOf(playerStore.journal),
    augmentation: gameStore.augmentation?.name,
    kept: gameStore.inventory.filter(o => gameStore.decryptedObjectIds.includes(o.id)).map(o => o.label),
    ending_html: end.ending_html,
    image: image.value ? await asJpeg(image.value) : undefined,
    palette: {
      dominant: { hex: end.palette.dominant.hex },
      secondary: { hex: end.palette.secondary.hex },
      accent: { hex: end.palette.accent.hex },
    },
  }
  storeKeepsake(kept)
  return kept
}

/**
 * L'image de l'aube, emportée comme récompense.
 *
 * L'image arrive en data URL (gpt-image ne renvoie que du base64) ; on la repasse par un Blob, sinon certains navigateurs refusent
 * de télécharger une URL de plusieurs mégaoctets.
 */
const canDownload = computed(() => !!image.value && !!ending.value && !error.value)

async function downloadImage() {
  if (!image.value) return
  const blob = await (await fetch(image.value)).blob()
  const ext = blob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'webp'
  const name = `${t('seo.title').split(' — ')[0]} — ${ending.value?.scene_title ?? ''}`.trim()
  await saveFile(blob, `${name}.${ext}`)
}
</script>

<template>
  <div class="ending">
    <!-- L'image, en fond. Recadrée : le texte passe devant, pas à côté. -->
    <img v-if="image" :src="image" alt="" class="backdrop">
    <div class="veil" />

    <div class="sheet">
      <p v-if="error" class="text-neon-300 font-mono text-sm">{{ error }}</p>
      <!-- Réduit aux balises <h2> <p> <em> <strong> par le serveur. -->
      <!-- eslint-disable-next-line vue/no-v-html -->
      <article v-if="ending && drawn" class="prose" v-html="ending.ending_html" />
      <p v-else-if="!error" class="text-ink-200/70 font-mono text-sm animate-pulse">
        {{ t('game.dawn') }}
      </p>

      <button v-if="canDownload" type="button" class="keep" @click="downloadImage">
        {{ t('game.dawn_download') }}
      </button>

      <KeepsakeOffer v-if="keepsake && drawn" :keepsake="keepsake" />
    </div>
  </div>
</template>

<style scoped>
.ending {
  position: relative;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem 1.25rem;
  background: rgb(var(--ink-900));
  overflow: hidden;
}

.backdrop {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

/*
 * Sans ce voile, le texte se pose sur une image dont on ne maîtrise ni la
 * luminosité ni le contraste : illisible une partie sur deux. Il s'ouvre au
 * centre, là où le soleil doit rester visible.
 */
.veil {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(180deg, rgb(var(--ink-900) / 0.92) 0%, rgb(var(--ink-900) / 0.55) 38%,
                    rgb(var(--ink-900) / 0.55) 62%, rgb(var(--ink-900) / 0.94) 100%);
}

.sheet {
  position: relative;
  max-width: 34rem;
  width: 100%;
}

.prose :deep(h2) {
  font-family: Futura, 'Avenir Next', 'Century Gothic', 'Trebuchet MS', system-ui, sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: clamp(1.35rem, 5vw, 2rem);
  line-height: 1.15;
  color: rgb(var(--neon-200));
  text-shadow: 0 0 10px rgb(var(--neon-500) / 0.75), 0 0 28px rgb(var(--neon-500) / 0.4);
  margin-bottom: 1.5rem;
}

.prose :deep(p) {
  color: rgb(var(--ink-100) / 0.92);
  font-size: 0.98rem;
  line-height: 1.75;
  margin-bottom: 1rem;
}

/*
 * La lecture finale, mise à part.
 *
 * C'est le seul paragraphe qui sort de la fiction et s'adresse au joueur : il
 * ne doit pas se lire comme la suite du récit. Un filet et un retrait suffisent
 * — le HTML n'autorise aucun attribut, on ne peut donc pas le cibler par une
 * classe, mais il est toujours le dernier.
 */
.prose :deep(p:last-of-type) {
  margin-top: 1.75rem;
  padding-top: 1.5rem;
  padding-left: 1rem;
  border-top: 1px solid rgb(var(--neon-600) / 0.45);
  border-left: 2px solid rgb(var(--neon-500) / 0.6);
  color: rgb(var(--ink-100));
}

.keep {
  display: block;
  margin: 2.25rem auto 0;
  padding: 0.7rem 1.4rem;
  font-family: Futura, 'Avenir Next', 'Century Gothic', 'Trebuchet MS', system-ui, sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  font-size: 12px;
  color: rgb(var(--neon-200));
  border: 1px solid rgb(var(--neon-500) / 0.7);
  background: rgb(var(--ink-900) / 0.6);
  box-shadow: 0 0 14px rgb(var(--neon-500) / 0.35);
  transition: box-shadow 0.2s, color 0.2s;
}

.keep:hover,
.keep:focus-visible {
  color: rgb(var(--neon-100));
  box-shadow: 0 0 22px rgb(var(--neon-500) / 0.6);
  outline: none;
}

.prose :deep(em) {
  font-style: normal;
  color: rgb(var(--neon-300));
}

.prose :deep(strong) {
  font-weight: 600;
  color: rgb(var(--neon-200));
}
</style>

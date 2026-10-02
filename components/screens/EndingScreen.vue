<script setup lang="ts">
const { t } = useLang()

import { usePlayerStore } from '~/stores/player'
import { useGameStore } from '~/stores/game'
import { useInterfacePalette } from '~/composables/useInterfacePalette'
import type { EndingResponse } from '~/types/scene'

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
      ?? 'La fin ne s\'est pas écrite.'
    return
  }

  // L'image ne bloque pas la lecture : le texte est déjà là.
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
})

/**
 * L'image de l'aube, emportée comme récompense.
 *
 * L'image arrive en data URL (gpt-image ne renvoie que du base64) ; on la repasse par un Blob, sinon certains navigateurs refusent
 * de télécharger une URL de plusieurs mégaoctets. Sur mobile, la feuille de
 * partage permet de l'enregistrer dans la photothèque, ce qu'un téléchargement
 * n'offre pas sur iOS.
 */
const canDownload = computed(() => !!image.value && !!ending.value && !error.value)

async function downloadImage() {
  if (!image.value) return
  const blob = await (await fetch(image.value)).blob()
  const ext = blob.type.split('/')[1]?.replace('jpeg', 'jpg') || 'webp'
  const name = `${t('seo.title').split(' — ')[0]} — ${ending.value?.scene_title ?? ''}`.trim()
  const filename = `${name.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ')}.${ext}`
  const file = new File([blob], filename, { type: blob.type })

  const touch = window.matchMedia('(pointer: coarse)').matches
  if (touch && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
      return
    } catch (err) {
      // Feuille fermée par le joueur : il n'a rien demandé d'autre.
      if ((err as Error).name === 'AbortError') return
    }
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
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
      <article v-if="ending" class="prose" v-html="ending.ending_html" />
      <p v-else-if="!error" class="text-ink-200/70 font-mono text-sm animate-pulse">
        {{ t('game.dawn') }}
      </p>

      <button v-if="canDownload" type="button" class="keep" @click="downloadImage">
        {{ t('game.dawn_download') }}
      </button>
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

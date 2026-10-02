import { useGameStore } from '~/stores/game'
import { usePlayerStore } from '~/stores/player'
import { forgetStoredScene, saveRun } from '~/composables/useScene'
import { DEFAULT_LANG } from '~/types/i18n'
import { overlayValue } from '~/utils/languages'
import { inNight, nightLength } from '~/utils/night-clock'

/**
 * Le passage d'une scène à la suivante.
 *
 * Il n'existait nulle part : franchir le sas ramenait au même endroit, parce
 * que « continuer » ne faisait que réafficher l'écran de jeu — avec la scène
 * courante toujours en mémoire. Le paiement débloquait un droit d'accès sans
 * rien faire avancer.
 *
 * Un seul chemin ici, emprunté par la sortie jouée, par l'écran de paiement et
 * par les raccourcis de debug : les trois doivent laisser exactement le même
 * état derrière eux.
 */

export interface SceneRef {
  id: string
  title: string
  /** Le titre de l'acte, déjà résolu et prêt à afficher. Null hors des actes. */
  act: string | null
  /** Son identifiant, qui sert à retrouver la traduction du titre. */
  actId?: string | null
  kind: string
}

export function useProgression() {
  const gameStore = useGameStore()
  const playerStore = usePlayerStore()

  /**
   * Les scènes dans l'ordre, telles que le build les a inscrites.
   *
   * L'index est figé au build, donc en français : c'est `game/script.json` qui
   * l'écrit. Les titres sont retraduits ici, à la lecture — l'accueil affiche
   * « Continuer » avec le nom de la scène et celui de l'acte, et un joueur
   * anglophone y lisait « La Route » en pleine reprise de partie.
   */
  function scenes(): SceneRef[] {
    const lang = playerStore.language
    const index = (useRuntimeConfig().public.sceneIndex ?? []) as SceneRef[]
    // Le français ne surcharge rien : l'index EST déjà sa version.
    if (lang === DEFAULT_LANG) return index

    return index.map(scene => ({
      ...scene,
      title: overlayValue<string>(lang, `scene_titles.${scene.id}`) ?? scene.title,
      act: scene.actId
        ? overlayValue<string>(lang, `act_titles.${scene.actId}`) ?? scene.act
        : scene.act,
    }))
  }

  /** La scène qui suit celle en cours, ou null si c'était la dernière. */
  function next(): SceneRef | null {
    const all = scenes()
    const here = playerStore.scene?.scene_id ?? gameStore.pendingSceneId
    const i = all.findIndex(s => s.id === here)
    if (i < 0) return all[1] ?? null
    return all[i + 1] ?? null
  }

  /**
   * Ouvre une scène, quelle qu'elle soit.
   *
   * La scène quittée s'inscrit au journal — c'est lui que la suivante lira — et
   * la copie gardée en session est oubliée, sans quoi l'écran de construction
   * reposerait l'ancienne au lieu d'en demander une neuve.
   */
  function goTo(target: SceneRef) {
    const scene = target
    // LE TRAJET COÛTE LA NUIT, et l'aube peut tomber en chemin : il s'endort
    // alors en route plutôt que d'arriver. Lu sur la scène qu'on quitte — la
    // suivante n'est pas encore là. Le premier lieu de la nuit ne coûte rien :
    // c'est là que l'horloge part. Une aube déjà levée ne laisse plus entrer
    // nulle part.
    const clock = playerStore.scene?.pacing?.night_clock
    if (scene.kind !== 'ending' && clock) {
      if (gameStore.dawnBroke) {
        void fallAsleep()
        return
      }
      if (scene.id !== clock.starts_at_scene && inNight(scene.id, scenes(), clock)
        && gameStore.spendNight(clock.minutes.arrival, nightLength(clock)).dawn) {
        void fallAsleep()
        return
      }
    }

    playerStore.closeScene()
    // Il quitte l'auberge : ce qu'il porte à cet instant est ce que le
    // sommeil lui rendra.
    if (clock && scene.id === clock.starts_at_scene) {
      gameStore.markNightStart(playerStore.journal.length)
    }
    gameStore.startNewScene(scene.id)
    forgetStoredScene()
    // L'épilogue a son propre écran : il demande son texte et son image seul.
    gameStore.setScreen(scene.kind === 'ending' ? 'ending' : 'scene_build_loading')
  }

  /**
   * Reprend là où le joueur en était.
   *
   * Ce n'est PAS `goTo` : reprendre ne referme rien et n'oublie rien. La scène
   * gardée en session est laissée en place — si c'est bien la même, l'écran de
   * construction la repose telle quelle et la reprise ne coûte pas un centime.
   * `goTo`, lui, jette cette copie pour en réclamer une neuve : l'appeler ici
   * aurait fait repayer une génération à chaque rechargement de page.
   *
   * Faux si le serveur n'a rien retenu, ou si la scène retenue ne fait pas
   * partie de ce script — un cookie peut avoir survécu à une refonte.
   */
  function resume(): boolean {
    const id = gameStore.resumeSceneId
    if (!id) return false

    const target = scenes().find(s => s.id === id)
    if (!target) return false

    gameStore.startNewScene(target.id)
    gameStore.setScreen(target.kind === 'ending' ? 'ending' : 'scene_build_loading')
    return true
  }

  /**
   * Il s'est endormi : la ville ferme un cycle, puis la nuit recommence.
   *
   * Pas d'épilogue, pas de texte généré : un écran fixe, et le premier lieu
   * de la nuit au réveil. Il y retrouve ce qu'il portait en quittant
   * l'auberge, l'horloge à son départ ; les lieux d'après se régénèrent.
   *
   * Le serveur ferme ET ramène la position au premier lieu : c'est lui qui
   * décidera de la reprise. Le navigateur rembobine sa propre mémoire avant,
   * pour qu'un rechargement ne rende pas la partie d'avant le sommeil.
   */
  async function fallAsleep() {
    const start = playerStore.scene?.pacing?.night_clock?.starts_at_scene ?? 'a1s1'
    const keep = gameStore.rewindNight(start)
    playerStore.journal = playerStore.journal.slice(0, keep)
    forgetStoredScene()
    saveRun(gameStore, playerStore)

    const lock = await $fetch<{ until: number }>('/api/lockout', {
      method: 'POST', body: { asleep: true },
    }).catch(() => null)
    // Le serveur injoignable n'empêche pas l'écran : il dort quand même,
    // seule la fermeture n'est pas signée.
    gameStore.closeCity({ until: lock?.until ?? Date.now() + 24 * 3600_000, reason: 'asleep' })
  }

  /** La scène retenue, telle qu'on peut la nommer au joueur. */
  function resumeTarget(): SceneRef | null {
    const id = gameStore.resumeSceneId
    return id ? scenes().find(s => s.id === id) ?? null : null
  }

  /** Passe à la suite. Faux s'il n'y a plus rien après. */
  function advance(): boolean {
    const target = next()
    if (!target) return false
    goTo(target)
    return true
  }

  return { scenes, next, goTo, advance, resume, resumeTarget, fallAsleep }
}

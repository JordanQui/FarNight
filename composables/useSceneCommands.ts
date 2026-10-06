import { useGameStore } from '~/stores/game'
import { usePlayerStore } from '~/stores/player'
import { usePaywall } from '~/composables/usePaywall'
import { useProgression } from '~/composables/useProgression'

/**
 * Canal direct vers le scénario.
 *
 * Tout ce qui commence par '#' court-circuite le modèle : la saisie ne part
 * jamais chez gpt-4o, on agit directement sur la machine à états. Ça permet
 * d'atteindre une étape sans jouer les tours qui y mènent — et ça ne coûte
 * pas un token.
 *
 * Pour ajouter une commande, il suffit d'une entrée de plus dans `commands`.
 */

const PREFIX = '#'

export interface SceneCommand {
  /** Le mot tapé après le '#', en minuscules. */
  name: string
  /** Une ligne, affichée par #aide. */
  help: string
  run: () => void
}

export function useSceneCommands() {
  const gameStore = useGameStore()
  const playerStore = usePlayerStore()
  const { openExit } = usePaywall()
  const progression = useProgression()

  function say(text: string) {
    gameStore.addNarrativeEntry('system', text)
  }

  const commands: SceneCommand[] = [
    {
      name: 'sortie',
      help: 'force la porte : écran de sortie et paiement Square',
      run() {
        const gate = playerStore.scene?.paywall.gate_text
        if (!gate) {
          say('Aucune scène chargée — la porte n\'existe pas encore.')
          return
        }
        // Même mise en scène que la sortie jouée, mais sans les garde-fous du
        // nombre de tours ni de l'objet-clé : c'est tout l'intérêt du
        // raccourci — on va voir la porte, pas la mériter.
        gameStore.addNarrativeEntry('narration', gate)
        setTimeout(() => openExit({ force: true }), 1400)
      },
    },
    {
      name: 'resolution',
      help: 'force le dénouement : les personnages viennent et tendent l\'objet',
      run() {
        const item = playerStore.scene?.key_item
        if (!item) {
          say('Aucune scène chargée.')
          return
        }
        gameStore.markResolved()
        gameStore.markInformedAboutItem()
        gameStore.offerKeyItem()
        say('Dénouement forcé.')
      },
    },
    {
      name: 'scenes',
      help: 'liste les scènes et leur numéro',
      run() { jumpToScene('scene') },
    },
    {
      name: 'equipe',
      help: "recharge l'inventaire complet déclaré par le script (développement)",
      run() {
        const kit = useRuntimeConfig().public.devInventory as
          { items?: unknown[] } | null
        if (!kit) {
          say("L'inventaire de test n'existe qu'en développement.")
          return
        }
        gameStore.equipFromScript(kit as never)
        say(`Augmentation acquise. ${gameStore.inventory.length} objets sur toi.`)
      },
    },
    {
      name: 'ferme',
      help: 'ferme la ville comme si la nuit avait patiné : écran d\'adieu et verrou',
      run() {
        const scene = playerStore.scene
        void $fetch<{ until: number; text?: string }>('/api/lockout', { method: 'POST' })
          .then(lock => gameStore.closeCity({
            until: lock.until, reason: 'stalled', text: lock.text ?? scene?.game_over,
          }))
      },
    },
    {
      name: 'ouvre',
      help: 'lève le verrou (développement, phases de test) — sans ça une séance de test condamne la journée',
      run() {
        void $fetch('/api/lockout', { method: 'POST', body: { open: true } })
          .then(() => {
            gameStore.openCity()
            say('Verrou levé. La ville rouvre.')
          })
          .catch(() => say('Le verrou ne se lève qu\'en développement.'))
      },
    },
    {
      name: 'suivant',
      help: 'passe à la scène suivante, comme le ferait une sortie réussie',
      run() {
        const target = progression.next()
        if (!target) {
          say('Plus rien après celle-ci.')
          return
        }
        progression.goTo(target)
      },
    },
    {
      name: 'solution',
      help: 'déroule le chemin de la scène, lu dans la scène déjà générée (aucun appel)',
      run() {
        const scene = playerStore.scene
        const item = scene?.key_item
        if (!scene || !item) {
          say('Aucune scène chargée.')
          return
        }
        const has = gameStore.hasKeyItem
        const carried = (id: string) => gameStore.inventory.some(o => o.id === id)
        const npc = (id?: string) => scene.npcs.find(n => n.id === id)?.name ?? id ?? '?'
        const label = (id?: string) => scene.interactables.find(o => o.id === id)?.label
          ?? gameStore.inventory.find(o => o.id === id)?.label ?? id ?? '?'
        // [fait, étape] — null quand l'état du joueur ne permet pas de trancher.
        const steps: Array<[boolean | null, string]> = []

        const p = scene.puzzle
        if (item.acquisition === 'found' && p) {
          steps.push([has, 'Regarder deux choses du lieu : la seconde donne l\'indice.'])
          steps.push([has, `Énigme (${p.kind}) : ${
            p.kind === 'frequency' ? `régler sur ${p.solution} (${p.min}–${p.max})`
            : p.kind === 'code' ? `taper ${p.solution}`
            : p.kind === 'sequence' ? p.solution.map(i => p.steps[i]).join(' → ')
            : p.kind === 'lock' ? `présenter ${label(p.card_id)} (prise à ${p.place})`
            : `fouiller ${p.spots.find(s => s.id === p.solution)?.label ?? p.solution}`}`])
        } else if (item.acquisition === 'found') {
          steps.push([has, `Lire ${item.name} à l'oeil : le déchiffrer le remet.`])
        } else {
          if (item.acquisition !== 'holder' && item.informant_npc_id) {
            steps.push([has || gameStore.talkedToNpcIds.includes(item.informant_npc_id),
              `Questionner ${npc(item.informant_npc_id)} sur la quête : ${item.informant_hint}`])
          }
          const box = item.offering_id && scene.interactables.find(o => o.contains_id === item.offering_id)
          if (box) steps.push([has, `Nommer ${box.label} pour l'ouvrir, puis ramasser ${label(item.offering_id)}.`])
          steps.push([has, `Questionner ${npc(item.npc_id)}${
            item.offering_id ? `, lui donner ${label(item.offering_id)}` : ` (${item.exchanges_before_handover} échanges)`
          } : ${item.handover_hint} → ${item.name}`])
        }

        for (const n of scene.npcs.filter(n => n.wants)) {
          const w = n.wants!
          steps.push([null, `(facultatif) Donner ${label(w.item_id)} à ${n.name} → ${
            w.reward_item?.label ?? (w.reveals_id ? label(w.reveals_id) : w.reward)}`])
        }
        if (scene.required_item_id) {
          steps.push([carried(scene.required_item_id), `Ramasser ${label(scene.required_item_id)}.`])
        }
        if (scene.opens_with_card) {
          steps.push([null, `Utiliser ${item.name} sur ${scene.card_reader?.label ?? 'le lecteur'}.`])
        }
        steps.push([null, `Sortir : ${scene.exit_label || scene.paywall.exit_keywords[0] || '?'}`])

        say([
          `Solution — ${scene.scene_title}`,
          ...steps.map(([done, text], i) => `${done ? '✓' : '·'} ${i + 1}. ${text}`),
        ].join('\n'))
      },
    },
    {
      name: 'aide',
      help: 'liste les commandes disponibles',
      run() {
        say([
          ...commands.map(c => `${PREFIX}${c.name} — ${c.help}`),
          `${PREFIX}scene<n> — saute à la scène n (${PREFIX}scene2, ${PREFIX}scene7...)`,
        ].join('\n'))
      },
    },
  ]

  /** Les scènes, dans l'ordre, telles que le build les a inscrites. */
  const sceneIndex = progression.scenes

  /**
   * Saut direct à une scène : `#scene2`, `#scene7`...
   *
   * Ce n'est pas une commande comme les autres — son nom porte un numéro, donc
   * elle se reconnaît par motif. Elle referme proprement la scène en cours :
   * celle-ci s'inscrit au journal, et la suivante la lira, exactement comme si
   * elle avait été jouée jusqu'au bout.
   */
  function jumpToScene(name: string): boolean {
    // On accepte l'espace : « #scene3 » et « #scene 3 » se tapent aussi bien.
    const match = /^scene\s*(\d*)$/.exec(name)
    if (!match) return false

    const scenes = sceneIndex()
    // « #scene » sans numéro : on montre la liste plutôt qu'une erreur.
    if (!match[1]) {
      say(scenes.map((s, i) =>
        `${PREFIX}scene${i + 1} — ${s.title}${s.act ? ` (${s.act})` : ''}`).join('\n'))
      return true
    }
    const n = Number(match[1])
    const target = scenes[n - 1]
    if (!target) {
      say(`Il n'y a pas de scène ${n} — le jeu en compte ${scenes.length}.`)
      return true
    }

    // Même chemin que la sortie jouée et que l'après-paiement : les trois
    // doivent laisser exactement le même état derrière eux.
    progression.goTo(target)
    return true
  }

  /** Une saisie qui commence par '#' ne doit jamais atteindre le modèle. */
  function isCommand(input: string): boolean {
    return input.trim().startsWith(PREFIX)
  }

  function run(input: string): void {
    const raw = input.trim()
    const name = raw.slice(PREFIX.length).trim().toLowerCase()

    gameStore.addNarrativeEntry('player_command', raw)

    if (jumpToScene(name)) return

    const command = commands.find(c => c.name === name)
    if (!command) {
      say(`Commande inconnue : ${PREFIX}${name || '?'} — tape ${PREFIX}aide pour la liste.`)
      return
    }

    command.run()
  }

  return { isCommand, run, commands }
}

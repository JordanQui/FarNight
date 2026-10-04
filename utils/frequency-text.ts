/** Ensure the lens target is printed in the opening scene, even when generation omits it. */
export function ensureFrequencyTarget(scene: {
  scene_text: string
  key_item?: { name?: string } | null
  decor?: Array<{ slot_id: string; name: string }>
}): void {
  const name = scene.key_item?.name?.trim()
  if (!name || !scene.scene_text?.trim()) return
  if (scene.scene_text.toLocaleLowerCase().includes(name.toLocaleLowerCase())) return

  const focal = scene.decor?.find(d => d.slot_id === 'focal')?.name?.trim()
  if (focal) {
    const at = scene.scene_text.toLocaleLowerCase().indexOf(focal.toLocaleLowerCase())
    if (at !== -1) {
      const end = at + focal.length
      scene.scene_text = `${scene.scene_text.slice(0, end)} (${name})${scene.scene_text.slice(end)}`
      return
    }
  }
  // A missing focal mention must not strand the player without a lens target.
  scene.scene_text = `${scene.scene_text.trimEnd()}\n\n${focal ? `${focal} : ` : ''}${name}.`
}

/** A3S1 s'ouvre avec son objet, mais l'objet voyage ensuite comme offre facultative. */
export function sceneKeyInventoryKind(sceneId: string): 'key' | 'trade' {
  return sceneId === 'a3s1' ? 'trade' : 'key'
}

/** L'échange final ne fait jamais partie des conditions de réussite. */
export function finalSequenceNeedsExchange(_givenItemIds: readonly string[]): boolean {
  return false
}

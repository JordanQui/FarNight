/** A2S1 s’ouvre avec l’objet trouvé ; on peut ensuite le donner en A2S2. */
export function sceneKeyInventoryKind(sceneId: string): 'key' | 'trade' {
  return sceneId === 'a2s1' ? 'trade' : 'key'
}

/** La séquence finale ne dépend pas des échanges précédents. */
export function finalSequenceNeedsExchange(_givenItemIds: readonly string[]): boolean {
  return false
}

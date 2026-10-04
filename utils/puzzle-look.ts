/** Only a different second object reveals a puzzle's answer. */
export function isSecondLook(thing: string | null, lookedLabels: string[], hasKeyItem: boolean): boolean {
  return Boolean(thing) && !hasKeyItem && lookedLabels.some(label => label !== thing)
}
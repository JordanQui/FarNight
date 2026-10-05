/** A name that has already been deciphered still has its voice. */
export function canChimeName(eyeActive: boolean, activeTool: 'eye' | 'lens'): boolean {
  return eyeActive && activeTool === 'eye'
}

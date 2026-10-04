/** A name that has already been deciphered still has its voice. */
export function canChimeName(eyeActive: boolean, eyeHidden: boolean, activeTool: 'eye' | 'lens'): boolean {
  return eyeActive && !eyeHidden && activeTool === 'eye'
}

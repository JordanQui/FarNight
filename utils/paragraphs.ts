/**
 * Le récit, aéré : chaque retour à la ligne devient une ligne vide.
 *
 * Le modèle sépare ses paragraphes tantôt d'un saut, tantôt de deux. Rendu en
 * `whitespace-pre-line`, un saut seul colle les paragraphes l'un à l'autre et
 * le texte se lit comme un bloc. Les sauts en tête sont retirés, pas ceux de
 * fin : le flux arrive encore, et le texte normalisé doit rester un préfixe du
 * suivant pour que la machine à écrire ne reparte pas de zéro.
 */
export function spaceParagraphs(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*\n/, '')
    .replace(/\n\s*/g, '\n\n')
}

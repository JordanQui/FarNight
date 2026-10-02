import type { LangCode } from '~/types/i18n'
import { DEFAULT_LANG } from '~/types/i18n'
import { LANGUAGES, detectLang, dirOf, pack, resolveLang, translate } from '~/utils/languages'

/**
 * La langue courante, et de quoi la traduire.
 *
 * Elle vit dans un COOKIE, pas dans le store : elle doit être connue avant
 * qu'un dossier existe — l'accueil et le formulaire d'admission s'affichent
 * bien avant que le joueur ait déclaré quoi que ce soit — et elle doit être
 * connue DU SERVEUR, qui rend les messages de quota et de fermeture. Un cookie
 * répond aux deux ; `useCookie` le lit au rendu serveur comme au navigateur,
 * donc l'écran arrive déjà dans la bonne langue et l'hydratation ne diverge pas.
 *
 * Le profil en garde une copie (`UserProfile.language`) : le cookie habille,
 * le profil décide de la génération. Les deux sont écrits ensemble au dépôt du
 * dossier, mais seul le profil survit à un changement d'appareil.
 */

const COOKIE = 'tg_lang'
/** Un an : c'est une préférence, pas une session. */
const MAX_AGE = 60 * 60 * 24 * 365

export function useLang() {
  const cookie = useCookie<LangCode>(COOKIE, {
    maxAge: MAX_AGE,
    sameSite: 'lax',
    // Le sélecteur l'écrit depuis le navigateur : pas de httpOnly.
    path: '/',
    default: () => DEFAULT_LANG,
  })

  /**
   * Ce que le navigateur demande, la toute première fois.
   *
   * Uniquement si le cookie n'a jamais été posé : un joueur qui a choisi le
   * français sur un navigateur anglais ne doit pas se faire corriger au
   * rechargement suivant. On regarde donc l'en-tête AVANT de poser le cookie,
   * et plus jamais après.
   */
  if (import.meta.server) {
    const headers = useRequestHeaders(['cookie', 'accept-language'])
    if (!headers.cookie?.includes(`${COOKIE}=`)) {
      cookie.value = detectLang(headers['accept-language'])
    }
  }

  const lang = computed<LangCode>(() => resolveLang(cookie.value))

  /** La langue jouée change : tout l'habillage suit au prochain rendu. */
  function setLang(next: LangCode) {
    cookie.value = resolveLang(next)
    if (import.meta.client) {
      document.documentElement.lang = pack(cookie.value).tag
      document.documentElement.dir = dirOf(cookie.value)
    }
  }

  /** Une chaîne d'habillage, variables remplies. */
  function t(key: string, vars?: Record<string, string | number>): string {
    return translate(lang.value, key, vars)
  }

  return { lang, setLang, t, languages: LANGUAGES }
}

<script setup lang="ts">
import { usePlayerStore } from '~/stores/player'
import { useGameStore } from '~/stores/game'
import { emptyAdmissionForm, profileFromAdmission, type AdmissionForm } from '~/utils/admission'
import { needsLatinName } from '~/utils/numerology'
import { rememberedAdmission, storeAdmission, forgetAdmission } from '~/composables/useScene'
import type { UserAgreement } from '~/types/user'
import type { LangCode } from '~/types/i18n'

/**
 * Le formulaire d'admission.
 *
 * Il remplace la connexion Meta : ce que le compte donnait, le joueur le
 * déclare. On ne demande que ce que le jeu consomme réellement — l'inventaire
 * des champs est en tête de utils/admission.ts.
 *
 * Six écrans plutôt qu'une longue page : sur téléphone, une colonne de vingt
 * champs se referme avant d'être remplie. Seule la première étape est
 * obligatoire — le nom et la date fondent le signe et les nombres, tout le
 * reste enrichit sans jamais bloquer l'entrée.
 *
 * TOUT SE TAPE, sauf l'accord grammatical et la langue. Les grilles de touches
 * ont été retirées : une touche rend au générateur un vocabulaire qu'il a
 * lui-même écrit, et deux joueurs qui cochent la même case traversent la même
 * nuit. Ce que le joueur tape, personne d'autre ne l'a tapé. Les listes d'avant
 * survivent en EXEMPLES sous les champs — elles amorcent, elles ne répondent
 * pas.
 *
 * LA LANGUE EST EN TÊTE, hors des étapes, et elle agit tout de suite : la
 * choisir retourne le formulaire lui-même. On ne fait pas remplir vingt lignes
 * dans une langue pour jouer dans une autre, et il faut que le joueur voie
 * immédiatement ce qu'il vient de choisir — c'est la seule démonstration
 * honnête de ce qui l'attend.
 */
const playerStore = usePlayerStore()
const gameStore = useGameStore()
const { lang, setLang, t, languages } = useLang()

const form = reactive(emptyAdmissionForm(lang.value))

/**
 * Le cookie et le dossier disent la même chose, toujours.
 *
 * Le cookie habille l'écran (et le rendu serveur), le dossier décide de la
 * génération. Les écrire séparément aurait fini par les faire diverger : un
 * joueur qui change de langue puis dépose son dossier aurait joué dans l'une
 * et lu l'interface dans l'autre.
 */
function chooseLang(code: LangCode) {
  form.language = code
  setLang(code)
}

/** Les six étapes, titres et légendes pris au pack de langue. */
const STEPS = computed(() => [1, 2, 3, 4, 5, 6].map(n => ({
  title: t(`admission.step${n}_title`),
  legend: t(`admission.step${n}_legend`),
})))

/**
 * L'accord, proposé en trois touches.
 *
 * Ce n'est pas une question d'identité : c'est une question de grammaire — le
 * jeu narre à la deuxième personne et doit savoir accorder. L'exemple change
 * complètement d'une langue à l'autre : « tu es entrée » en français, une
 * forme d'adresse en turc, un pronom en anglais. C'est le pack qui le dit.
 */
const AGREEMENTS: UserAgreement[] = ['masculin', 'feminin', 'neutre']
const agreementChoices = computed(() => AGREEMENTS.map(value => ({
  value,
  label: t(`admission.agreement_${value}`),
  example: t(`admission.agreement_ex_${value}`),
})))

/**
 * Les trois repères : un moment, un film, un animal.
 *
 * Ils ont remplacé les trois lignes de passions, dont la première — « ce à
 * quoi vous tenez le plus » — reposait la question de l'objet des empreintes.
 * Chacun a son rôle dans la nuit (`defaults.touchstones`, script.json) ; l'amorce
 * n'entre jamais au dossier.
 */
const TOUCHSTONES = [
  { key: 'moment', id: 'moment' },
  { key: 'fearFilm', id: 'fear_film' },
  { key: 'animal', id: 'animal' },
] as const
const touchstoneFields = computed(() => TOUCHSTONES.map(({ key, id }) => ({
  key,
  label: t(`admission.${id}`),
  hint: t(`admission.${id}_hint`),
})))

const step = ref(0)
/** `form` tant qu'on remplit, `verdict` une fois le dossier déposé. */
const phase = ref<'form' | 'verdict'>('form')

/**
 * Le prénom et la date : sans eux, ni signe, ni nombres, ni nom à l'écran.
 *
 * Deux lettres au moins — mais UN idéogramme suffit : 伟 est un prénom entier.
 */
const hasIdentity = computed(() => {
  const first = form.firstName.trim()
  const enough = first.length >= 2 || /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(first)
  return enough && form.birthday.length === 10
})

const canAdvance = computed(() => step.value > 0 || hasIdentity.value)

/**
 * Le dossier a été rempli jusqu'au bout une fois — dans cette visite ou dans
 * une précédente. Revenir corriger une réponse ne doit plus obliger à refaire
 * les six étapes : « Lancer l'aventure » reste à portée sur chacune.
 */
const reachedEnd = ref(false)
watch(step, (n) => { if (n === STEPS.value.length - 1) reachedEnd.value = true })

const canLaunch = computed(() => reachedEnd.value && hasIdentity.value)

/** Déposer le dossier et partir tout de suite, sans repasser par la réponse de la commission. */
function launch() {
  if (!canLaunch.value) return
  playerStore.setProfile(profileFromAdmission(form))
  enterCity()
}

/**
 * Le nom écrit ne se calcule pas (chinois, kanji) : on demande sa forme latine,
 * et à lui seul. Un nom latin, arabe, cyrillique ou en kana se pèse tout seul.
 */
const latinFirst = computed(() => needsLatinName(form.firstName))
const latinLast = computed(() => needsLatinName(form.lastName))

/**
 * Entrée passe à l'étape suivante — mais pas depuis une zone de texte, où la
 * touche sert à écrire. Les nuits et le rêve sont les deux seuls champs
 * multilignes du dossier.
 */
function onEnter(event: KeyboardEvent) {
  if ((event.target as HTMLElement | null)?.tagName === 'TEXTAREA') return
  next()
}

function next() {
  if (!canAdvance.value) return
  if (step.value < STEPS.value.length - 1) step.value++
  else submit()
}

function back() {
  if (step.value > 0) step.value--
}

/**
 * Le dossier est déposé. Le profil part dans le store — c'est lui que
 * `SceneBuildScreen` enverra à la génération — et l'écran bascule sur la
 * réponse de la commission.
 */
function submit() {
  playerStore.setProfile(profileFromAdmission(form))
  reachedEnd.value = true
  phase.value = 'verdict'
}

function enterCity() {
  gameStore.setScreen('scene_build_loading')
}

function cancel() {
  gameStore.setScreen('login')
}

/**
 * Les réponses déjà données reviennent dans le formulaire.
 *
 * Après le montage : la mémoire du navigateur n'existe pas au rendu serveur. La
 * langue reste celle qu'on vient de choisir — l'accueil a pu la changer depuis.
 */
onMounted(() => {
  const kept = rememberedAdmission()
  if (kept) {
    // Champ par champ, et seulement ceux qui existent encore : un dossier gardé
    // d'avant le 2026-09-21 porte des passions et deux bascules. Les passions
    // se perdent — elles ne répondaient pas aux mêmes questions —, la première
    // bascule reste.
    const empty = emptyAdmissionForm(lang.value)
    const old = kept.form as Partial<AdmissionForm> & { turningPoints?: string[] }
    const known = Object.fromEntries(
      Object.keys(empty).filter(k => k in old).map(k => [k, old[k as keyof AdmissionForm]]))
    Object.assign(form, empty, known, {
      language: lang.value,
      turningPoint: old.turningPoint ?? old.turningPoints?.[0] ?? '',
    })
    step.value = Math.min(Math.max(kept.step ?? 0, 0), STEPS.value.length - 1)
    if (step.value === STEPS.value.length - 1) reachedEnd.value = true
  }

  // Écrit à chaque frappe. Un formulaire encore vierge ne laisse aucune trace.
  watch([form, step], () => {
    if (isBlank()) forgetAdmission()
    else storeAdmission(form, step.value)
  }, { deep: true })
})

/** Rien n'a été écrit. L'accord et la langue sont des réglages, pas des réponses. */
function isBlank(): boolean {
  const { language: _l, agreement: _a, ...texts } = form
  return Object.values(texts).every(v => !String(v).trim())
}

const hasAnswers = computed(() => !isBlank())

/**
 * Effacer ses réponses : le geste d'oubli annoncé par l'avertissement.
 *
 * En deux temps : vingt lignes tapées ne doivent pas disparaître d'un clic
 * égaré. La confirmation retombe d'elle-même.
 */
const confirmingClear = ref(false)
let clearTimer: ReturnType<typeof setTimeout> | null = null

function clearAnswers() {
  if (!confirmingClear.value) {
    confirmingClear.value = true
    clearTimer = setTimeout(() => { confirmingClear.value = false }, 4000)
    return
  }
  if (clearTimer) clearTimeout(clearTimer)
  confirmingClear.value = false
  Object.assign(form, emptyAdmissionForm(lang.value))
  step.value = 0
  reachedEnd.value = false
  forgetAdmission()
}

onUnmounted(() => { if (clearTimer) clearTimeout(clearTimer) })

/**
 * Numéro de dossier. Dérivé du nom, jamais tiré au hasard : deux affichages du
 * même dossier doivent porter le même numéro, et un Math.random() ferait
 * diverger le rendu.
 */
const fullName = computed(
  () => [form.firstName.trim(), form.lastName.trim()].filter(Boolean).join(' '))

const fileNumber = computed(() => {
  const seed = [...fullName.value.toUpperCase()].reduce((n, c) => n + c.charCodeAt(0), 0)
  return String(4200 + (seed % 5700)).padStart(4, '0')
})

const displayName = computed(() => fullName.value || t('admission.unnamed'))
const displayCity = computed(() => form.currentCity.trim() || t('admission.somewhere'))
</script>

<template>
  <div class="relative min-h-[100dvh] overflow-y-auto px-5 py-10 flex flex-col items-center">
    <!-- Lueur basse, comme sur l'accueil : c'est la même nuit -->
    <div
      class="fixed inset-x-0 bottom-0 h-[45vh] pointer-events-none"
      style="background: radial-gradient(90% 100% at 50% 100%, rgb(var(--neon-500) / 0.16) 0%, transparent 70%)"
    />

    <div class="relative z-10 w-full max-w-md">
      <!-- ================= LE FORMULAIRE ================= -->
      <template v-if="phase === 'form'">
        <div class="text-center space-y-3 mb-8">
          <p class="text-steel-400 text-[10px] uppercase tracking-[0.4em] font-display">
            {{ t('admission.eyebrow') }}
          </p>
          <h1 class="neon-text font-display uppercase text-2xl sm:text-[1.9rem] tracking-[0.06em] leading-tight">
            {{ t('admission.title_line1') }}<br>{{ t('admission.title_line2') }}
          </h1>
          <div class="neon-rule w-28 mx-auto" />
        </div>

        <!--
          LA LANGUE, hors des étapes et au-dessus d'elles. Elle ne fait pas
          partie du dossier qu'on remplit : elle décide de la langue dans
          laquelle on le remplit, et la choisir retourne l'écran à l'instant.
        -->
        <label class="block space-y-2 mb-6">
          <span class="field-label">{{ t('lang.label') }}</span>
          <select
            class="field field-select"
            :value="form.language"
            @change="chooseLang(($event.target as HTMLSelectElement).value as LangCode)"
          >
            <option v-for="l in languages" :key="l.code" :value="l.code">{{ l.endonym }}</option>
          </select>
          <span class="field-hint">{{ t('lang.hint') }}</span>
        </label>

        <!-- Avancement : un cran par étape, le cran courant seul est allumé -->
        <div class="flex items-center gap-1.5 mb-6">
          <span
            v-for="(s, i) in STEPS"
            :key="s.title"
            class="h-[3px] flex-1 transition-colors duration-300"
            :class="i < step ? 'bg-neon-600/70' : i === step ? 'bg-neon-400' : 'bg-steel-700'"
          />
        </div>

        <div
          class="dossier relative bg-ink-900/85 border border-neon-600/40 p-6 sm:p-7 space-y-6"
          @keyup.enter="onEnter"
        >
          <span class="absolute inset-[5px] border border-neon-500/12 pointer-events-none" />

          <div class="relative space-y-1">
            <p class="text-neon-400/80 text-[10px] uppercase tracking-[0.32em] font-display">
              {{ t('admission.step', { current: step + 1, total: STEPS.length, title: STEPS[step].title }) }}
            </p>
            <p class="text-steel-400 text-[11px] leading-relaxed">{{ STEPS[step].legend }}</p>
          </div>

          <!--
            1. IDENTITÉ — prénom et nom SÉPARÉS, et ce n'est pas cosmétique :
            le prénom porte le namank (l'accueil du monde), le nom complet
            porte l'héritage. Les réunir ferait perdre l'un des deux nombres.
          -->
          <div v-if="step === 0" class="relative space-y-5">
            <div class="grid grid-cols-2 gap-3">
              <label class="block space-y-2">
                <span class="field-label">{{ t('admission.first_name') }}</span>
                <input v-model="form.firstName" type="text" class="field" :placeholder="t('admission.first_name_ph')" autocomplete="given-name">
              </label>
              <label class="block space-y-2">
                <span class="field-label">{{ t('admission.last_name') }}</span>
                <input v-model="form.lastName" type="text" class="field" :placeholder="t('admission.last_name_ph')" autocomplete="family-name">
              </label>
            </div>

            <!-- Seulement quand le nom écrit ne donne aucun nombre. -->
            <div v-if="latinFirst || latinLast" class="space-y-2">
              <div class="grid grid-cols-2 gap-3">
                <label v-if="latinFirst" class="block space-y-2">
                  <span class="field-label">{{ t('admission.first_name_latin') }}</span>
                  <input v-model="form.firstNameLatin" type="text" class="field" :placeholder="t('admission.latin_ph')" autocomplete="off" lang="en">
                </label>
                <label v-if="latinLast" class="block space-y-2" :class="!latinFirst && 'col-start-2'">
                  <span class="field-label">{{ t('admission.last_name_latin') }}</span>
                  <input v-model="form.lastNameLatin" type="text" class="field" :placeholder="t('admission.latin_ph')" autocomplete="off" lang="en">
                </label>
              </div>
              <span class="field-hint">{{ t('admission.latin_hint') }}</span>
            </div>

            <label class="block space-y-2">
              <span class="field-label">{{ t('admission.birthday') }}</span>
              <input v-model="form.birthday" type="date" class="field" max="2020-12-31">
              <span class="field-hint">{{ t('admission.birthday_hint') }}</span>
            </label>

            <div class="space-y-2">
              <span class="field-label">{{ t('admission.agreement') }}</span>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="choice in agreementChoices"
                  :key="choice.value"
                  type="button"
                  class="chip"
                  :class="form.agreement === choice.value && 'chip-on'"
                  @click="form.agreement = choice.value"
                >
                  {{ choice.label }}
                </button>
              </div>
              <span class="field-hint">
                {{ t('admission.agreement_hint', {
                  example: agreementChoices.find(c => c.value === form.agreement)?.example ?? '',
                }) }}
              </span>
            </div>
          </div>

          <!-- 2. ORIGINE -->
          <div v-else-if="step === 1" class="relative space-y-5">
            <label class="block space-y-2">
              <span class="field-label">{{ t('admission.hometown') }}</span>
              <input v-model="form.hometown" type="text" class="field">
            </label>
            <label class="block space-y-2">
              <span class="field-label">{{ t('admission.current_city') }}</span>
              <input v-model="form.currentCity" type="text" class="field">
              <span class="field-hint">{{ t('admission.current_city_hint') }}</span>
            </label>
          </div>

          <!--
            3. REPÈRES — un moment, un film, un animal. Trois questions qui se
            répondent en trois secondes et jamais deux fois pareil, et qui ne
            reposent pas celle de l'objet : chacune a son rôle dans la nuit.
          -->
          <div v-else-if="step === 2" class="relative space-y-4">
            <p class="text-ink-200/70 text-[12px] leading-relaxed">
              {{ t('admission.touchstones_intro') }}
            </p>
            <div class="space-y-4">
              <label v-for="field in touchstoneFields" :key="field.key" class="block space-y-2">
                <span class="field-label">{{ field.label }}</span>
                <input
                  v-model="form[field.key]"
                  type="text"
                  class="field"
                >
                <span class="field-hint">{{ field.hint }}</span>
              </label>
            </div>

            <div class="h-px bg-neon-600/20" />

            <!--
              Le morceau : le son de la nuit. Jamais cité — ni ses paroles, ni
              son titre —, il s'entend à l'auberge, revient haché dehors et
              passe en entier au dernier lieu. Voir `defaults.touchstones`.
            -->
            <div class="grid grid-cols-2 gap-3">
              <label class="block space-y-2">
                <span class="field-label">{{ t('admission.anthem_title') }}</span>
                <input v-model="form.anthemTitle" type="text" class="field">
              </label>
              <label class="block space-y-2">
                <span class="field-label">{{ t('admission.anthem_artist') }}</span>
                <input v-model="form.anthemArtist" type="text" class="field">
              </label>
            </div>
            <span class="field-hint">{{ t('admission.anthem_hint') }}</span>
          </div>

          <!-- 4. LA BASCULE — une seule : deux, c'était trop -->
          <div v-else-if="step === 3" class="relative space-y-5">
            <p class="text-ink-200/70 text-[12px] leading-relaxed">
              {{ t('admission.turning_intro') }}
            </p>
            <label class="block space-y-2">
              <span class="field-label">{{ t('admission.turning1') }}</span>
              <input v-model="form.turningPoint" type="text" class="field">
            </label>
          </div>

          <!--
            5. EMPREINTES — les quatre seuls champs qui ne racontent pas un
            état civil. Ils reviennent en décor : l'objet sur une table, le
            refuge en façade, le prénom dans la bouche d'un inconnu, et ce qu'il
            ne supporte pas juste en travers de son chemin.
          -->
          <div v-else-if="step === 4" class="relative space-y-5">
            <label class="block space-y-2">
              <span class="field-label">{{ t('admission.keepsake') }}</span>
              <input v-model="form.keepsake" type="text" class="field">
            </label>
            <label class="block space-y-2">
              <span class="field-label">{{ t('admission.refuge') }}</span>
              <input v-model="form.refuge" type="text" class="field">
            </label>
            <label class="block space-y-2">
              <span class="field-label">
                {{ t('admission.ally') }} <span class="text-steel-500">{{ t('admission.ally_note') }}</span>
              </span>
              <input v-model="form.ally" type="text" class="field" :placeholder="t('admission.ally_ph')">
            </label>
            <label class="block space-y-2">
              <span class="field-label">{{ t('admission.aversion') }}</span>
              <input v-model="form.aversion" type="text" class="field">
            </label>
          </div>

          <!--
            6. NUITS — la seule étape qui ne consigne pas un état civil.
            La question est posée en CONDITIONNEL : « quel dormeur êtes-vous »
            n'appelle rien de la part de qui dort bien, alors que des nuits sans
            sommeil, tout le monde en a. Et les réponses se passent DEHORS —
            le jeu est une nuit dans une ville, un quai ou un dernier bar lui
            donnent un décor, le plafond d'une chambre ne lui donne rien.
            Le rêve, PARCE QU'IL REVIENT, est le seul motif du dossier qu'une
            scène peut reposer sans lasser.
            Deux lignes libres, et plus de touches : ici plus qu'ailleurs, le
            joueur est le seul à pouvoir écrire ce qu'il fait de ses nuits.
          -->
          <div v-else class="relative space-y-5">
            <p class="text-ink-200/70 text-[12px] leading-relaxed">
              {{ t('admission.nights_intro') }}
            </p>

            <label class="block space-y-2">
              <span class="field-label">{{ t('admission.awake') }}</span>
              <textarea
                v-model="form.awakeNote"
                rows="2"
                class="field field-multi"
              />
              <span class="field-hint">{{ t('admission.awake_hint') }}</span>
            </label>

            <label class="block space-y-2">
              <span class="field-label">{{ t('admission.dream') }}</span>
              <textarea
                v-model="form.dreamNote"
                rows="2"
                class="field field-multi"
              />
              <span class="field-hint">{{ t('admission.dream_hint') }}</span>
            </label>
          </div>

          <div class="relative h-px bg-neon-600/25" />

          <div class="relative flex items-center justify-between gap-4">
            <button
              class="font-display text-[10px] uppercase tracking-[0.28em] text-steel-400
                     hover:text-ink-200 transition-colors py-2"
              @click="step === 0 ? cancel() : back()"
            >
              {{ step === 0 ? t('common.back') : t('common.previous') }}
            </button>
            <GlowButton :disabled="!canAdvance" @click="next">
              {{ step === STEPS.length - 1 ? t('admission.submit') : t('common.next') }}
            </GlowButton>
          </div>

          <GlowButton
            v-if="canLaunch && step < STEPS.length - 1"
            class="relative w-full"
            @click="launch"
          >
            {{ t('admission.launch') }}
          </GlowButton>

          <p v-if="step === 0 && !canAdvance" class="relative field-hint text-center">
            {{ t('admission.required_hint') }}
          </p>

          <div v-if="hasAnswers" class="relative text-center">
            <button
              type="button"
              class="font-display text-[10px] uppercase tracking-[0.28em] transition-colors py-1"
              :class="confirmingClear ? 'text-neon-400' : 'text-steel-500 hover:text-ink-200'"
              @click="clearAnswers"
            >
              {{ confirmingClear ? t('admission.clear_confirm') : t('admission.clear') }}
            </button>
          </div>
        </div>
      </template>

      <!-- ================= LA RÉPONSE DE LA COMMISSION ================= -->
      <!--
        Écrit en dur, et pour de bon : ce moment doit tomber à l'identique pour
        tout le monde, arriver sans attente et ne rien coûter. Rien ici ne part
        au modèle — la première génération, c'est la scène d'après.
      -->
      <template v-else>
        <div class="text-center space-y-3 mb-8">
          <p class="text-steel-400 text-[10px] uppercase tracking-[0.4em] font-display">
            {{ t('verdict.eyebrow', { number: fileNumber }) }}
          </p>
          <h1 class="neon-text animate-neon-buzz font-display uppercase text-[2.4rem] tracking-[0.1em] leading-none">
            {{ t('verdict.title') }}
          </h1>
          <div class="neon-rule w-28 mx-auto" />
        </div>

        <div class="dossier relative bg-ink-900/85 border border-neon-600/40 p-6 sm:p-7 space-y-6">
          <span class="absolute inset-[5px] border border-neon-500/12 pointer-events-none" />

          <div class="relative grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5">
            <span class="field-label pt-0.5">{{ t('verdict.field_name') }}</span>
            <span class="text-ink-100 text-[13px]">{{ displayName }}</span>
            <span class="field-label pt-0.5">{{ t('verdict.field_home') }}</span>
            <span class="text-ink-100 text-[13px]">{{ displayCity }}</span>
            <span class="field-label pt-0.5">{{ t('verdict.field_status') }}</span>
            <span class="text-neon-400 text-[13px] font-display uppercase tracking-[0.2em]">{{ t('verdict.status_value') }}</span>
            <span class="field-label pt-0.5">{{ t('verdict.field_validity') }}</span>
            <span class="text-ink-100 text-[13px]">{{ t('verdict.validity_value') }}</span>
          </div>

          <div class="relative h-px bg-neon-600/25" />

          <div class="relative space-y-4 text-ink-200/85 text-[13px] leading-relaxed">
            <p>{{ t('verdict.p1') }}</p>
            <p>{{ t('verdict.p2') }}</p>
            <p>
              <strong class="text-ink-100 font-normal">{{ t('verdict.p3_strong') }}</strong>
              {{ t('verdict.p3_rest') }}
            </p>
          </div>

          <div class="relative h-px bg-neon-600/25" />

          <div class="relative flex flex-col items-center gap-4">
            <GlowButton class="w-full" @click="enterCity">{{ t('verdict.enter') }}</GlowButton>
            <button
              class="font-display text-[10px] uppercase tracking-[0.28em] text-steel-400
                     hover:text-ink-200 transition-colors"
              @click="phase = 'form'"
            >
              {{ t('verdict.correct') }}
            </button>
          </div>
        </div>
      </template>
    </div>

    <!-- Balayage cathodique, comme partout ailleurs -->
    <div class="crt-scanlines fixed inset-0 z-20 pointer-events-none opacity-40" />
  </div>
</template>

<style scoped>
/*
  Le dossier : un rectangle net posé sur la nuit, jamais une carte arrondie.
  L'ombre porte loin pour le décoller du fond, le liseré néon reste fin.
*/
.dossier {
  box-shadow: 0 0 0 1px rgb(var(--neon-500) / 0.1), 0 24px 60px rgba(0, 0, 0, 0.8);
}

/* Les intitulés du bureau : capitales géométriques, très espacées. */
.field-label {
  display: block;
  font-family: Futura, 'Avenir Next', 'Century Gothic', 'Trebuchet MS', system-ui, sans-serif;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.28em;
  color: rgb(var(--steel-400));
}

.field-hint {
  display: block;
  font-size: 10px;
  line-height: 1.6;
  color: rgb(var(--steel-500));
}

/*
  Un champ administratif : une ligne à remplir, pas une boîte. Seul le filet du
  bas dit où écrire — et il s'allume au néon quand le curseur y est.
*/
.field {
  width: 100%;
  background: rgb(var(--ink-800) / 0.5);
  border: 0;
  border-bottom: 1px solid rgb(var(--steel-600));
  padding: 0.5rem 0.75rem;
  color: rgb(var(--ink-100));
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s ease, background-color 0.2s ease;
}

.field::placeholder {
  color: rgb(var(--steel-500));
}

.field:focus {
  border-bottom-color: rgb(var(--neon-500));
  background: rgb(var(--ink-800));
}

/*
  Deux champs respirent sur plusieurs lignes — les nuits et le rêve. Le
  navigateur donne au textarea sa propre police et sa propre taille : on les
  ramène à celles du dossier, et on interdit la poignée de redimensionnement,
  qui casserait l'alignement du formulaire.
*/
/*
  Le sélecteur de langue. Le menu natif garde sa police et sa flèche système :
  on ramène la première à celle du dossier, et on remplace la seconde par un
  chevron dessiné, pour que le champ ne détonne pas au milieu des autres.
*/
.field-select {
  font: inherit;
  font-size: 13px;
  appearance: none;
  cursor: pointer;
  padding-right: 2rem;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M0 0 L5 6 L10 0 Z' fill='%23718096'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.65rem center;
  background-size: 9px;
}

/* Le menu déroulé est rendu par le système : il lui faut un fond opaque. */
.field-select option {
  background: rgb(var(--ink-900));
  color: rgb(var(--ink-100));
}

.field-multi {
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
  resize: none;
  display: block;
}

/* Le calendrier natif est blanc sur blanc en thème sombre : on l'inverse. */
.field::-webkit-calendar-picker-indicator {
  filter: invert(1) opacity(0.45);
  cursor: pointer;
}

/* Une pastille anguleuse, cochée au néon plein. */
.chip {
  font-family: Futura, 'Avenir Next', 'Century Gothic', 'Trebuchet MS', system-ui, sans-serif;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.14em;
  padding: 0.5rem 0.75rem;
  border: 1px solid rgb(var(--steel-600));
  color: rgb(var(--ink-300));
  background: rgb(var(--ink-800) / 0.4);
  transition: border-color 0.2s ease, color 0.2s ease, background-color 0.2s ease;
  cursor: pointer;
}

.chip:hover {
  border-color: rgb(var(--neon-600) / 0.6);
  color: rgb(var(--ink-100));
}

.chip-on {
  border-color: rgb(var(--neon-500));
  background: rgb(var(--neon-500) / 0.15);
  color: rgb(var(--neon-200));
}
</style>

// Pure form ↔ settings mapping for the 外观, 终端 and 对话 pages (Figma 66).
import {
  CHAT_WEIGHTS,
  DEFAULT_SETTINGS,
  LIMITS,
  type AppearancePatch,
  type AppearanceSettings,
  type ChatAppearance,
  type ChatWeight,
  type ChatWidth,
  type ThemePreference,
  type WindowMaterial
} from '@shared/settings'
import { defineMessages, localized, pick } from '@shared/i18n'
import type { SelectOption } from './controls'
import { CJK_SAMPLE, LATIN_SAMPLE, cssFamily, groupCjkFamilies, withCurrent } from './fonts'

const M = defineMessages({
  zh: { lineHeight: '行高', systemUiFont: '跟随界面' },
  en: { lineHeight: 'line height', systemUiFont: 'App font' }
})

export const THEME_OPTIONS: ReadonlyArray<{ value: ThemePreference; label: string }> = localized(
  defineMessages<ReadonlyArray<{ value: ThemePreference; label: string }>>({
    zh: [
      { value: 'system', label: '跟随系统' },
      { value: 'dark', label: '深色' },
      { value: 'light', label: '浅色' }
    ],
    en: [
      { value: 'system', label: 'System' },
      { value: 'dark', label: 'Dark' },
      { value: 'light', label: 'Light' }
    ]
  })
)

export const BACKGROUND_OPTIONS: ReadonlyArray<{ value: AppearanceSettings['terminalBackground']['mode']; label: string }> = localized(
  defineMessages<ReadonlyArray<{ value: AppearanceSettings['terminalBackground']['mode']; label: string }>>({
    zh: [
      { value: 'theme', label: '跟随主题' },
      { value: 'custom', label: '自定义' }
    ],
    en: [
      { value: 'theme', label: 'Theme' },
      { value: 'custom', label: 'Custom' }
    ]
  })
)

/** Whether two appearance values are the same; the object-valued ones (底色, imported colors) compare by content. */
export function sameAppearanceValue(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

const FONT_SIZES = [10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 28]

/** Font size menu: the presets within LIMITS plus the current value if it is not a preset. */
export function fontSizeOptions(current: number): number[] {
  const sizes = FONT_SIZES.filter((size) => size >= LIMITS.fontSize.min && size <= LIMITS.fontSize.max)
  return sizes.includes(current) ? sizes : [...sizes, current].sort((a, b) => a - b)
}

/** "Variable" is an implementation detail of the bundled family; hide it from the UI. */
export function displayFamily(family: string): string {
  return family.replace(/\s+Variable$/i, '')
}

/** Caption under the preview: "JetBrains Mono 13 · PingFang SC · 行高 1.40". */
export function previewCaption(a: Pick<AppearanceSettings, 'latinFont' | 'cjkFont' | 'fontSize' | 'lineHeight'>): string {
  return `${displayFamily(a.latinFont)} ${a.fontSize} · ${displayFamily(a.cjkFont)} · ${pick(M).lineHeight} ${a.lineHeight.toFixed(2)}`
}

export function formatLineHeight(value: number): string {
  return value.toFixed(2)
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`
}

// --- 对话 and 窗口 · 材质 (PRD F23 v1.127, Figma 51D) ------------------------------------------------------------------

export const CHAT_WIDTH_OPTIONS: ReadonlyArray<{ value: ChatWidth; label: string }> = localized(
  defineMessages<ReadonlyArray<{ value: ChatWidth; label: string }>>({
    zh: [
      { value: 'narrow', label: '窄' },
      { value: 'medium', label: '中' },
      { value: 'wide', label: '宽' },
      { value: 'full', label: '铺满' }
    ],
    en: [
      { value: 'narrow', label: 'Narrow' },
      { value: 'medium', label: 'Medium' },
      { value: 'wide', label: 'Wide' },
      { value: 'full', label: 'Full' }
    ]
  })
)

const WEIGHT_NAMES = defineMessages<Record<ChatWeight, string>>({
  zh: { 300: '细', 400: '常规', 500: '中等' },
  en: { 300: 'Light', 400: 'Regular', 500: 'Medium' }
})
const weightOptions = (names: Record<ChatWeight, string>): ReadonlyArray<{ value: `${ChatWeight}`; label: string }> =>
  CHAT_WEIGHTS.map((weight) => ({ value: `${weight}` as const, label: names[weight] }))
export const CHAT_WEIGHT_OPTIONS: ReadonlyArray<{ value: `${ChatWeight}`; label: string }> = localized({
  zh: weightOptions(WEIGHT_NAMES.zh),
  en: weightOptions(WEIGHT_NAMES.en)
})

export const CHAT_SIZE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = Array.from(
  { length: LIMITS.chatFontSize.max - LIMITS.chatFontSize.min + 1 },
  (_, i) => String(LIMITS.chatFontSize.min + i)
).map((size) => ({ value: size, label: size }))

/** 材质 (Figma 66′): the engine behind 玻璃 (Liquid Glass or vibrancy) is the window's business, not a choice. */
export const MATERIAL_OPTIONS: ReadonlyArray<{ value: WindowMaterial; label: string }> = localized(
  defineMessages<ReadonlyArray<{ value: WindowMaterial; label: string }>>({
    zh: [
      { value: 'glass', label: '玻璃' },
      { value: 'solid-glass', label: '实心玻璃' },
      { value: 'solid', label: '实色' }
    ],
    en: [
      { value: 'glass', label: 'Glass' },
      { value: 'solid-glass', label: 'Solid glass' },
      { value: 'solid', label: 'Solid' }
    ]
  })
)

/** 对话's English font menu: the system UI font first ('' in settings), then the proportional families. */
const systemUiFont = (): string => pick(M).systemUiFont

export function chatPreviewCaption(c: Pick<ChatAppearance, 'latinFont' | 'cjkFont' | 'fontSize' | 'fontWeight'>): string {
  return `${c.latinFont ? displayFamily(c.latinFont) : systemUiFont()} ${c.fontSize} · ${displayFamily(c.cjkFont)} · ${pick(WEIGHT_NAMES)[c.fontWeight]}`
}

// --- Three pages (Figma 66) ------------------------------------------------------------------------------------------

/**
 * What each page's 恢复默认 resets: that page's own settings. The theme, 全屏背景 and the 背景图片 itself are not reset
 * anywhere (each is the user's pick, one click away on 外观); its 模糊 is.
 */
export const RESET_KEYS = {
  appearance: ['windowMaterial', 'backgroundBlur'],
  terminal: ['latinFont', 'cjkFont', 'fontSize', 'lineHeight', 'ligatures', 'terminalBackground', 'terminalColors', 'terminalOpacity', 'screenReader'],
  chat: ['chat']
} as const satisfies Record<string, ReadonlyArray<keyof AppearanceSettings>>

export type AppearancePage = keyof typeof RESET_KEYS

export function pageDefaults(page: AppearancePage): AppearancePatch {
  return Object.fromEntries(RESET_KEYS[page].map((key) => [key, DEFAULT_SETTINGS.appearance[key]]))
}

export function isPageDefault(a: AppearanceSettings, page: AppearancePage): boolean {
  return RESET_KEYS[page].every((key) => sameAppearanceValue(a[key], DEFAULT_SETTINGS.appearance[key]))
}

/** 终端's English font menu: each family drawn in itself. */
export function latinOption(family: string): SelectOption {
  const face = { fontFamily: cssFamily(family, 'monospace') }
  return { value: family, label: displayFamily(family), labelStyle: face, sample: LATIN_SAMPLE, sampleStyle: face }
}

/** 对话's English font menu: '' is the system UI font. */
export function uiOption(family: string): SelectOption {
  if (family === '') return { value: '', label: systemUiFont(), labelStyle: { fontFamily: 'var(--font-ui)' }, sample: LATIN_SAMPLE, sampleStyle: { fontFamily: 'var(--font-ui)' } }
  const face = { fontFamily: cssFamily(family, 'sans-serif') }
  return { value: family, label: displayFamily(family), labelStyle: face, sample: LATIN_SAMPLE, sampleStyle: face }
}

/** Both pages' Chinese font menu, grouped by language, with the current family kept even if it is not installed. */
export function cjkOptions(installed: readonly string[], current: string): SelectOption[] {
  return groupCjkFamilies(withCurrent(installed, current)).map(({ family, group }) => {
    // PingFang SC stays in the stack so a missing glyph never falls back to a Japanese face.
    const face = { fontFamily: cssFamily(family, '"PingFang SC", sans-serif') }
    return { value: family, label: displayFamily(family), labelStyle: face, sample: CJK_SAMPLE, sampleStyle: face, group }
  })
}

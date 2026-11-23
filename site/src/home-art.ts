/* One of the page's images, by name. A name with an en-/zh- file takes the language's own (the product windows and
   the appearance looks); an unprefixed one (the cradle art) serves both languages. */
import type { ImageMetadata } from 'astro'
import type { Lang } from './i18n'

const art = import.meta.glob<{ default: ImageMetadata }>('./assets/home/*.{webp,png,svg}', { eager: true })

export const pic = (lang: Lang, name: string): ImageMetadata => {
  const own = art[`./assets/home/${lang === 'en' ? 'en' : 'zh'}-${name}`]
  const hit = own ?? art[`./assets/home/${name}`]
  if (!hit) throw new Error(`missing image ${name} for ${lang}`)
  return hit.default
}

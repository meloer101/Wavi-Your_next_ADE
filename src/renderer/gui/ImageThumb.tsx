// A picture in the chat as a thumbnail (PRD F23 v1.243, Figma 112F): 120 high, as wide as its shape makes it, drawn
// under a tool row, under an agent's paragraph or where its Markdown wrote it. Inside a session's feed it is a button
// that opens the preview at it (ImagePreview); a file that cannot be read is its name (Figma 71D) and opens nothing.
import { useState } from 'react'
import { defineMessages } from '@shared/i18n'
import { useMessages } from '../ui/i18n'
import { GALLERY_KEY_ATTRIBUTE, useOpenImage } from './ImagePreview'
import { imageKey, thumbnailUrl } from './model'
import styles from './Chat.module.css'

const M = defineMessages({
  zh: { open: (name: string) => `预览图片 ${name}` },
  en: { open: (name: string) => `Preview image ${name}` }
})

export const fileNameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/** The name a picture that is gone or cannot be drawn shows (the sent pictures' 71D). */
export function PictureName({ path }: { path: string }) {
  return (
    <span className={styles.attachment} data-fixed="true" title={path}>
      <span className={styles.attachmentName}>{fileNameOf(path)}</span>
    </span>
  )
}

/** `galleryKey`: where the picture is in the session's list (model.ts `galleryOf`); without it, or outside a feed, it only shows. */
export function ImageThumb({ path, galleryKey }: { path: string; galleryKey?: string }) {
  const m = useMessages(M)
  const open = useOpenImage()
  const [state, setState] = useState<'loading' | 'ready' | 'broken'>('loading')
  const url = thumbnailUrl(path)
  if (!url || state === 'broken') return <PictureName path={path} />
  const name = fileNameOf(path)
  const picture = <img src={url} alt={name} draggable={false} onLoad={() => setState('ready')} onError={() => setState('broken')} />
  if (!open || !galleryKey) {
    return (
      <span className={styles.chatImage} data-state={state} title={path}>
        {picture}
      </span>
    )
  }
  return (
    <button type="button" className={styles.chatImage} data-state={state} title={path} aria-label={m.open(name)} {...{ [GALLERY_KEY_ATTRIBUTE]: galleryKey }} onClick={() => open(galleryKey)}>
      {picture}
    </button>
  )
}

/** Pictures in a row under what they belong to, 8 apart (Figma 112F). `indent`: lined up with a tool row's name. */
export function ImageRow({ paths, itemId, indent = false }: { paths: readonly string[]; itemId: string; indent?: boolean }) {
  if (paths.length === 0) return null
  return (
    <div className={styles.imageRow} data-indent={indent || undefined} data-testid="gui-chat-images">
      {paths.map((path, i) => (
        <ImageThumb key={`${i}:${path}`} path={path} galleryKey={imageKey(itemId, i)} />
      ))}
    </div>
  )
}

// The agent's words in a GUI session (PRD F23, Figma 49″C): Markdown with GFM, the same element styles as the files
// view's preview (panels/files/MarkdownView), at the chat's reading size. Raw HTML is not rendered (the sanitize
// schema drops what would run); a link opens in the built-in browser, ⌘-click in the system one. A code block has a
// copy button in its corner on hover (Figma 54B).
import { Fragment, memo, useMemo } from 'react'
import Markdown, { type Components } from 'react-markdown'
import rehypeSanitize from 'rehype-sanitize'
import remarkGfm from 'remark-gfm'
import { defineMessages } from '@shared/i18n'
import type { SessionId } from '@shared/types'
import { CopyButton } from './CopyButton'
import { codeRef, hrefRef, rehypeFileRefs, spanRef } from './file-refs'
import { FileRef, RefSession } from './FileRef'
import { highlightLines } from './highlight'
import { rehypeShortCells } from './table-cells'
import { Tokens } from './Highlighted'
import { WebLink } from './WebLink'
import { useMessages } from '../ui/i18n'
import styles from './Chat.module.css'

const M = defineMessages({
  zh: { copyCode: '复制代码' },
  en: { copyCode: 'Copy code' }
})

const REMARK = [remarkGfm]
// Paths in prose become file links after sanitizing (the plugin's spans are Wavi's, not the text's); short table cells
// are marked to stay on one line (table-cells.ts).
const REHYPE = [rehypeSanitize, rehypeFileRefs, rehypeShortCells]

/** A Markdown (hast) node's text: a code block's source. */
function hastText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as { type?: string; value?: string; children?: unknown[] }
  return n.type === 'text' ? (n.value ?? '') : (n.children ?? []).map(hastText).join('')
}

/** A fenced block's language: its code element's `language-*` class (sanitize keeps only that one). */
function languageOf(pre: unknown): string | undefined {
  const code = (pre as { children?: { tagName?: string; properties?: { className?: unknown } }[] } | undefined)?.children?.find((c) => c.tagName === 'code')
  const names = code?.properties?.className
  const name = Array.isArray(names) ? names.find((n): n is string => typeof n === 'string' && n.startsWith('language-')) : undefined
  return name?.slice('language-'.length)
}

/** Figma 90C: a fenced block colored by its language; as written when none is given or known. */
function CodeBlock({ node }: { node: unknown }) {
  const language = languageOf(node)
  const code = hastText(node).replace(/\n$/, '')
  const lines = useMemo(() => (language ? highlightLines(code, language) : null), [code, language])
  // Not through the `code` component: a block is never a file link.
  if (!lines)
    return (
      <pre>
        <code>{code}</code>
      </pre>
    )
  return (
    <pre>
      <code>
        {lines.map((tokens, i) => (
          <Fragment key={i}>
            {i > 0 && '\n'}
            <Tokens tokens={tokens} />
          </Fragment>
        ))}
      </code>
    </pre>
  )
}

export const ChatMarkdown = memo(function ChatMarkdown({ sessionId, text, className }: { sessionId: SessionId; text: string; className?: string }) {
  const m = useMessages(M)
  // One set per session and language: new component types on every render (each streamed delta) would remount the
  // tree, re-highlighting code blocks and dropping file links' state and open cards.
  const components = useMemo<Components>(() => ({
    a: ({ href, children }) => {
      // Figma 90A: a link to a file of the session (Codex and Claude in an IDE write them so).
      const file = href ? hrefRef(href) : null
      if (file) return <FileRef target={file}>{children}</FileRef>
      // Figma 90B: a web link, its site and title on rest.
      if (href && /^https?:\/\//i.test(href)) return <WebLink sessionId={sessionId} href={href}>{children}</WebLink>
      return <a title={href}>{children}</a>
    },
    // Inline code (blocks draw their own): a path and nothing else is a file link.
    code: ({ node, className: codeClass, children }) => {
      const file = codeClass ? null : codeRef(hastText(node))
      const code = <code className={codeClass}>{children}</code>
      return file ? <FileRef target={file}>{code}</FileRef> : code
    },
    span: ({ node: _node, children, ...props }) => {
      const file = spanRef(props)
      return file ? <FileRef target={file}>{children}</FileRef> : <span {...props}>{children}</span>
    },
    pre: ({ node }) => (
      <div className={styles.codeWrap}>
        <CodeBlock node={node} />
        <CopyButton text={() => hastText(node).replace(/\n$/, '')} label={m.copyCode} className={styles.cornerCopy} />
      </div>
    )
  }), [sessionId, m.copyCode])
  return (
    <RefSession.Provider value={sessionId}>
      <div className={[styles.markdown, className].filter(Boolean).join(' ')}>
        <Markdown remarkPlugins={REMARK} rehypePlugins={REHYPE} components={components}>
          {text}
        </Markdown>
      </div>
    </RefSession.Provider>
  )
})

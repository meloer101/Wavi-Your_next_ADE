// What a GUI session's agent waits on (PRD F23, Figma 49″D–F): a card above the composer, its own block (bg/section),
// magenta only on the status glyph. Permission: 拒绝 ⎋ · 总是允许 · 允许 ↵, a change to a file drawn between the title and
// the buttons (Figma 59I). Question: a tray on the composer (Figma 113D′, PRD v1.245):
// numbered options with their descriptions + an inline 其他 input, 跳过 ⎋ · 下一题 / 提交 ↵. Plan: 继续规划 · 批准，编辑时问我 · 批准并自动接受编辑 ↵. Each card answers keys through `bindKeys`
// (the chat routes them, see ChatPane).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { GuiAnswer, GuiPrompt } from '@shared/gui-chat'
import { defineMessages } from '@shared/i18n'
import type { SessionId } from '@shared/types'
import { Check, X } from '../ui/icons'
import { StatusGlyph } from '../ui/StatusGlyph'
import { ChatMarkdown } from './ChatMarkdown'
import { DiffBlock } from './DiffBlock'
import { permissionBody, permissionButtons, permissionPrimary, permissionTitle, pickChoice, planParts, questionAnswers, stepIndex, type CardKey, type QuestionChoice } from './model'
import { useMessages } from '../ui/i18n'
import styles from './Chat.module.css'

const M = defineMessages({
  zh: {
    confirm: '等你确认',
    deny: '拒绝',
    alwaysAllow: '总是允许',
    allow: '允许',
    answer: '等你回答',
    otherOption: '其他…',
    other: '其他',
    skip: '跳过',
    next: '下一题',
    submit: '提交',
    confirmPlan: '等你确认计划',
    keepPlanning: '继续规划',
    approveAsk: '批准，编辑时问我',
    approveAuto: '批准并自动接受编辑'
  },
  en: {
    confirm: 'Confirm',
    deny: 'Deny',
    alwaysAllow: 'Always allow',
    allow: 'Allow',
    answer: 'Answer',
    otherOption: 'Other…',
    other: 'Other',
    skip: 'Skip',
    next: 'Next',
    submit: 'Submit',
    confirmPlan: 'Confirm plan',
    keepPlanning: 'Keep planning',
    approveAsk: 'Approve, ask before edits',
    approveAuto: 'Approve and auto-accept edits'
  }
})

/** A card's key handler; true when the key did something. */
export type CardKeys = (key: NonNullable<CardKey>) => boolean

interface CardProps<P> {
  sessionId: SessionId
  prompt: P
  agentLabel: string
  answer(answer: GuiAnswer): void
  /** An answer is on its way: the buttons wait. */
  pending: boolean
  bindKeys(keys: CardKeys | null): void
}

export function PromptCard(props: Omit<CardProps<GuiPrompt>, 'prompt'> & { prompt: GuiPrompt }) {
  const { prompt } = props
  switch (prompt.kind) {
    case 'permission':
      return <PermissionCard {...props} prompt={prompt} />
    case 'question':
      return <QuestionCard {...props} prompt={prompt} />
    case 'plan':
      return <PlanCard {...props} prompt={prompt} />
  }
}

function Card({ label, title, children, testId }: { label: string; title: ReactNode; children: ReactNode; testId: string }) {
  return (
    <section className={styles.card} aria-label={label} data-testid={testId}>
      <header className={styles.cardHeader}>
        <StatusGlyph status="needs_you" />
        <h3 className={styles.cardTitle}>{title}</h3>
      </header>
      {children}
    </section>
  )
}

function Button({ label, shortcut, primary = false, disabled, onClick, title }: { label: string; shortcut?: string; primary?: boolean; disabled?: boolean; onClick(): void; title?: string }) {
  return (
    <button type="button" className={styles.button} data-primary={primary} disabled={disabled} onClick={onClick} title={title}>
      <span>{label}</span>
      {shortcut && <span data-shortcut-hint className={styles.buttonShortcut}>{shortcut}</span>}
    </button>
  )
}

function PermissionCard({ prompt, agentLabel, answer, pending, bindKeys }: CardProps<Extract<GuiPrompt, { kind: 'permission' }>>) {
  const m = useMessages(M)
  const buttons = permissionButtons(prompt.options)
  const body = permissionBody(prompt)
  const primary = permissionPrimary(buttons)
  const choose = (optionId: string | undefined): boolean => {
    if (!optionId || pending) return false
    answer({ kind: 'permission', id: prompt.id, optionId })
    return true
  }
  // Rebound after every render, so the keys see this render's state.
  useEffect(() => {
    bindKeys((key) => (key.type === 'primary' ? choose(primary?.id) : key.type === 'dismiss' ? choose(buttons.reject?.id) : false))
    return () => bindKeys(null)
  })
  return (
    <Card label={m.confirm} title={permissionTitle(agentLabel, prompt.tool)} testId="gui-permission">
      {body.detail && <pre className={styles.cardDetail}>{body.detail}</pre>}
      {/* Figma 59I: a change shows each file, its path on the block's header; several scroll together. */}
      {body.files.length > 0 && (
        <div className={styles.cardDiffs} data-several={body.files.length > 1}>
          {body.files.map((file, i) => (
            <DiffBlock key={i} diff={file} header className={styles.cardDiff} />
          ))}
        </div>
      )}
      <div className={styles.cardActions}>
        {buttons.reject && <Button label={m.deny} shortcut="⎋" disabled={pending} onClick={() => choose(buttons.reject?.id)} />}
        {buttons.always && buttons.always !== primary && <Button label={m.alwaysAllow} title={buttons.always.label} disabled={pending} onClick={() => choose(buttons.always?.id)} />}
        {primary && <Button label={primary === buttons.always ? m.alwaysAllow : m.allow} shortcut="↵" primary disabled={pending} onClick={() => choose(primary.id)} />}
      </div>
    </Card>
  )
}

function QuestionCard({ prompt, answer, pending, bindKeys }: CardProps<Extract<GuiPrompt, { kind: 'question' }>>) {
  const m = useMessages(M)
  const [step, setStep] = useState(0)
  const [choices, setChoices] = useState<(QuestionChoice | undefined)[]>([])
  const [focused, setFocused] = useState(0)
  const otherRef = useRef<HTMLInputElement>(null)
  const question = prompt.questions[step]
  const choice = choices[step]
  const count = (question?.options.length ?? 0) + 1

  const choose = (index: number): void => {
    if (!question) return
    const next = pickChoice(question, choice, index)
    setChoices((all) => Object.assign([...all], { [step]: next }))
    setFocused(index)
    if (next.kind === 'other') requestAnimationFrame(() => otherRef.current?.focus())
  }
  const submit = (): boolean => {
    if (pending) return false
    if (step < prompt.questions.length - 1) {
      if (!question || !choice) return false
      setStep(step + 1)
      setFocused(0)
      return true
    }
    const answers = questionAnswers(prompt.questions, choices)
    if (!answers) return false
    answer({ kind: 'question', id: prompt.id, answers })
    return true
  }
  const skip = (): boolean => {
    if (pending) return false
    answer({ kind: 'question', id: prompt.id, answers: {} })
    return true
  }
  /** ↵ / 提交: with nothing picked yet, the highlighted option is the answer (Figma 49″F: option 1 highlighted). */
  const primary = (): boolean => {
    if (pending || !question) return false
    if (choice !== undefined || question.multiSelect || focused >= count) return submit()
    const next = pickChoice(question, undefined, focused)
    if (next.kind === 'other') {
      choose(focused)
      return true
    }
    const all = Object.assign([...choices], { [step]: next })
    setChoices(all)
    if (step < prompt.questions.length - 1) {
      setStep(step + 1)
      setFocused(0)
      return true
    }
    const answers = questionAnswers(prompt.questions, all)
    if (!answers) return false
    answer({ kind: 'question', id: prompt.id, answers })
    return true
  }
  const onKey: CardKeys = (key) => {
    switch (key.type) {
      case 'primary':
        return primary()
      case 'dismiss':
        return skip()
      case 'pick':
        if (key.index >= count) return false
        choose(key.index)
        return true
      case 'move':
        setFocused((at) => stepIndex(at, key.delta, count))
        return true
    }
  }
  useEffect(() => {
    bindKeys(onKey)
    return () => bindKeys(null)
  })
  if (!question) return null

  const picked = (index: number): boolean => (index === question.options.length ? choice?.kind === 'other' : choice?.kind === 'option' && choice.indexes.includes(index))
  const total = prompt.questions.length
  const last = question.options.length
  const mark = (index: number): ReactNode => (
    <span className={styles.optionMark} data-multi={question.multiSelect} data-checked={picked(index)} aria-hidden>
      {question.multiSelect && picked(index) && <Check size={16} strokeWidth={1.75} />}
    </span>
  )
  const role = question.multiSelect ? 'checkbox' : 'radio'
  return (
    <section className={styles.tray} aria-label={m.answer} data-testid="gui-question">
      <header className={styles.trayHeader}>
        <StatusGlyph status="needs_you" />
        <span className={styles.trayTitle}>{question.header ?? m.answer}</span>
        <span className={styles.traySpacer} />
        {total > 1 && (
          <span className={styles.trayCount}>
            {step + 1}/{total}
          </span>
        )}
        <button type="button" className={styles.trayButton} aria-label={m.skip} disabled={pending} onClick={skip}>
          <X size={16} strokeWidth={1.75} />
        </button>
      </header>
      <h3 className={styles.trayQuestion}>{question.question}</h3>
      <div className={styles.options} role={question.multiSelect ? 'group' : 'radiogroup'} aria-label={question.header ?? question.question}>
        {question.options.map((option, index) => (
          <button key={index} type="button" role={role} aria-checked={picked(index)} className={styles.option} data-focused={focused === index} onClick={() => choose(index)}>
            {mark(index)}
            <span className={styles.optionText}>
              <span className={styles.optionLabel}>{option.label}</span>
              {option.description && <span className={styles.optionDescription}>{option.description}</span>}
            </span>
            <span className={styles.optionKey}>{index + 1}</span>
          </button>
        ))}
        {/* 其他 is the last row: its input is always there, and typing in it picks it. */}
        <div className={styles.option} data-other data-focused={focused === last} onClick={() => choose(last)}>
          <button type="button" role={role} aria-checked={picked(last)} aria-label={m.otherOption} className={styles.optionMarkButton}>
            {mark(last)}
          </button>
          <input
            ref={otherRef}
            className={styles.otherInput}
            aria-label={m.other}
            placeholder={m.other}
            value={choice?.kind === 'other' ? choice.text : ''}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const text = e.currentTarget.value
              setChoices((all) => Object.assign([...all], { [step]: { kind: 'other', text } }))
              setFocused(last)
            }}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return
              if (e.key === 'Enter') {
                e.preventDefault()
                e.stopPropagation()
                submit()
              } else if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                // The pane ignores keys typed in an input, so a second ⎋ skips here.
                if (choice?.kind === 'other') setChoices((all) => Object.assign([...all], { [step]: undefined }))
                else skip()
              }
            }}
          />
          <span className={styles.optionKey}>{last + 1}</span>
        </div>
      </div>
      <div className={styles.trayActions}>
        <Button label={m.skip} shortcut="⎋" disabled={pending} onClick={skip} />
        <Button label={step < total - 1 ? m.next : m.submit} shortcut="↵" primary disabled={pending} onClick={primary} />
      </div>
    </section>
  )
}

function PlanCard({ sessionId, prompt, answer, pending, bindKeys }: CardProps<Extract<GuiPrompt, { kind: 'plan' }>>) {
  const m = useMessages(M)
  const { title, body } = planParts(prompt.plan)
  const decide = (decision: 'keep-planning' | 'approve-ask' | 'approve-auto'): boolean => {
    if (pending) return false
    answer({ kind: 'plan', id: prompt.id, decision })
    return true
  }
  useEffect(() => {
    bindKeys((key) => (key.type === 'primary' ? decide('approve-auto') : false))
    return () => bindKeys(null)
  })
  return (
    <Card label={m.confirmPlan} title={title} testId="gui-plan">
      {body && <ChatMarkdown sessionId={sessionId} text={body} className={styles.planBody} />}
      <div className={`${styles.cardActions} ${styles.planActions}`}>
        <Button label={m.keepPlanning} disabled={pending} onClick={() => decide('keep-planning')} />
        <Button label={m.approveAsk} disabled={pending} onClick={() => decide('approve-ask')} />
        <Button label={m.approveAuto} shortcut="↵" primary disabled={pending} onClick={() => decide('approve-auto')} />
      </div>
    </Card>
  )
}

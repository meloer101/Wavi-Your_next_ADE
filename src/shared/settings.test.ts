import { describe, expect, it } from 'vitest'
import { applySettingsPatch, DEFAULT_SETTINGS, isOpaqueMaterial, sanitizeSettings } from './settings'

describe('sanitizeSettings', () => {
  it('returns defaults for garbage', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings('nope')).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings({ appearance: 42 })).toEqual(DEFAULT_SETTINGS)
  })

  it('clamps numbers and rejects bad values field by field', () => {
    const s = sanitizeSettings({
      appearance: { fontSize: 100, lineHeight: 0.2, terminalOpacity: 0.1, theme: 'neon', latinFont: '  Menlo ', ligatures: 'yes' }
    })
    expect(s.appearance.fontSize).toBe(28)
    expect(s.appearance.lineHeight).toBe(1)
    expect(s.appearance.terminalOpacity).toBe(0.2)
    expect(s.appearance.theme).toBe('system')
    expect(s.appearance.latinFont).toBe('Menlo')
    expect(s.appearance.ligatures).toBe(false)
  })

  it('drops the old gradient / image background: the terminal follows the theme (v1.2)', () => {
    const s = sanitizeSettings({ appearance: { background: { kind: 'gradient', from: '#1f1f1f', to: '#050505', angle: 160 }, fontSize: 14 } })
    expect(s.appearance).not.toHaveProperty('background')
    expect(s.appearance.fontSize).toBe(14)
  })
})

describe('全屏背景 (PRD v1.97)', () => {
  it('defaults to auto and keeps only the known palettes', () => {
    expect(DEFAULT_SETTINGS.appearance.fullscreenBackdrop).toBe('auto')
    expect(sanitizeSettings({ appearance: { fullscreenBackdrop: 'ember' } }).appearance.fullscreenBackdrop).toBe('ember')
    expect(sanitizeSettings({ appearance: { fullscreenBackdrop: 'neon' } }).appearance.fullscreenBackdrop).toBe('auto')
    expect(sanitizeSettings({ appearance: { fullscreenBackdrop: 3 } }).appearance.fullscreenBackdrop).toBe('auto')
  })
})

describe('背景图片 (PRD v1.189)', () => {
  const name = `${'0f'.repeat(32)}.jpg`

  it('has no picture and no blur by default', () => {
    expect(DEFAULT_SETTINGS.appearance.backgroundImage).toBe('')
    expect(DEFAULT_SETTINGS.appearance.backgroundBlur).toBe(0)
  })

  it('keeps a stored picture’s name and drops anything else, so a path never reaches the protocol', () => {
    expect(sanitizeSettings({ appearance: { backgroundImage: name } }).appearance.backgroundImage).toBe(name)
    expect(sanitizeSettings({ appearance: { backgroundImage: '/Users/me/wall.jpg' } }).appearance.backgroundImage).toBe('')
    expect(sanitizeSettings({ appearance: { backgroundImage: '../settings.json' } }).appearance.backgroundImage).toBe('')
  })

  it('clamps the blur to 0–100 % in whole percent', () => {
    expect(sanitizeSettings({ appearance: { backgroundBlur: 0.404 } }).appearance.backgroundBlur).toBe(0.4)
    expect(sanitizeSettings({ appearance: { backgroundBlur: 2 } }).appearance.backgroundBlur).toBe(1)
    expect(sanitizeSettings({ appearance: { backgroundBlur: -1 } }).appearance.backgroundBlur).toBe(0)
    expect(sanitizeSettings({ appearance: { backgroundBlur: 'x' } }).appearance.backgroundBlur).toBe(0)
  })

  it('移除 is a patch to the empty name', () => {
    const withPicture = sanitizeSettings({ appearance: { backgroundImage: name, backgroundBlur: 0.4 } })
    const removed = applySettingsPatch(withPicture, { appearance: { backgroundImage: '' } })
    expect(removed.appearance.backgroundImage).toBe('')
    expect(removed.appearance.backgroundBlur).toBe(0.4)
  })
})

describe('applySettingsPatch', () => {
  it('merges appearance fields and keeps the rest', () => {
    const next = applySettingsPatch(DEFAULT_SETTINGS, { appearance: { cjkFont: 'Noto Sans SC', fontSize: 14 } })
    expect(next.appearance.cjkFont).toBe('Noto Sans SC')
    expect(next.appearance.fontSize).toBe(14)
    expect(next.appearance.latinFont).toBe(DEFAULT_SETTINGS.appearance.latinFont)
  })

  it('keeps the TR_PORT base whole and in range (PRD F4)', () => {
    expect(DEFAULT_SETTINGS.ports.base).toBe(41000)
    expect(applySettingsPatch(DEFAULT_SETTINGS, { ports: { base: 50000 } }).ports.base).toBe(50000)
    expect(applySettingsPatch(DEFAULT_SETTINGS, { ports: { base: 80 } }).ports.base).toBe(1024)
    expect(applySettingsPatch(DEFAULT_SETTINGS, { ports: { base: 'x' } }).ports.base).toBe(41000)
    expect(applySettingsPatch(DEFAULT_SETTINGS, { appearance: { fontSize: 14 } }).ports).toEqual(DEFAULT_SETTINGS.ports)
  })

  it('ignores junk patches', () => {
    expect(applySettingsPatch(DEFAULT_SETTINGS, 'x')).toEqual(DEFAULT_SETTINGS)
    expect(applySettingsPatch(DEFAULT_SETTINGS, { appearance: { fontSize: 'big' } })).toEqual(DEFAULT_SETTINGS)
  })

  it('keeps code review off unless a real switch is set (PRD F13)', () => {
    expect(DEFAULT_SETTINGS.review).toEqual({
      beforePush: false,
      afterTurnWithCommits: false,
      mode: 'builtin',
      rules: 'default',
      customRules: '',
      reviewer: 'same',
      model: '',
      codexModel: ''
    })
    const next = applySettingsPatch(DEFAULT_SETTINGS, { review: { afterTurnWithCommits: true, mode: 'agent-command', model: 'haiku', customRules: '只看空指针' } })
    expect(next.review.afterTurnWithCommits).toBe(true)
    expect(next.review.beforePush).toBe(false)
    expect(next.review.mode).toBe('agent-command')
    expect(next.review.model).toBe('haiku')
    expect(next.review.rules).toBe('default')
    expect(applySettingsPatch(DEFAULT_SETTINGS, { review: { model: 'not a model', mode: 'nope' } }).review.model).toBe('')
    expect(applySettingsPatch(DEFAULT_SETTINGS, { review: { mode: 'nope' } }).review.mode).toBe('builtin')
    expect(applySettingsPatch(DEFAULT_SETTINGS, { appearance: { fontSize: 14 } }).review).toEqual(DEFAULT_SETTINGS.review)
  })

  it('drops 合并前审阅: a stored one on turns 推送前审阅 on, and it is gone once written back', () => {
    const migrated = sanitizeSettings({ review: { beforeMerge: true, beforePush: false } }).review
    expect(migrated.beforePush).toBe(true)
    expect('beforeMerge' in migrated).toBe(false)
    expect(sanitizeSettings({ review: { beforeMerge: false, beforePush: false } }).review.beforePush).toBe(false)
    expect(sanitizeSettings({ review: { beforeMerge: false, beforePush: true } }).review.beforePush).toBe(true)
    // Turned off afterwards: stays off (the old key is not written back).
    expect(applySettingsPatch(sanitizeSettings({ review: { beforeMerge: true } }), { review: { beforePush: false } }).review.beforePush).toBe(false)
  })

  it('picks the other CLI as reviewer only when asked, and moves an old OpenAI model to Codex (PRD F13 v1.63)', () => {
    expect(applySettingsPatch(DEFAULT_SETTINGS, { review: { reviewer: 'other' } }).review.reviewer).toBe('other')
    expect(applySettingsPatch(DEFAULT_SETTINGS, { review: { reviewer: 'nope' as 'other' } }).review.reviewer).toBe('same')
    const legacy = sanitizeSettings({ review: { model: 'gpt-5.5-codex' } }).review
    expect([legacy.model, legacy.codexModel]).toEqual(['', 'gpt-5.5-codex'])
    const claude = sanitizeSettings({ review: { model: 'opus' } }).review
    expect([claude.model, claude.codexModel]).toEqual(['opus', ''])
    expect(sanitizeSettings({ review: { model: 'gpt-5', codexModel: '' } }).review.model).toBe('gpt-5')
  })
})

describe('archive settings (F15)', () => {
  it('starts with 合并后自动归档 off and takes a boolean patch only', () => {
    expect(DEFAULT_SETTINGS.archive.afterMerge).toBe(false)
    expect(applySettingsPatch(DEFAULT_SETTINGS, { archive: { afterMerge: true } }).archive.afterMerge).toBe(true)
    expect(applySettingsPatch(DEFAULT_SETTINGS, { archive: { afterMerge: 'yes' } }).archive.afterMerge).toBe(false)
    expect(sanitizeSettings({}).archive).toEqual({ afterMerge: false })
  })
})

describe('设置 · Worktree · 端口 (PRD F17 v1.207: 自动打开 is gone)', () => {
  it('drops the retired autoOpen switch a saved file still has', () => {
    expect(sanitizeSettings({ ports: { base: 42000, autoOpen: true } }).ports).toEqual({ base: 42000 })
  })
})

describe('alert settings (F11 · 额度提醒)', () => {
  it('turns usage alerts on by default and keeps only booleans', () => {
    expect(DEFAULT_SETTINGS.alerts.usage).toBe(true)
    expect(applySettingsPatch(DEFAULT_SETTINGS, { alerts: { usage: false } }).alerts.usage).toBe(false)
    expect(applySettingsPatch(DEFAULT_SETTINGS, { alerts: { usage: 'no' } }).alerts.usage).toBe(true)
    expect(sanitizeSettings({}).alerts).toEqual({ usage: true })
  })
})

describe('设置 · 自动化 · PR (PRD F16 v1.63)', () => {
  it('starts with the evidence block on and both automations off', () => {
    expect(DEFAULT_SETTINGS.pr).toEqual({
      evidence: true,
      autoFix: false,
      mergeWhenGreen: false,
      maxAutoFixes: 3,
      bots: [],
      writer: 'session',
      writerClaudeModel: 'haiku',
      writerCodexModel: '',
      writeOnOpen: false
    })
  })

  it('AI 写 (v1.68): the session\'s agent on Haiku by default, never writing on open unless asked, and only model names', () => {
    const pr = applySettingsPatch(DEFAULT_SETTINGS, { pr: { writer: 'codex', writerCodexModel: 'gpt-5-mini', writerClaudeModel: 'rm -rf /', writeOnOpen: true } }).pr
    expect(pr).toMatchObject({ writer: 'codex', writerCodexModel: 'gpt-5-mini', writerClaudeModel: 'haiku', writeOnOpen: true })
    expect(sanitizeSettings({ pr: { writer: 'gemini' } }).pr.writer).toBe('session')
  })

  it('keeps the cap within 1–5 and only valid bot logins', () => {
    const pr = applySettingsPatch(DEFAULT_SETTINGS, { pr: { maxAutoFixes: 9, bots: ['coderabbitai[bot]', 'coderabbitai[bot]', 'not a login', 'copilot'] } }).pr
    expect(pr.maxAutoFixes).toBe(5)
    expect(pr.bots).toEqual(['coderabbitai[bot]', 'copilot'])
    expect(sanitizeSettings({ pr: { autoFix: true } }).pr).toMatchObject({ autoFix: true, evidence: true })
  })
})

describe('设置 · 手机 (PRD F22)', () => {
  it('starts off on port 7429 with push on, and keeps the port a whole unprivileged number', () => {
    expect(DEFAULT_SETTINGS.remote).toEqual({ enabled: false, port: 7429, push: true })
    expect(applySettingsPatch(DEFAULT_SETTINGS, { remote: { enabled: true } }).remote).toEqual({ enabled: true, port: 7429, push: true })
    expect(applySettingsPatch(DEFAULT_SETTINGS, { remote: { port: 80 } }).remote.port).toBe(7429)
    expect(applySettingsPatch(DEFAULT_SETTINGS, { remote: { port: 8123.5 } }).remote.port).toBe(7429)
    expect(applySettingsPatch(DEFAULT_SETTINGS, { remote: { port: 9000, enabled: 'yes' } }).remote).toEqual({ enabled: false, port: 9000, push: true })
  })
})

describe('设置 · 外观 · 对话 and the window material (PRD v1.127, Figma 51)', () => {
  it('starts with narrow column, system UI font, 14 px, no avatar; glass; both cards at 85% (PRD v1.179)', () => {
    expect(DEFAULT_SETTINGS.appearance.chat).toEqual({ width: 'narrow', latinFont: '', cjkFont: 'PingFang SC', fontWeight: 400, fontSize: 14, opacity: 0.85, avatar: '' })
    expect(DEFAULT_SETTINGS.appearance.terminalOpacity).toBe(0.85)
    expect(DEFAULT_SETTINGS.appearance.windowMaterial).toBe('glass')
  })

  it('clamps and rejects field by field', () => {
    const { chat, windowMaterial } = sanitizeSettings({
      appearance: { chat: { width: 'huge', latinFont: '  Inter ', fontWeight: 900, fontSize: 40, opacity: 0.1, avatar: 'javascript:alert(1)' }, windowMaterial: 'stone' }
    }).appearance
    expect(chat).toEqual({ width: 'narrow', latinFont: 'Inter', cjkFont: 'PingFang SC', fontWeight: 400, fontSize: 18, opacity: 0.2, avatar: '' })
    expect(windowMaterial).toBe('glass')
  })

  it('takes a picture only as an image data URL under the cap', () => {
    const webp = 'data:image/webp;base64,UklGRg=='
    expect(sanitizeSettings({ appearance: { chat: { avatar: webp } } }).appearance.chat.avatar).toBe(webp)
    expect(sanitizeSettings({ appearance: { chat: { avatar: 'data:image/svg+xml;base64,PHN2Zz4=' } } }).appearance.chat.avatar).toBe('')
    expect(sanitizeSettings({ appearance: { chat: { avatar: `data:image/png;base64,${'A'.repeat(400_001)}` } } }).appearance.chat.avatar).toBe('')
  })

  it('merges a patch of one chat field into the rest', () => {
    const next = applySettingsPatch(DEFAULT_SETTINGS, { appearance: { chat: { width: 'wide' } } })
    expect(next.appearance.chat).toEqual({ ...DEFAULT_SETTINGS.appearance.chat, width: 'wide' })
    expect(next.appearance.windowMaterial).toBe('glass')
  })

  it('reads older settings: 液态玻璃 and 磨砂玻璃 become 玻璃, 实色 stays, and the dropped 窗口底层不透明度 is not kept (PRD v1.179)', () => {
    const read = (windowMaterial: string, shellOpacity: unknown) => sanitizeSettings({ appearance: { windowMaterial, shellOpacity } }).appearance
    expect(read('frosted', { liquid: 0, frosted: 0.6 }).windowMaterial).toBe('glass')
    expect(read('liquid', 0.2).windowMaterial).toBe('glass')
    expect(read('solid', 0.45).windowMaterial).toBe('solid')
    expect('shellOpacity' in read('glass', 0.3)).toBe(false)
  })

  it('keeps 实心玻璃 (Figma 93); it and 实色 are the opaque materials', () => {
    expect(sanitizeSettings({ appearance: { windowMaterial: 'solid-glass' } }).appearance.windowMaterial).toBe('solid-glass')
    expect(isOpaqueMaterial('solid-glass')).toBe(true)
    expect(isOpaqueMaterial('solid')).toBe(true)
    expect(isOpaqueMaterial('glass')).toBe(false)
  })
})

describe('设置 · 自动化 · 电源 (PRD v1.237)', () => {
  it('keeps the Mac awake by default', () => {
    expect(DEFAULT_SETTINGS.power).toEqual({ keepAwake: true })
  })
  it('falls back to true for a non-boolean', () => {
    expect(sanitizeSettings({ power: { keepAwake: 'no' } }).power.keepAwake).toBe(true)
    expect(sanitizeSettings({ power: 3 }).power.keepAwake).toBe(true)
  })
  it('merges a patch', () => {
    expect(applySettingsPatch(DEFAULT_SETTINGS, { power: { keepAwake: false } }).power.keepAwake).toBe(false)
  })
})

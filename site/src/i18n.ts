/* Page copy in both languages. English is the default (served at "/"); Chinese lives at "/zh/".
   The layout is the Figma landing page frame O (1794:15463): one scrolling page per language, all copy here.
   Agent names are the products' own names, the same in both languages, and live in agent-marks.ts with the marks. */

export type Lang = 'en' | 'zh'

/** A section a nav link jumps to. */
export type Section = 'agents' | 'board' | 'github' | 'windows' | 'appearance'
/** Where a footer link goes: a section, the repository, a file in it, or the other language. */
export type LinkTarget = Section | 'repo' | 'releases' | 'roadmap' | 'license' | 'lang'

/** A headline line: text, the one emphasised word drawn in the serif italic, then the rest. */
export type Line = [before: string, em: string, after: string]
/** A board card: title, path and status line, with the agent whose mark closes the top line. */
export interface Card {
  /** The id the board's loop script moves the card by (PRD v1.227 ②); the same in both languages. */
  id: string
  title: string
  path: string
  status: string
  agent: 'claude' | 'codex' | 'gemini'
}

const en = {
  htmlLang: 'en',
  meta: {
    title: 'Wavi — Run all coding agents on your Mac',
    description:
      'Wavi is a macOS coding terminal for people who run several coding agents at once: each agent works on its own branch, agents hand work to each other, and Wavi only calls you when one needs you. Free, open source, no telemetry.'
  },
  skip: 'Skip to content',
  nav: {
    label: 'Sections',
    links: [
      ['Agents', 'agents'],
      ['Board', 'board'],
      ['GitHub', 'github'],
      ['Windows', 'windows'],
      ['Appearance', 'appearance']
    ] as [string, Section][],
    other: '中文',
    otherLabel: '切换到中文',
    github: 'GitHub',
    download: 'Download'
  },
  hero: {
    title: [
      ['Run ', 'ALL', ' coding agents'],
      ['on your Mac.', '', '']
    ] as Line[],
    sub: [
      'Wavi runs Claude Code, Codex and 17 more side by side, each on its own branch.',
      'It calls you only when one needs you.'
    ],
    download: 'Download for macOS',
    github: 'GitHub'
  },
  strip: 'Works with the 19 coding agents you already run',
  agents: {
    label: '01 Agents',
    title: ['One task,', 'many hands.'],
    intro:
      'Dispatch, a leader, subagents, agent teams, workflows, or one task given to several agents. Wavi runs each of them and draws who is doing what.',
    alt: 'A chat session in Wavi: one agent dispatches three sessions to Codex, Claude Code and Gemini CLI, drawn as a fan of lines, with a report card from Codex underneath.',
    cells: [
      [
        'Dispatch',
        'Ask one agent to split the job. It sends the pieces to Codex, Gemini or any of the nineteen, each on a branch of its own.'
      ],
      ['Leader', 'A leader session only hands out work. It takes over sessions you opened, after one yes.'],
      ['Subagents', 'Claude Code’s subagents show up under the session that started them.'],
      [
        'Agent teams',
        'A Claude Code team gets lanes under its lead: who is on it, who passed what to whom, who is waiting on you.'
      ],
      ['Workflows', 'Every phase of a workflow is a row: done out of total, tokens, time.'],
      ['Same task, several hands', 'Give one task to two to four agents, line up the diffs and test runs, keep the best.']
    ]
  },
  board: {
    label: '02 Board',
    title: 'Who’s waiting?',
    body: 'Running, done, stuck: each looks different, in shape and in words. Only the one waiting on you lights up, and ⌘J jumps there.',
    now: 'now',
    jump: 'Jump to the next session that needs you',
    columns: ['Needs you', 'Error', 'To review', 'Running', 'Idle'],
    /** The status line a card takes on when the loop moves it into a column (PRD v1.227 ②); it keeps its own line
        until it moves. The glyph and the colour come from the column. */
    cycle: {
      status: {
        needs: 'Confirm: push to jacob/refresh',
        review: 'Done, ready for review',
        running: 'Running pnpm test'
      }
    },
    cards: [
      [
        {
          id: 'cookie',
          title: 'Cookie session migration',
          path: 'acme-web › jacob/session-cookie',
          status: 'Confirm: run pnpm prisma migrate dev',
          agent: 'claude'
        },
        {
          id: 'sidebar',
          title: 'Sidebar status groups',
          path: 'terminal-reborn › jacob/sidebar-agg',
          status: 'Choose: which layer keeps the state?',
          agent: 'codex'
        }
      ],
      [
        {
          id: 'graph',
          title: 'Git graph layout',
          path: 'terminal-reborn › jacob/graph-layout',
          status: 'pnpm build failed · 2 errors',
          agent: 'claude'
        }
      ],
      [
        {
          id: 'mobile',
          title: 'Fix mobile nav jitter',
          path: 'acme-web › jacob/mobile-nav-jitter',
          status: 'Done, ready for review',
          agent: 'claude'
        }
      ],
      [
        {
          id: 'checkout',
          title: 'Checkout performance',
          path: 'acme-web › jacob/checkout-perf',
          status: 'Running pnpm test checkout',
          agent: 'codex'
        },
        {
          id: 'refresh',
          title: 'Auto-refresh sessions',
          path: 'acme-web › jacob/refresh',
          status: 'Reading src/auth/refresh.ts',
          agent: 'gemini'
        }
      ],
      [
        {
          id: 'main',
          title: 'main',
          path: 'acme-web',
          status: 'Terminal · ~/code/acme-web',
          agent: 'claude'
        }
      ]
    ] as Card[][],
    facts: [
      [
        'One board for every project.',
        'Needs you, error, to review, running, idle. Each session is a card with its branch, its diff and the checks it ran.'
      ],
      ['Look without leaving.', 'Press Space on a few cards and up to four live terminals open side by side.'],
      [
        'Called only when it matters.',
        'The Dock counts who needs you. A notification names the session and what it asked, only when you can’t see it.'
      ]
    ]
  },
  github: {
    label: '03 GitHub',
    title: ['Less git.', 'More building.'],
    intro:
      'Issues and pull requests for every project sit on the board. From there to main, each step is one button: the agent does the writing, you do the deciding.',
    alt: 'Wavi’s GitHub board in light mode: open issues and pull requests for two projects.',
    steps: ['Hand to agent', 'Review before push', 'Create PR', 'CI and auto-fix', 'Merge'],
    captions: [
      'Hand an issue or a PR to an agent from the board. It gets a worktree and the task.',
      'With review before push on, what is about to go up gets reviewed first, and a P1 stops it.',
      'Commit, push or open the PR: one lit button. The agent writes the message; you press ⌘↵.',
      'CI fails? The agent fixes it and commits; Wavi checks, then pushes.',
      'Nothing runs by itself until you switch it on.'
    ],
    fragments: {
      issue: '#142',
      issueTitle: 'Session lost after login',
      hand: 'Hand to agent',
      reviewed: 'No P1 found',
      notes: '2 notes · session.ts',
      message: 'fix(auth): keep the session after login',
      create: 'Create PR',
      lint: 'lint',
      test: 'test',
      fixed: 'fixed by the agent',
      merged: 'Merged into main',
      branch: 'jacob/session-cookie → main'
    }
  },
  windows: {
    label: '04 Windows',
    title: ['More screens,', 'more threads.'],
    cells: [
      ['Split it.', 'Drag a session into the window: up to four side by side. Split, swap, resize.'],
      ['Tear it off.', 'Drag one out and it becomes a window of its own, on any screen.'],
      [
        'Leave it running.',
        'Quit with ⌘Q and reopen tomorrow; agents keep going. Claude and Codex pick up again when your quota resets.'
      ],
      ['A branch each.', 'Every agent works in a worktree of its own. Two touching the same code? You hear before you merge.']
    ]
  },
  appearance: {
    label: 'Appearance',
    title: ['Terminal or chat.', 'Glass or solid.'],
    looks: ['Default · terminal 85%', 'Your picture · terminal 50%', 'Blurred · 50%, blur 40%', 'Appearance settings, light'],
    groups: [
      ['Per session.', 'Start each session in the terminal or as a chat. Wear both in one window.'],
      ['Your glass.', 'Liquid Glass or solid, from 20 to 100%. A picture of your own underneath, sharp or blurred.'],
      ['Your type.', 'One font for Latin, one for CJK. Bring a Ghostty or iTerm theme. Light or dark, English or Chinese.']
    ],
    controls: {
      mode: ['Terminal', 'Chat'],
      glass: ['Liquid Glass', 'Solid'],
      slider: ['20', '100', '50%'],
      chips: [
        ['Latin', 'JetBrains Mono'],
        ['CJK', 'Noto Sans SC 中文'],
        ['Theme', 'Ghostty'],
        ['Theme', 'iTerm']
      ] as [string, string][],
      theme: ['Light', 'Dark'],
      language: ['English', '中文']
    }
  },
  faq: {
    label: 'FAQ',
    title: 'Questions',
    items: [
      {
        q: 'Does Wavi change my Claude Code or Codex config?',
        a: 'No. Hooks are injected per launch; ~/.claude and ~/.codex stay as they are.'
      },
      {
        q: 'Do I need an account? Is anything uploaded?',
        a: 'No account. Wavi sends no telemetry; your code and conversations stay on your Mac and go only where your agents send them.'
      },
      {
        q: 'Do agents keep running after I quit Wavi?',
        a: 'Yes. Quit with ⌘Q and the agents keep going; reopen Wavi and each session picks up where it was.'
      },
      {
        q: 'Is it free?',
        a: 'Yes. Wavi is free and open source under the MIT license. You bring your own agent subscriptions.'
      }
    ]
  },
  footer: {
    title: 'Download Wavi',
    line: 'macOS · No account · No telemetry · MIT License',
    columns: [
      {
        title: 'Product',
        links: [
          ['Agents', 'agents'],
          ['Board', 'board'],
          ['GitHub', 'github'],
          ['Windows', 'windows'],
          ['Appearance', 'appearance']
        ]
      },
      {
        title: 'Resources',
        links: [
          ['GitHub', 'repo'],
          ['Changelog', 'releases'],
          ['Roadmap', 'roadmap']
        ]
      },
      {
        title: 'More',
        links: [
          ['MIT License', 'license'],
          ['中文', 'lang']
        ]
      }
    ] as { title: string; links: [string, LinkTarget][] }[],
    download: 'Download for macOS',
    github: 'GitHub',
    copyright: '© 2026 Wavi · MIT License',
    tagline: 'Run all coding agents on your Mac.'
  }
}

type Copy = typeof en

const zh: Copy = {
  htmlLang: 'zh-CN',
  meta: {
    title: 'Wavi — 在你的 Mac 上跑所有 coding agent',
    description:
      'Wavi 是给同时跑好几个 coding agent 的开发者做的 macOS 终端：每个 agent 一条分支，agent 之间互相派活，只在需要你时叫你。免费、开源、无遥测。'
  },
  skip: '跳到正文',
  nav: {
    label: '栏目',
    links: [
      ['Agent', 'agents'],
      ['看板', 'board'],
      ['GitHub', 'github'],
      ['多窗口', 'windows'],
      ['外观', 'appearance']
    ],
    other: 'EN',
    otherLabel: 'Switch to English',
    github: 'GitHub',
    download: '下载'
  },
  hero: {
    title: [
      ['在你的 Mac 上', '', ''],
      ['跑', '所有', ' coding agent。']
    ],
    sub: ['Wavi 同时跑 Claude Code、Codex 和另外 17 家 agent，每个 agent 一条分支。', '只在需要你时叫你。'],
    download: '下载 macOS 版',
    github: 'GitHub'
  },
  strip: '已支持 19 种命令行 agent，装了哪个就用哪个',
  agents: {
    label: '01 Agents',
    title: ['一个任务，', '几双手。'],
    intro:
      '派活、leader、subagent、agent teams、workflow，或者把同一个任务交给几个 agent。每一种 Wavi 都能跑，并且把谁在做什么画出来。',
    alt: 'Wavi 的聊天会话：一个 agent 把三个会话派给 Codex、Claude Code 和 Gemini CLI，画成扇形的连线，下面是 Codex 发回的报告卡片。',
    cells: [
      ['派活', '让一个 agent 拆活，把各块交给 Codex、Gemini 或另外十七家里的任何一家，各在各的分支上。'],
      ['Leader', 'leader 会话只派活。你点一次头，它就能接管你自己开的会话。'],
      ['Subagents', 'Claude Code 的 subagent 挂在启动它的会话下面。'],
      ['Agent teams', 'Claude Code 的队伍在 lead 下面一人一条泳道：谁在队里、谁把什么传给了谁、谁在等你。'],
      ['Workflows', 'workflow 每个 phase 一行：完成数 / 总数、token、耗时。'],
      ['同任务多解', '把一个任务交给两到四个 agent，diff 和测试结果并排摆开，留最好的。']
    ]
  },
  board: {
    label: '02 Board',
    title: '谁在等你？',
    body: '跑着的、做完的、卡住的，形状和文字都不一样。只有在等你的那一个会亮起来，按 ⌘J 跳过去。',
    now: '现在',
    jump: '跳到下一个等你处理的会话',
    columns: ['等你处理', '出错', '待审阅', '运行中', '空闲'],
    /** The status line a card takes on when the loop moves it into a column (PRD v1.227 ②); it keeps its own line
        until it moves. The glyph and the colour come from the column. */
    cycle: {
      status: {
        needs: '等你确认：推送到 jacob/refresh',
        review: '已完成，等你审阅',
        running: '运行 pnpm test'
      }
    },
    cards: [
      [
        {
          id: 'cookie',
          title: 'Cookie 会话迁移',
          path: 'acme-web › jacob/session-cookie',
          status: '等你确认：运行 pnpm prisma migrate dev',
          agent: 'claude'
        },
        {
          id: 'sidebar',
          title: '侧边栏状态聚合',
          path: 'terminal-reborn › jacob/sidebar-agg',
          status: '等你选择：状态存在哪一层？',
          agent: 'codex'
        }
      ],
      [
        {
          id: 'graph',
          title: 'Git 图谱布局算法',
          path: 'terminal-reborn › jacob/graph-layout',
          status: 'pnpm build 失败 · 2 个错误',
          agent: 'claude'
        }
      ],
      [
        {
          id: 'mobile',
          title: '修复移动端导航抖动',
          path: 'acme-web › jacob/mobile-nav-jitter',
          status: '已完成，等你审阅',
          agent: 'claude'
        }
      ],
      [
        {
          id: 'checkout',
          title: '结算页性能优化',
          path: 'acme-web › jacob/checkout-perf',
          status: '运行 pnpm test checkout',
          agent: 'codex'
        },
        {
          id: 'refresh',
          title: '会话过期自动刷新',
          path: 'acme-web › jacob/refresh',
          status: '读取 src/auth/refresh.ts',
          agent: 'gemini'
        }
      ],
      [
        {
          id: 'main',
          title: 'main',
          path: 'acme-web',
          status: '终端 · ~/code/acme-web',
          agent: 'claude'
        }
      ]
    ],
    facts: [
      [
        '一块看板看所有项目。',
        '等你处理、出错、待审阅、运行中、空闲。每个会话一张卡片，写着分支、改动量和这一轮跑过的检查。'
      ],
      ['不离开看板就能看。', '在几张卡片上按空格，最多四个实时终端并排打开。'],
      ['只在要紧时叫你。', 'Dock 角标数着谁在等你。通知写明是哪个会话、问了什么，而且只在你看不见它时才发。']
    ]
  },
  github: {
    label: '03 GitHub',
    title: ['少碰 git，', '多做东西。'],
    intro: '每个项目的 issue 和 PR 都在看板上。从这里到 main，每一步是一个按钮：agent 负责写，你负责决定。',
    alt: '浅色模式的 Wavi GitHub 看板：两个项目打开的 issue 和 PR。',
    steps: ['交给 agent', '推送前审阅', '创建 PR', 'CI 和自动修复', '合并'],
    captions: [
      '在看板上把 issue 或 PR 交给 agent，它会拿到一个 worktree 和任务。',
      '打开推送前审阅后，要推上去的提交先审一遍，发现 P1 就停下。',
      '提交、推送或开 PR：只亮一个按钮。说明由 agent 写，你按 ⌘↵。',
      'CI 挂了？agent 修好并提交，Wavi 检查后推送。',
      '你不打开开关，什么都不会自己跑。'
    ],
    fragments: {
      issue: '#142',
      issueTitle: '登录后刷新会丢失会话',
      hand: '交给 agent',
      reviewed: '没有 P1',
      notes: '2 条建议 · session.ts',
      message: 'fix(auth): keep the session after login',
      create: '创建 PR',
      lint: 'lint',
      test: 'test',
      fixed: '已由 agent 修复',
      merged: '已合并到 main',
      branch: 'jacob/session-cookie → main'
    }
  },
  windows: {
    label: '04 Windows',
    title: ['多一块屏，', '多几条线。'],
    cells: [
      ['分屏。', '把会话拖进窗口，最多四个并排。分屏、交换、调大小。'],
      ['撕下来。', '把一个拖出去，它就成了独立的窗口，放到哪块屏都行。'],
      ['让它跑着。', '⌘Q 退出，明天再打开，agent 照常在跑。Claude 和 Codex 在额度恢复后自己接着干。'],
      ['一人一条分支。', '每个 agent 在自己的 worktree 里干活。两个改到同一处？合并前就先告诉你。']
    ]
  },
  appearance: {
    label: 'Appearance',
    title: ['终端或聊天，', '玻璃或实色。'],
    looks: ['默认 · 终端 85%', '你的图 · 终端 50%', '模糊 · 50%，模糊 40%', '外观设置'],
    groups: [
      ['按会话选。', '每个会话可以开在终端里，也可以开成聊天。一个窗口里两种都能穿。'],
      ['你的玻璃。', 'Liquid Glass 或实色，从 20% 到 100%。底下垫一张你自己的图，清晰或模糊。'],
      ['你的字。', '拉丁字母一套字体，中日韩一套。Ghostty 或 iTerm 的主题直接带过来。浅色或深色，中文或英文。']
    ],
    controls: {
      mode: ['终端', '聊天'],
      glass: ['液态玻璃', '实色'],
      slider: ['20', '100', '50%'],
      chips: [
        ['西文', 'JetBrains Mono'],
        ['中文', 'Noto Sans SC 中文'],
        ['主题', 'Ghostty'],
        ['主题', 'iTerm']
      ],
      theme: ['浅色', '深色'],
      language: ['English', '中文']
    }
  },
  faq: {
    label: 'FAQ',
    title: '常见问题',
    items: [
      {
        q: '会改动我的 Claude Code 或 Codex 全局配置吗？',
        a: '不会。hooks 在每次启动时单独注入，~/.claude 和 ~/.codex 保持原样。'
      },
      {
        q: '需要注册账号吗？会上传我的数据吗？',
        a: '不需要账号。Wavi 不收集遥测；代码和对话留在你的 Mac 上，只会去你的 agent 自己要去的地方。'
      },
      { q: '退出 Wavi 之后，agent 还会继续跑吗？', a: '会。⌘Q 之后 agent 照样在跑，重新打开就接上。' },
      { q: '免费吗？', a: '免费。Wavi 以 MIT 许可开源；agent 的订阅用你自己的。' }
    ]
  },
  footer: {
    title: '下载 Wavi',
    line: '适用于 macOS · 无需账号 · 无遥测 · MIT 开源',
    columns: [
      {
        title: '产品',
        links: [
          ['Agent', 'agents'],
          ['看板', 'board'],
          ['GitHub', 'github'],
          ['多窗口', 'windows'],
          ['外观', 'appearance']
        ]
      },
      {
        title: '资源',
        links: [
          ['GitHub', 'repo'],
          ['版本记录', 'releases'],
          ['路线图', 'roadmap']
        ]
      },
      {
        title: '更多',
        links: [
          ['MIT 许可', 'license'],
          ['English', 'lang']
        ]
      }
    ],
    download: '下载 macOS 版',
    github: 'GitHub',
    copyright: '© 2026 Wavi · MIT 许可',
    tagline: '在你的 Mac 上跑所有 coding agent。'
  }
}

export const copy: Record<Lang, Copy> = { en, zh }

/** Path of the same page in the other language, relative to the site base. */
export const otherPath = (lang: Lang): string => (lang === 'en' ? 'zh/' : '')

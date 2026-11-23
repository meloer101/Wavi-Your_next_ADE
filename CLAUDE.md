# Wavi — agent guide

macOS terminal for running many CLI coding agents (Claude Code, Codex) in parallel. Electron + xterm.js + node-pty + React 19 + zustand, built with electron-vite.

- Product spec: `docs/PRD.md` — what the product should become (read the section your task points to before coding). Measured CLI / daemon behaviour is in PRD §6.6–§6.9.
- Progress: `docs/ROADMAP.md` — what is done, in progress and not started.
- Design source of truth: Figma `x6HGsLiMTk7fWDoKI5YkKh` — screen node IDs are in PRD §5. Use the Figma MCP (`get_design_context` / `get_screenshot`) on the exact node you are implementing.

**These are the only two docs.** When a product decision changes, edit `docs/PRD.md` and add a line to its 变更记录. When you finish, add or drop work, tick or move it in `docs/ROADMAP.md` and bump its date, in the same commit as the code. Do not create task briefs, plans, acceptance records, spikes or research files; put a short brief in the session or PR instead, and fold new measured findings into PRD §6.

## Commands

```bash
npm run dev        # app with hot reload (own "Wavi Dev" profile, never the installed app's)
npm run app:install  # /Applications/Wavi.app linked to this checkout; `npm run build` updates it
npm run check      # typecheck + lint + dependency rules (.dependency-cruiser.cjs) + vitest — must pass before merging into main
npm run test:e2e   # build + Playwright Electron smoke test — the full run, once before a release
```

In a fresh worktree run `npm install` first. While developing, run `npm run typecheck`, `npm run lint` and only the tests of what changed (`npx vitest run <paths>`, `npx playwright test e2e/<spec> --project=parallel` after `npx electron-vite build`); before a branch merges into main, run the full `npm run check` and only the e2e specs of what changed. After the merge, run `npm run build` in the main checkout: the installed Wavi runs that checkout's `out/`, so a merge without a build leaves the app the user is looking at unchanged. The full `npm run test:e2e` runs once before a release. A failure unrelated to the change (load timeouts in the git-heavy tests) is rerun alone, not with another full run.

## Layout and ownership

| Path | What | Owner |
|---|---|---|
| `src/shared/` | Pure, typed contracts and logic shared by main + renderer (`types`, `ipc`, `agent-events`, `settings`, `send-protocol`, `keys`, `session-status`) | integrator — **additive changes only** from tracks, call them out in the commit message |
| `src/main/` | Electron main: window, IPC handlers, (later) hook server, git | integrator; `pty-terminal` adds `src/main/pty/` |
| `src/pty-host/` | utilityProcess owning node-pty | `pty-terminal` |
| `src/preload/` | `window.tr` (implements `TrApi` from `src/shared/ipc.ts`) | `pty-terminal` may change transport, not the `TrApi` shape |
| `src/renderer/app-shell/`, `state/`, `session-io.ts`, `ui/`, `styles/` | Layout, workspace store, integration seam, shared UI atoms, tokens | integrator |
| `src/renderer/terminal/` | `TerminalSurface` + xterm implementation | `pty-terminal` |
| `src/renderer/composer/` | Input box | `composer` |
| `src/renderer/sidebar/` | Status sidebar | `sidebar-ui` |
| `src/renderer/panels/` | Right panel views: browser, git, worktree, files, terminal (panel shells, `src/shared/panel-terminal.ts`), simulator | integrator |
| `src/main/simulator/`, `src/shared/simulator.ts` | iOS 模拟器 view's main side: `simctl`, one serve-sim helper per device on 127.0.0.1, MJPEG frames to the page over a MessagePort, input to the helper's `/ws` (PRD F17 v1.176) | integrator |
| `src/main/hooks/`, `resources/hooks/`, `src/shared/agent-launch.ts` | Per-launch Claude hooks → `AgentEvent` / `PendingPrompt` (M2) | `hooks-bridge` |
| `src/renderer/status/`, `src/shared/session-state-machine.ts`, `src/shared/current-action.ts` | Live status, notifications, Dock badge (M2) | `session-status` |
| `src/renderer/prompt-bar/`, `src/shared/question-keys.ts` | Permission / question bar (M2) | `prompt-bar` |
| `src/shared/session-settings.ts`, `src/shared/terminal-settings.ts`, `src/renderer/session-settings/` | The phone's 会话设置: model / effort / permission for one session (GUI pickers; Claude's TUI by keys) (F22 v1.144) | integrator |
| `src/shared/gui-chat.ts`, `src/main/gui/`, `src/renderer/gui/` | GUI sessions: headless Claude / Codex / ACP agents drawn as a chat (F23) | `gui-sessions` |
| `src/renderer/command-palette/` | ⌘K (M2) | `command-palette` |
| `src/renderer/settings/` | Settings dialog UI (M3; a sheet over the main window) | `settings-ui` |
| `src/renderer/appearance/`, `src/main/appearance.ts`, `src/renderer/theme.ts` | Applying appearance settings (M3) | `appearance-runtime` |
| `src/main/hooks/` (Codex parts) | Codex hooks/approvals (M3) | `codex-adapter` |
| `site/` | Website: Astro project with its own `package.json` (`cd site && npm install && npm run dev`, `npm run check`, `npm test`); no animation library; motion is CSS plus the reveal script in `site/src/components/Home.astro` and the board loop in `Board.astro`; the six agent diagrams and the board loop while in view (PRD v1.227), the rest plays once, all of it respects `prefers-reduced-motion`, and the page shows everything with JavaScript off; the Intel/Apple-silicon switch is in `site/src/components/Ctas.astro` (the FAQ is `<details>`); fonts are self-hosted subsets of the page's characters; deployed to Vercel only (project `wavi`, root `site/`, https://wavi.autos; pushes to main deploy it); English at `/`, Chinese at `/zh/` (all copy in `site/src/i18n.ts`); design is the Figma page 「官网·新风格探究‘」, frame O `1794:15463`; the page is ten screens, each at least one viewport (PRD v1.225) | integrator |
| `ios/` | iPhone app (PRD F22): native SwiftUI, iOS 26, Swift 6. `cd ios && xcodegen` writes `Wavi.xcodeproj` from `project.yml` (generated, git-ignored); `xcodebuild test -scheme Wavi -destination 'platform=iOS Simulator,name=iPhone 17 Pro'` runs `WaviTests`. Crypto matches the Mac byte for byte against `src/shared/remote-vectors.json`, and status words, agent names and marks, icons and branch words come from the desktop through `Resources/Shared.json` and `Assets.xcassets/{Agents,Icons}` — all written by `src/main/remote/vectors.test.ts` / `phone-assets.test.ts` (`WAVI_WRITE_VECTORS=1` / `WAVI_WRITE_PHONE_ASSETS=1`), never edited by hand. ristretto255 for the PAKE is vendored from libsodium in `Packages/Ristretto255` (ISC). The Live Activity (Dynamic Island, Lock Screen) is the `WaviActivity` widget extension: the app builds its state (`Wavi/Model/ActivityState.swift`), `LiveActivity/` is compiled into both targets (attributes, the `LiveActivityIntent` buttons, which answer only in the app's process). The simulator caps Live Activities system-wide, so other apps' activities can make `Activity.request` fail; test on a fresh simulator. Design is Figma sections 46′ / 46″ / 47; signing team `U9XR52C9HW`, bundles `app.wavi.remote` and `app.wavi.remote.activity` | integrator |
| `build/`, `electron-builder.yml`, `.github/workflows/release.yml`, `src/main/updates.ts` | Packaging, icon, update check (M3) | `release` |

Stay inside the directories your task owns. If you truly need a change elsewhere, keep it minimal and say so in the commit message — don't refactor shared files.

## Conventions

- Every agent, not just two: research, comparisons, designs and code that touch agents cover all the agents Wavi supports (`src/shared/agents.ts`, GUI drivers in `src/shared/gui-agents.ts`), not only Claude Code and Codex. List the ones that could not be measured or checked (not installed, no access) instead of leaving them out.
- TypeScript strict; no `any`. Pure logic goes in `src/shared/` or a feature's `*.ts` file with a colocated `*.test.ts` (Vitest).
- Styling: CSS Modules (`*.module.css`). Colors, spacing, radii and type **only** via variables in `src/renderer/styles/tokens.css`. Verify both themes (`<html data-theme="dark|light">`).
- Design taste: quiet and systematic — chroma-0 neutrals, color only for status, hierarchy from type/alignment/hairlines, small radii, no cards/gradients/decorative captions. Status is never color-only (StatusGlyph shape + text).
- Figma hand-off: screenshot and look at every changed screen before reporting, not a sample; a component edit counts as changing every screen that uses it. Render with `get_screenshot` in a separate call (CJK in text set during the same `use_figma` call can render blank).
- Icons: Hugeicons (stroke-rounded, free), only through `src/renderer/ui/icons.tsx` (add a glyph there when you need a new one), `size={16} strokeWidth={1.75}`.
- CJK: always keep a CJK family in font stacks; CJK occupies 2 terminal cells.
- UI copy in Chinese and English side by side: `defineMessages({ zh, en })` from `src/shared/i18n.ts` (lint allows Chinese only there; the phone's is `ios/Wavi/Resources/Localizable.xcstrings`). Code, comments, commit messages in English. Conventional Commits (`feat(composer): …`).
- Security: `contextIsolation` + `sandbox` stay on; renderer reaches the system only through `window.tr`. Validate every IPC payload in main. Folder roots from the renderer must be workspace folders (`isWorkspaceDir` / `isProjectRoot`); the renderer declares those folders, so this keeps a wrong path out and is no boundary against a renderer that is not ours. Every agent runs as the same user, so the hook socket token only keeps other users out, not one session's agent from another's.
- Never write to the user's global agent config (`~/.claude/settings.json`, `~/.codex/*`). Hooks are injected per launch (PRD §6.2).
- Adapted third-party code: MIT / Apache-2.0 / BSD / ISC only, attribute in file header and `THIRD_PARTY_NOTICES.md`.

## Model roles

Three models work on this repo. Your role comes from how you were started, not from what the task looks like.

| Role | Model | Started as | Owns | Does not |
|---|---|---|---|---|
| Commander | Fable | the session the user talks to | requirements, acceptance criteria, the plan, briefs, every decision, Figma work, checking each result, the report to the user | write the code of a change larger than small; pass on a report it has not checked |
| Executor | Pi | `wavi run pi` (own worktree and branch) | the implementation its brief describes, the checks the brief names, commits on its branch, `wavi report` | decide product or scope questions, touch files outside the brief, merge or push |
| Reviewer / searcher | Sonnet | the Agent tool with `model: "sonnet"` (`Explore` or `general-purpose` to search, `architecture-reviewer` to review) | code search, web research with sources, an independent review of a diff | edit files, answer with a redesign in place of findings |

Who does which work:

- A small change (1–2 files, no change to an interface, a data model or a dependency direction): the commander makes it itself, since a brief costs more than the change. Anything larger goes to Pi, after the user has confirmed the plan.
- A search with a known target (one file, one symbol, one page): the commander. A broad one (many files, several sources, the web): Sonnet.
- Review: Sonnet, once before a branch merges into main. It adds a second read; it does not replace the commander reading the diff and running the checks.

The loop:

1. Commander: acceptance criteria as commands or observable behaviour, then the plan. Sonnet gathers context first when the search is broad.
2. Commander: commit what Pi needs (`--base head` copies no uncommitted change), `wavi run pi` with the brief, end the turn.
3. Pi: implement, run the brief's checks, commit, `wavi report`.
4. Commander: `wavi read <id>`, read the diff, run the acceptance checks itself in that worktree.
5. Sonnet: review the diff.
6. Commander: open the lines each finding cites, drop the ones that do not hold, send the rest to Pi in one `wavi send <id>`; back to 4.
7. Commander: the merge checks in Commands, then the report to the user. The merge itself is the user's, in Wavi.

Hand-offs. Pi and Sonnet see nothing of the commander's conversation, so each one stands alone:

- Brief to Pi: the goal in one sentence with its PRD section or Figma node; the approach already decided (what to reuse, where new code goes), so Pi does not decide it again; files in scope and files off limits; the exact check commands and their expected results; done means committed on its branch, the `docs/ROADMAP.md` line included, and a `wavi report` with what changed, each check's output and open questions; when the approach does not work or needs a file outside the scope, Pi reports the question and ends the turn instead of working around it.
- Search request to Sonnet: the question; what is already known or ruled out; where to look; the answer comes back conclusion first, each claim with `path:line` or a URL, anything not found or inferred marked as such, within a stated length.
- Review request to Sonnet: the commit range, the acceptance criteria, the docs that bind the change. Not the plan's reasoning and not the commander's opinion of the diff. Findings come back most severe first, each with `path:line` and the input that gives the wrong result.

Rules:

- A report is a claim. The record is the diff and the checks the commander ran itself.
- One Pi session per independent deliverable; a correction goes through `wavi send`, never a second session. Parallel sessions only for parts that share no files and do not depend on each other.
- After two correction rounds that fail the same check, the commander stops sending: it rewrites the plan or writes the change itself, and tells the user which and why.
- When a decision rests on one fact from a search, the commander reads that source itself.
- Pi and Sonnet put their questions in their report. Only the commander asks the user.

<p align="center">
  <a href="https://wavi.autos"><img src="docs/assets/readme/header.svg" alt="Wavi. One person, many threads. A macOS terminal for running many coding agents in parallel: Claude Code, Codex and 17 more." width="100%"></a>
</p>

<p align="center">
  <a href="https://github.com/meloer101/Wavi-Your_next_ADE/releases/latest"><img src="https://img.shields.io/github/v/release/meloer101/Wavi-Your_next_ADE?style=flat-square&label=release&labelColor=1a1a1a&color=3a3a3a" alt="Latest release"></a>
  <img src="https://img.shields.io/badge/macOS-13%2B-3a3a3a?style=flat-square&logo=apple&logoColor=white&labelColor=1a1a1a" alt="macOS 13+">
  <img src="https://img.shields.io/badge/agents-19-3a3a3a?style=flat-square&labelColor=1a1a1a" alt="19 agents">
  <img src="https://img.shields.io/badge/telemetry-none-3a3a3a?style=flat-square&labelColor=1a1a1a" alt="No telemetry">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/meloer101/Wavi-Your_next_ADE?style=flat-square&labelColor=1a1a1a&color=3a3a3a" alt="MIT license"></a>
</p>

<p align="center">
  <a href="https://github.com/meloer101/Wavi-Your_next_ADE/releases/latest"><b>Download for macOS</b></a>
  &nbsp;·&nbsp; <a href="https://wavi.autos">Website</a>
  &nbsp;·&nbsp; <a href="CHANGELOG.md">Changelog</a>
  &nbsp;·&nbsp; <a href="docs/ROADMAP.md">Roadmap</a>
  &nbsp;·&nbsp; <a href="README.zh-CN.md">简体中文</a>
</p>

<br>

Running one coding agent is easy. Running five means five terminals, five branches stepping on each other, and a permission prompt that has been waiting for ten minutes in a tab you forgot about.

Wavi gives every agent its own git worktree and keeps the work of a lead in one window: who needs you right now, what each one changed, which agent handed what to which, and how the good result gets back into `main`.

## The headline features

### Agents dispatch to agents

Any agent can run `wavi run` to hand part of its job to another one, across vendors: Claude Code to Codex, Codex to Cursor Agent, in any direction. Each child session gets its own worktree and branch. You confirm the batch once, and every report comes back to the session that asked. In a GUI session the dispatch is drawn as a graph, live.

<img src="docs/assets/readme/feature-dispatch.png" alt="A Claude Code session dispatches three sessions to Codex, Claude Code and Cursor Agent. The graph shows one running, one waiting on the user and one done with its report sent back." width="100%">

### Agent teams, drawn as a timeline

When Claude Code runs an agent team, Wavi draws it as lanes under the lead's terminal: who is working, who is idle, who is waiting on you, and every message the teammates sent each other. The sidebar lists each teammate with its model.

<img src="docs/assets/readme/feature-teams.png" alt="A team of five agents as lanes on a timeline, with arrows for the messages between them: v1 ready, sent back, v2 ready." width="100%">

### Issue in, PR out

The Board has a GitHub tab with every open issue and pull request of your projects. Hand one to an agent and Wavi opens a session in a new worktree with the thread as its task; a PR's session starts on the PR's branch. Failing checks and review comments go back to the agent the same way. Nothing merges until you say so.

<img src="docs/assets/readme/feature-github.png" alt="The Board's GitHub tab with three issues and three pull requests, and the New session sheet prefilled with issue 139." width="100%">

### Splits, panes and windows

Show two to four sessions side by side, or drag one out of the window and it becomes a window of its own. A project can have its own window too. Agents keep running wherever their session sits, and the layout comes back after a restart.

<img src="docs/assets/readme/feature-windows.png" alt="Three Wavi windows: a main window split in two, a pane pulled out into its own window, and a GUI session window." width="100%">

## Everything else

<table>
  <tr>
    <td width="50%" valign="top">
      <h4>Know who's waiting</h4>
      Every session shows its status as a shape and a word, never color alone, with its current action and how long it has waited. The Board (<kbd>⇧⌘A</kbd>) groups every session across projects by what it needs. <kbd>⌘J</kbd> jumps to the next one that needs you.
    </td>
    <td width="50%" valign="top">
      <h4>GUI or CLI, per session</h4>
      Each session is either the agent's own terminal interface, exactly as the CLI ships it, or a chat drawn by Wavi: tool calls folded into one line, diffs colored, files clickable. Pick per session and mix both in one window.
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h4>One task, several answers</h4>
      <kbd>⌘N</kbd> can hand the same task to two to four agents at once, vendors mixed, each in its own worktree from the same base. Compare the results side by side and merge the best one.
    </td>
    <td valign="top">
      <h4>Review, then merge locally</h4>
      Comment on any line of the diff and Wavi sends your notes to the agent with code references. <kbd>⇧⌘M</kbd> checks conflicts and runs your tests first; the base branch moves only at the last step, so a failure leaves the repository as it was.
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h4>Conflict radar</h4>
      In the background Wavi compares the active worktrees with each other and with the base, and warns you before two agents collide.
    </td>
    <td valign="top">
      <h4>Agents outlive the window</h4>
      A background daemon owns every terminal. Quit with <kbd>⌘Q</kbd> and the agents keep running; reopen Wavi and you are back on the same screen. After a reboot a session resumes its conversation.
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h4>Scheduled tasks</h4>
      Open a new session in a new worktree, or message an idle one, on a schedule: every N minutes, daily, weekdays, weekly or once.
    </td>
    <td valign="top">
      <h4>Make it yours</h4>
      Glass, solid or solid-glass windows, opacity, a background image, separate Latin and CJK fonts, imported terminal themes. The interface comes in English and Chinese.
    </td>
  </tr>
</table>

## Supported agents

Claude Code · Codex · OpenCode · Gemini CLI · Qwen Code · Pi · Copilot CLI · Cursor Agent · Grok · Kimi Code · Droid · Amp · Kiro · Crush · Goose · Cline · Antigravity · Auggie · CodeBuddy

All 19 can dispatch work and be dispatched to. Claude Code and Codex have the deepest integration: status from their own hooks, context and plan usage, review, and resuming a conversation after a restart. Anything else runs in a plain terminal session.

## Private by default

- **No account, no server, no telemetry.** Wavi checks GitHub for a new release once a day. Otherwise it goes online only for the git and GitHub commands you trigger, with your own credentials.
- **It never touches your agent config.** Hooks are passed on each launch, never written to `~/.claude/settings.json` or `~/.codex/`.
- **It doesn't decide for you.** Merging, pushing and approving permissions stay with you. Anything automatic lives in Settings · Automation and is off by default.

## Install

1. Download the dmg from [Releases](https://github.com/meloer101/Wavi-Your_next_ADE/releases/latest): `arm64` for Apple silicon, `x64` for Intel.
2. Open it and drag Wavi into Applications. Builds are signed with a Developer ID and notarized by Apple.
3. Have at least one agent installed and signed in, for example [Claude Code](https://docs.claude.com/en/docs/claude-code) or [Codex](https://github.com/openai/codex). Without any, Wavi still works as a terminal.

Requires macOS 13 or later. Wavi tells you when a new version is out.

## FAQ

<details>
<summary><b>How is this different from tmux or terminal tabs?</b></summary>
<br>
Tabs show you terminals. Wavi knows what the agent inside each one is doing, and it owns the git side: worktrees, diffs, review, merge and archive. You stop polling tabs.
</details>

<details>
<summary><b>Does Wavi send my code anywhere?</b></summary>
<br>
No. Wavi has no server. Your code goes only where your agents and your git remotes already send it.
</details>

<details>
<summary><b>Will it change my Claude Code or Codex setup?</b></summary>
<br>
No. Everything Wavi needs is passed on the command line for each launch. Run <code>claude</code> or <code>codex</code> outside Wavi and nothing is different.
</details>

<details>
<summary><b>What doesn't it do yet?</b></summary>
<br>
macOS only. See the <a href="docs/ROADMAP.md">roadmap</a> for what's next.
</details>

## Development

Requires Node ≥ 22.12 and macOS.

```bash
npm install
npm run dev          # dev build with hot reload, in its own "Wavi Dev" profile
npm run check        # typecheck + lint + dependency rules + unit tests
npm run test:e2e     # build and run the Electron end-to-end tests
npm run dist         # package arm64 / x64 dmg and zip into release/
```

The product spec is [docs/PRD.md](docs/PRD.md), progress is in [docs/ROADMAP.md](docs/ROADMAP.md), and [CONTRIBUTING.md](CONTRIBUTING.md) covers the rest. Found a bug or want a feature? [Open an issue](https://github.com/meloer101/Wavi-Your_next_ADE/issues/new/choose).

## License

[MIT](LICENSE). Third-party code and assets are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

<br>

<p align="center">
  <a href="https://wavi.autos"><img src="docs/assets/readme/footer.svg" alt="Branch out. Merge in. wavi.autos" width="100%"></a>
</p>

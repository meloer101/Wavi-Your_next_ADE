<p align="center">
  <a href="https://wavi.autos/zh/"><img src="docs/assets/readme/header.zh-CN.svg" alt="Wavi。一个人，多线程。同时带很多个 coding agent 的 macOS 终端：Claude Code、Codex，还有另外 17 家。" width="100%"></a>
</p>

<p align="center">
  <a href="https://github.com/meloer101/Wavi-Your_next_ADE/releases/latest"><img src="https://img.shields.io/github/v/release/meloer101/Wavi-Your_next_ADE?style=flat-square&label=release&labelColor=1a1a1a&color=3a3a3a" alt="最新版本"></a>
  <img src="https://img.shields.io/badge/macOS-13%2B-3a3a3a?style=flat-square&logo=apple&logoColor=white&labelColor=1a1a1a" alt="macOS 13+">
  <img src="https://img.shields.io/badge/agents-19-3a3a3a?style=flat-square&labelColor=1a1a1a" alt="19 家 agent">
  <img src="https://img.shields.io/badge/telemetry-none-3a3a3a?style=flat-square&labelColor=1a1a1a" alt="没有遥测">
  <a href="LICENSE"><img src="https://img.shields.io/github/license/meloer101/Wavi-Your_next_ADE?style=flat-square&labelColor=1a1a1a&color=3a3a3a" alt="MIT 许可证"></a>
</p>

<p align="center">
  <a href="https://github.com/meloer101/Wavi-Your_next_ADE/releases/latest"><b>下载 macOS 版</b></a>
  &nbsp;·&nbsp; <a href="https://wavi.autos/zh/">官网</a>
  &nbsp;·&nbsp; <a href="CHANGELOG.md">更新日志</a>
  &nbsp;·&nbsp; <a href="docs/ROADMAP.md">路线图</a>
  &nbsp;·&nbsp; <a href="README.md">English</a>
</p>

<br>

开一个 coding agent 很容易。开五个，就是五个终端、五条互相踩的分支，还有一个权限确认在你忘掉的标签页里等了十分钟。

Wavi 给每个 agent 一个自己的 git worktree，把带队的事收进一个窗口：现在谁在等你，每个改了什么，谁把活派给了谁，好的结果怎么回到 `main`。

## 主打功能

### agent 给 agent 派活

哪家 agent 都能用 `wavi run` 把手上的一部分活派给别家：Claude Code 派给 Codex，Codex 派给 Cursor Agent，方向随意。每个子会话有自己的 worktree 和分支。你确认一次，干完的报告自己回到派活的那个会话。GUI 会话里，派活会实时画成一张图。

<img src="docs/assets/readme/feature-dispatch.zh-CN.png" alt="一个 Claude Code 会话派出三个会话，分别交给 Codex、Claude Code 和 Cursor Agent。图上一个在运行，一个等你处理，一个已完成并送回报告。" width="100%">

### agent teams，画成一条时间线

Claude Code 起 agent team 时，Wavi 在 lead 的终端下面把它画成泳道：谁在干活，谁闲着，谁在等你，队友之间发过的每一条消息。侧栏列出每个队友和它用的模型。

<img src="docs/assets/readme/feature-teams.zh-CN.png" alt="五个 agent 的队伍画成时间线上的泳道，箭头是它们之间的消息：第 1 版好了、退回、第 2 版好了。" width="100%">

### issue 进来，PR 出去

看板的 GitHub 页签列出各个项目打开的 issue 和 PR。把其中一个交给 agent，Wavi 就在新的 worktree 里开一个会话，任务是这条 issue 的正文和评论；交 PR 时会话直接接在 PR 的分支上。检查失败、review 评论也这样交回去。合不合，你说了算。

<img src="docs/assets/readme/feature-github.zh-CN.png" alt="看板的 GitHub 页签，三个 issue 和三个 PR；新建会话面板里已经填好 issue 139 的任务。" width="100%">

### 分屏、多格、多窗口

两到四个会话并排看；把其中一个拖到窗口外，它就是一个新窗口。项目也可以有自己的窗口。会话挪到哪儿，agent 都照跑，重启后排法还在。

<img src="docs/assets/readme/feature-windows.zh-CN.png" alt="三个 Wavi 窗口：分成两格的主窗口、拖出去的一格、一个 GUI 会话窗口。" width="100%">

## 其余的

<table>
  <tr>
    <td width="50%" valign="top">
      <h4>谁在等你，扫一眼就知道</h4>
      每个会话的状态是一个图形加一个词，不只靠颜色，旁边写着它正在做什么、等了多久。看板（<kbd>⇧⌘A</kbd>）把所有项目的会话按需要你做什么分组。<kbd>⌘J</kbd> 跳到下一个等你的。
    </td>
    <td width="50%" valign="top">
      <h4>GUI 还是 CLI，每个会话自己选</h4>
      一个会话可以是 agent 自己的终端界面，和 CLI 原样一致；也可以是 Wavi 画的对话：工具调用收成一行，diff 着色，文件可点。每个会话各选各的，两种混着开。
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h4>一道题，多几份答案</h4>
      <kbd>⌘N</kbd> 可以把同一件事同时交给两到四个 agent，各家混着来，每个从同一个基线开自己的 worktree。结果并排比，挑最好的那份合进去。
    </td>
    <td valign="top">
      <h4>先审阅，再在本地合并</h4>
      在 diff 的任意一行写评论，Wavi 把它们连同代码位置一起交给 agent。<kbd>⇧⌘M</kbd> 先查冲突、跑你的测试；基线分支到最后一步才动，失败时仓库和之前一样。
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h4>冲突雷达</h4>
      Wavi 在后台把活跃的 worktree 两两比较，也和基线比较，在两个 agent 撞上之前提醒你。
    </td>
    <td valign="top">
      <h4>关了窗口，agent 照跑</h4>
      每个终端由后台守护进程持有。<kbd>⌘Q</kbd> 退出后 agent 继续跑，重新打开 Wavi 回到同一屏。重启电脑后，会话接着原来的对话。
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h4>定时任务</h4>
      按时间在新的 worktree 里开会话，或者给空闲的会话发消息：每隔 N 分钟、每天、工作日、每周，或只跑一次。
    </td>
    <td valign="top">
      <h4>长成你喜欢的样子</h4>
      窗口材质有玻璃、实色、实心玻璃，可调不透明度，可放背景图；中英文字体分开设，终端主题可导入。界面有中文和英文。
    </td>
  </tr>
</table>

## 支持的 agent

Claude Code · Codex · OpenCode · Gemini CLI · Qwen Code · Pi · Copilot CLI · Cursor Agent · Grok · Kimi Code · Droid · Amp · Kiro · Crush · Goose · Cline · Antigravity · Auggie · CodeBuddy

这 19 家都能派活，也都能被派活。Claude Code 和 Codex 接得最深：状态来自它们自己的 hooks，有 context 和额度、审阅，重启后能接上原来的对话。其他命令行工具在普通终端会话里运行。

## 默认不外传

- **没有账号，没有服务器，没有遥测。** Wavi 每天向 GitHub 查一次新版本。除此之外，只有你触发的 git 和 GitHub 命令会联网，用的是你自己的凭据。
- **不碰你的 agent 配置。** hooks 在每次启动时传入，不写进 `~/.claude/settings.json` 和 `~/.codex/`。
- **不替你做决定。** 合并、推送、批准权限都由你来。自动的事都在 设置 · 自动化 里，默认关闭。

## 安装

1. 在 [Releases](https://github.com/meloer101/Wavi-Your_next_ADE/releases/latest) 下载 dmg：Apple 芯片选 `arm64`，Intel 选 `x64`。
2. 打开后把 Wavi 拖进「应用程序」。安装包用 Developer ID 签名，并经过 Apple 公证。
3. 至少装好并登录一家 agent，例如 [Claude Code](https://docs.claude.com/en/docs/claude-code) 或 [Codex](https://github.com/openai/codex)。一家都没有时，Wavi 仍然可以当终端用。

需要 macOS 13 或更高版本。有新版本时 Wavi 会告诉你。

## 常见问题

<details>
<summary><b>和 tmux、终端标签页有什么不同？</b></summary>
<br>
标签页只给你看终端。Wavi 知道每个终端里的 agent 在做什么，并且管 git 这一侧：worktree、diff、审阅、合并、归档。你不用再挨个标签页去看。
</details>

<details>
<summary><b>Wavi 会把我的代码发到别处吗？</b></summary>
<br>
不会。Wavi 没有服务器。你的代码只会去 agent 和 git 远程本来就会发去的地方。
</details>

<details>
<summary><b>它会改我的 Claude Code 或 Codex 配置吗？</b></summary>
<br>
不会。Wavi 需要的东西都在每次启动时通过命令行传入。在 Wavi 之外运行 <code>claude</code> 或 <code>codex</code>，一切照旧。
</details>

<details>
<summary><b>现在还做不到什么？</b></summary>
<br>
只支持 macOS。接下来做什么见<a href="docs/ROADMAP.md">路线图</a>。
</details>

## 开发

需要 Node ≥ 22.12 和 macOS。

```bash
npm install
npm run dev          # 带热更新的开发版，使用独立的 "Wavi Dev" 配置
npm run check        # 类型检查 + lint + 依赖规则 + 单元测试
npm run test:e2e     # 构建并运行 Electron 端到端测试
npm run dist         # 打包 arm64 / x64 的 dmg 和 zip 到 release/
```

产品规格在 [docs/PRD.md](docs/PRD.md)，进度在 [docs/ROADMAP.md](docs/ROADMAP.md)，其余见 [CONTRIBUTING.md](CONTRIBUTING.md)。发现 bug 或想要新功能，请[提 issue](https://github.com/meloer101/Wavi-Your_next_ADE/issues/new/choose)。

## 许可证

[MIT](LICENSE)。第三方代码和素材列在 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

<br>

<p align="center">
  <a href="https://wavi.autos/zh/"><img src="docs/assets/readme/footer.zh-CN.svg" alt="分头开工，合到一处。wavi.autos" width="100%"></a>
</p>

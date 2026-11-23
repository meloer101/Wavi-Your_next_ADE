// The context ring and its sheet (PRD F22 v1.230 ④, Figma 104C1–104C3; the desktop's is ContextButton.tsx, Figma 52F / 52G).
// A 16 pt ring at the right end of the 会话设置 row says how full the session's context window is; at the point where the
// agent itself starts warning (`high`, decided on the Mac) it is drawn in the text colour with the percent beside it.
// Tapping it opens the window's figures, the agent vendor's plan windows, and, when `high`, 「放进 /compact」, which puts
// the command into this session's composer without sending it.
import SwiftUI

// MARK: - Text (pure, tested in ContextTests)

/// `172k`, `1.2M`, `850`: the desktop's `formatTokens` (session-meta.ts), so both show the same text. Whole k from 1000,
/// M with one decimal below 10M.
func tokenText(_ count: Double) -> String {
  let n = max(0, count)
  if n >= 1_000_000 {
    let millions = n / 1_000_000
    return n >= 10_000_000 ? "\(Int(millions.rounded()))M" : "\(oneDecimal(millions))M"
  }
  if n >= 1_000 { return "\(Int((n / 1_000).rounded()))k" }
  return String(Int(n.rounded()))
}

/// One decimal, without a trailing `.0` (JavaScript's `Number(x.toFixed(1))`).
private func oneDecimal(_ value: Double) -> String {
  let text = String(format: "%.1f", value)
  return text.hasSuffix(".0") ? String(text.dropLast(2)) : text
}

/// `172k / 200k` when both counts are known, else nil (the sheet shows the percent alone).
func contextTitle(_ context: RemoteContext) -> String? {
  guard let used = context.usedTokens, let window = context.windowTokens else { return nil }
  return "\(tokenText(used)) / \(tokenText(window))"
}

func percentText(_ percent: Double) -> String { "\(Int(min(100, max(0, percent)).rounded()))%" }

/// `5 小时`, `7 天`, `7 天 · Sonnet`; Codex calls its 7-day window 每周 (session-meta.ts `windowLabel`).
func windowLabel(vendor: String, minutes: Int, scope: String?) -> String {
  let base: String
  if minutes == 7 * 24 * 60 && vendor == "codex" {
    base = String(localized: "每周")
  } else if minutes % (24 * 60) == 0 {
    base = String(localized: "\(minutes / (24 * 60)) 天")
  } else if minutes % 60 == 0 {
    base = String(localized: "\(minutes / 60) 小时")
  } else {
    base = String(localized: "\(minutes) 分钟")
  }
  return scope.map { "\(base) · \($0)" } ?? base
}

/// `17:22 重置` today, `周五 9:00 重置` within the next week, else `11 月 20 日重置` (session-meta.ts `formatReset`, with the
/// weekday the phone's sheet adds, Figma 104C3). The calendar and locale are passed in so a test fixes them.
func resetText(_ resetsAt: Double, now: Double, calendar: Calendar = .current, locale: Locale = Locale(identifier: AppLanguage.current.rawValue)) -> String {
  let at = Date(timeIntervalSince1970: resetsAt / 1000)
  let today = Date(timeIntervalSince1970: now / 1000)
  func format(_ template: String) -> String {
    let formatter = DateFormatter()
    formatter.calendar = calendar
    formatter.timeZone = calendar.timeZone
    formatter.locale = locale
    formatter.setLocalizedDateFormatFromTemplate(template)
    return formatter.string(from: at)
  }
  let clock = "\(calendar.component(.hour, from: at)):" + String(format: "%02d", calendar.component(.minute, from: at))
  if calendar.isDate(at, inSameDayAs: today) { return String(localized: "\(clock) 重置") }
  if at > today, at.timeIntervalSince(today) < 7 * 24 * 3600 { return String(localized: "\(format("EEE")) \(clock) 重置") }
  return String(localized: "\(format("MMMd"))重置")
}

/// The plan vendor of an agent, as `usageVendor` in src/shared/agents.ts: only Claude Code and Codex have plan windows.
func usageVendor(_ agent: String) -> String? {
  switch agent {
  case "claude", "codex": agent
  default: nil
  }
}

/// `Claude`, `Codex` (session-meta.ts `VENDOR_LABEL`): the vendor's name, not the agent's (`Claude Code`).
func vendorName(_ vendor: String) -> String { vendor.prefix(1).uppercased() + vendor.dropFirst() }

/// The plan windows the sheet shows for a session: its agent's vendor's. A session off its vendor's plan (a third-party
/// endpoint) has no share of the account's windows, so it shows none (the desktop's ContextButton does the same).
func planUsage(for session: RemoteSession, in list: RemoteSessionList) -> RemoteVendorUsage? {
  guard session.offPlan != true, let vendor = usageVendor(session.agent) else { return nil }
  return list.usage?.first { $0.vendor == vendor }
}

/// What the composer's text becomes when something is put into it: replaces an empty draft, goes on a new line under a
/// draft that has words.
func inserting(_ command: String, into draft: String) -> String {
  if draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return command }
  return draft.hasSuffix("\n") ? draft + command : draft + "\n" + command
}

// MARK: - The ring in the row (104C1 / 104C2)

/// A 16 pt donut: the track in fill/strong, the used part in text/secondary, or text/primary when `high`.
struct ContextDonut: View {
  let percent: Double
  let high: Bool

  var body: some View {
    ZStack {
      Circle().stroke(Color.fillStrong, lineWidth: 2)
      Circle()
        .trim(from: 0, to: min(1, max(0, percent / 100)))
        .stroke(high ? Color.textPrimary : Color.textSecondary, style: StrokeStyle(lineWidth: 2, lineCap: .butt))
        .rotationEffect(.degrees(-90))
    }
    .padding(1)
    .frame(width: 16, height: 16)
  }
}

/// The ring in a 32-high glass capsule at the right end of the 会话设置 row; tapping it opens the sheet.
struct ContextRing: View {
  let session: String
  let context: RemoteContext
  @State private var open = false

  var body: some View {
    Button { open = true } label: {
      HStack(spacing: 6) {
        ContextDonut(percent: context.percent, high: context.high)
        if context.high { Text(percentText(context.percent)).font(.ui(.footnote, medium: true)).foregroundStyle(Color.textPrimary) }
      }
      .padding(.horizontal, 8)
      .frame(minWidth: 32, minHeight: 32)
      .glass(16, interactive: true)
      .contentShape(Capsule())
    }
    .buttonStyle(.plain)
    .accessibilityLabel(String(localized: "context 已用 \(percentText(context.percent))"))
    .sheet(isPresented: $open) { ContextSheet(session: session) }
  }
}

// MARK: - The sheet (104C3)

/// The sheet over a session: the figures come from the model's list, and 「放进 /compact」 hands the command to the
/// composer through the model.
struct ContextSheet: View {
  let session: String
  @Environment(AppModel.self) private var model
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    if let remote = model.session(session), let context = remote.context {
      ContextSheetContent(
        context: context, agent: remote.agent,
        usage: planUsage(for: remote, in: model.sessions),
        now: Date().timeIntervalSince1970 * 1000
      ) {
        model.insert("/compact", into: session)
        dismiss()
      }
    } else {
      // The reading went away while the sheet was open.
      Color.clear.onAppear { dismiss() }
    }
  }
}

/// The sheet's content with everything it shows passed in (the shots draw it without a model).
struct ContextSheetContent: View {
  let context: RemoteContext
  let agent: String
  let usage: RemoteVendorUsage?
  let now: Double
  let compact: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      figures
      if let usage, !usage.windows.isEmpty {
        Rectangle().fill(Color.hairline).frame(height: 1)
        vendor(usage)
      }
      Spacer(minLength: 0)
      if context.high {
        Button(action: compact) { Text("放进 /compact") }.buttonStyle(WaviButtonStyle())
      }
    }
    .padding(.horizontal, 20)
    .padding(.top, 28)
    .padding(.bottom, 12)
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .presentationDetents([.medium])
    .presentationDragIndicator(.visible)
    .presentationBackground(Color.bgSheet.opacity(0.9))
  }

  private var figures: some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(alignment: .firstTextBaseline, spacing: 8) {
        if let title = contextTitle(context) {
          Text(title).font(.ui(.title2, medium: true)).foregroundStyle(Color.textPrimary)
          Text(percentText(context.percent)).font(.ui(.callout)).foregroundStyle(Color.textSecondary)
        } else {
          Text(percentText(context.percent)).font(.ui(.title2, medium: true)).foregroundStyle(Color.textPrimary)
        }
      }
      .accessibilityElement(children: .combine)
      Meter(percent: context.percent, mark: context.markPercent, height: 4, markHeight: 8, tickOnFill: Color.bgSheet)
    }
  }

  private func vendor(_ usage: RemoteVendorUsage) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      HStack(spacing: 8) {
        Text(vendorName(usage.vendor)).font(.ui(.callout, medium: true)).foregroundStyle(Color.textPrimary)
        if let plan = usage.plan, !plan.isEmpty { Text(plan).font(.ui(.callout)).foregroundStyle(Color.textSecondary) }
      }
      ForEach(usage.windows) { window in
        HStack(spacing: 10) {
          Text(windowLabel(vendor: usage.vendor, minutes: window.minutes, scope: window.scope))
            .font(.ui(.callout)).foregroundStyle(Color.textPrimary)
            .lineLimit(1).minimumScaleFactor(0.8)
            .frame(width: 84, alignment: .leading)
          Meter(percent: window.percent, mark: nil, height: 4, markHeight: 0)
          Text(percentText(window.percent)).font(.ui(.callout)).foregroundStyle(Color.textPrimary)
            .frame(width: 44, alignment: .trailing)
          if let resetsAt = window.resetsAt {
            Text(resetText(resetsAt, now: now)).font(.ui(.caption)).foregroundStyle(Color.textSecondary)
              .lineLimit(1).minimumScaleFactor(0.8)
              .frame(width: 84, alignment: .trailing)
          }
        }
        .accessibilityElement(children: .combine)
      }
    }
  }
}

/// A capsule bar filled to `percent`, with a 2-wide tick at `mark` when there is one.
private struct Meter: View {
  let percent: Double
  let mark: Double?
  let height: CGFloat
  let markHeight: CGFloat
  /// The tick's colour once the fill has passed it (the sheet's background); before that it is text/primary.
  var tickOnFill: Color = .textPrimary

  var body: some View {
    GeometryReader { proxy in
      let width = proxy.size.width
      ZStack(alignment: .leading) {
        Capsule().fill(Color.fillStrong).frame(height: height)
        Capsule().fill(Color.textPrimary).frame(width: width * min(1, max(0, percent / 100)), height: height)
        if let mark {
          Rectangle().fill(percent >= mark ? tickOnFill : Color.textPrimary).frame(width: 2, height: markHeight)
            .offset(x: min(width - 2, max(0, width * min(1, max(0, mark / 100)) - 1)))
        }
      }
      .frame(maxHeight: .infinity)
    }
    .frame(height: max(height, markHeight))
    .accessibilityHidden(true)
  }
}

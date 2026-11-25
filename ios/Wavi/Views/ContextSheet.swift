// The context ring and its sheet (PRD F22 v1.230 ④, Figma 104C1 / 104C2; the sheet since v1.232 is Figma 108; the desktop's is
// ContextButton.tsx, Figma 52F / 52G).
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

/// One decimal, without a trailing `.0`, as JavaScript's `Number(x.toFixed(1))`: the nearest, and the larger of two equally
/// near ones (`%.1f` takes the even one: 1.25 would read 1.2). Only x.25 and x.75 are exactly between two tenths in binary.
private func oneDecimal(_ value: Double) -> String {
  let exactTie = (value * 4).rounded() == value * 4 && (value * 2).rounded() != value * 2
  let text = String(format: "%.1f", exactTie ? value + 0.05 : value)
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

/// `Claude`, `Codex` (session-meta.ts `VENDOR_LABEL`): the vendor's name, not the agent's (`Claude Code`).
func vendorName(_ vendor: String) -> String { vendor.prefix(1).uppercased() + vendor.dropFirst() }

/// The plan windows the sheet shows for a session: those of the vendor the Mac named for it (`usageVendor`), none when it
/// named none. The phone does not work out which vendor an agent belongs to.
func planUsage(for session: RemoteSession, in list: RemoteSessionList) -> RemoteVendorUsage? {
  guard let vendor = session.usageVendor else { return nil }
  return list.usage?.first { $0.vendor == vendor }
}

/// The plan windows the phone shows: those for the whole plan (5 小时, 7 天). The ones that belong to one model
/// (`scope`, such as 7 天 · Sonnet) stay on the Mac (PRD v1.232).
func shownWindows(_ usage: RemoteVendorUsage) -> [RemoteVendorUsage.Window] { usage.windows.filter { $0.scope == nil } }

/// How many ticks of a 40-tick gauge are filled for `percent`, and which tick is the compaction point (`mark`, a percent;
/// nil when the agent's is not known). Both are clamped to the gauge: the mark is at most the last tick.
func tickMarks(percent: Double, mark: Double?, count: Int = 40) -> (filled: Int, mark: Int?) {
  func tick(_ value: Double) -> Int { Int((min(100, max(0, value)) / 100 * Double(count)).rounded()) }
  return (tick(percent), mark.map { min(count - 1, tick($0)) })
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

// MARK: - The sheet (108)

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

/// The sheet's content with everything it shows passed in (the shots draw it without a model). The system's glass is the
/// sheet's background, and its height is the content's (Figma 108).
struct ContextSheetContent: View {
  let context: RemoteContext
  let agent: String
  let usage: RemoteVendorUsage?
  let now: Double
  let compact: () -> Void
  @State private var height: CGFloat = 360

  var body: some View {
    let windows = usage.map(shownWindows) ?? []
    VStack(alignment: .leading, spacing: 24) {
      figures
      if let usage, !windows.isEmpty { vendor(usage, windows) }
      if context.high {
        Button(action: compact) { Text("放进 /compact") }.buttonStyle(WaviButtonStyle(primary: true))
      }
    }
    .padding(.horizontal, 20)
    // The system's grabber sits in the first 40 points.
    .padding(.top, 40)
    .padding(.bottom, 20)
    .frame(maxWidth: .infinity, alignment: .topLeading)
    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height = $0 }
    .presentationDetents([.height(height)])
    .presentationDragIndicator(.visible)
  }

  private var figures: some View {
    let ticks = tickMarks(percent: context.percent, mark: context.markPercent)
    return VStack(alignment: .leading, spacing: 8) {
      HStack(spacing: 8) {
        Text("上下文").foregroundStyle(Color.textSecondary).frame(maxWidth: .infinity, alignment: .leading)
        Text(percentText(context.percent)).font(.ui(.footnote, medium: context.high)).monospacedDigit()
          .foregroundStyle(context.high ? Color.textPrimary : Color.textSecondary)
      }
      .font(.ui(.footnote))
      VStack(alignment: .leading, spacing: 16) {
        HStack(alignment: .lastTextBaseline, spacing: 8) {
          if let used = context.usedTokens, let window = context.windowTokens {
            Text(tokenText(used)).font(.fixed(40, medium: true)).foregroundStyle(Color.textPrimary)
            Text("/ \(tokenText(window))").font(.fixed(20)).foregroundStyle(Color.textSecondary)
          } else {
            Text(percentText(context.percent)).font(.fixed(40, medium: true)).foregroundStyle(Color.textPrimary)
          }
        }
        .monospacedDigit()
        TickGauge(filled: ticks.filled, mark: ticks.mark, tickHeight: 18)
      }
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("上下文")
    .accessibilityValue([contextTitle(context), percentText(context.percent)].compactMap { $0 }.joined(separator: " · "))
  }

  private func vendor(_ usage: RemoteVendorUsage, _ windows: [RemoteVendorUsage.Window]) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      HStack(spacing: 8) {
        Text(vendorName(usage.vendor)).font(.ui(.callout, medium: true)).foregroundStyle(Color.textPrimary)
        if let plan = usage.plan, !plan.isEmpty { Text(plan).font(.ui(.callout)).foregroundStyle(Color.textSecondary) }
      }
      VStack(alignment: .leading, spacing: 20) {
        ForEach(windows) { window in
          VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
              Text(windowLabel(vendor: usage.vendor, minutes: window.minutes, scope: window.scope))
                .font(.ui(.callout)).foregroundStyle(Color.textPrimary).frame(maxWidth: .infinity, alignment: .leading)
              Text(percentText(window.percent)).font(.ui(.callout, medium: true)).monospacedDigit().foregroundStyle(Color.textPrimary)
            }
            TickGauge(filled: tickMarks(percent: window.percent, mark: nil).filled, mark: nil, tickHeight: 12)
            if let resetsAt = window.resetsAt {
              Text(resetText(resetsAt, now: now)).font(.fixed(12)).foregroundStyle(Color.textSecondary)
            }
          }
          .accessibilityElement(children: .combine)
        }
      }
    }
  }
}

/// 40 ticks, 3 wide, spread over the full width: `filled` of them in the text colour, the rest in fill/strong. The compaction
/// point (`mark`, a tick index) stands out at 28 high in the text colour, in place of the tick that would be there.
private struct TickGauge: View {
  static let count = 40
  let filled: Int
  let mark: Int?
  let tickHeight: CGFloat

  var body: some View {
    HStack(spacing: 0) {
      ForEach(0..<Self.count, id: \.self) { index in
        RoundedRectangle(cornerRadius: 1.5)
          .fill(index == mark || index < filled ? Color.textPrimary : Color.fillStrong)
          .frame(width: 3, height: index == mark ? 28 : tickHeight)
        if index < Self.count - 1 { Spacer(minLength: 0) }
      }
    }
    .frame(height: mark == nil ? tickHeight : 28)
    .accessibilityHidden(true)
  }
}

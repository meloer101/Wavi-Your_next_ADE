// Buttons, notices, empty states and Markdown: the pieces several screens share (Figma 59 Mobile/Button, Mobile/Notice,
// Mobile/EmptyState).
import SwiftUI

/// Capsule buttons, 50 high (Figma 59 Mobile/Button): primary is the solid fill, the others fill/strong inside a sheet,
/// or glass when they float over content (Git · 变更's exits). Disabled at 40%; a press scales down a little.
struct WaviButtonStyle: ButtonStyle {
  var primary = false
  var floating = false
  @Environment(\.isEnabled) private var enabled

  func makeBody(configuration: Configuration) -> some View {
    let label = configuration.label
      .font(.ui(.callout, medium: true))
      .foregroundStyle(primary ? Color.solidOn : Color.textPrimary)
      .padding(.horizontal, Metric.margin)
      .frame(maxWidth: .infinity, minHeight: Metric.control)
      .contentShape(Capsule())
    Group {
      if primary {
        label.background(Color.solidFill, in: Capsule())
      } else if floating {
        label.glass(Metric.control / 2, interactive: true)
      } else {
        label.background(Color.fillStrong, in: Capsule())
      }
    }
    .opacity(enabled ? 1 : 0.4)
    .scaleEffect(configuration.isPressed && enabled ? 0.98 : 1)
    .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
  }
}

/// A notice that is not a session status (connection, stale data, send failures, pairing): a tinted band with a whole
/// sentence in the notice colour, and an optional action in the text colour (Figma 59 Mobile/Notice).
struct Notice: View {
  enum Tone { case info, success, warning, danger }
  let tone: Tone
  let message: String
  var action: String?
  var perform: (() -> Void)?

  private var colors: (Color, Color) {
    switch tone {
    case .info: (.noticeInfo, .noticeInfoTint)
    case .success: (.noticeSuccess, .noticeSuccessTint)
    case .warning: (.noticeWarning, .noticeWarningTint)
    case .danger: (.noticeDanger, .noticeDangerTint)
    }
  }

  var body: some View {
    HStack(spacing: 8) {
      // Never cut: in a sheet at its full height the actions are not squeezed, the content above them scrolls.
      Text(message).font(.ui(.subheadline, medium: true)).foregroundStyle(colors.0).fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: .infinity, alignment: .leading)
      if let action, let perform {
        Button(action, action: perform).font(.ui(.subheadline, medium: true)).foregroundStyle(Color.textPrimary).buttonStyle(.plain)
      }
    }
    .padding(.horizontal, 12)
    .padding(.vertical, 12)
    .background(colors.1, in: RoundedRectangle(cornerRadius: Metric.radiusControl))
  }
}

/// Buttons side by side, or one above the other once the text is too big for them side by side (accessibility sizes).
struct ButtonRow<Content: View>: View {
  @ViewBuilder let content: Content
  @Environment(\.dynamicTypeSize) private var typeSize

  var body: some View {
    let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(spacing: 8)) : AnyLayout(HStackLayout(spacing: 8))
    layout { content }
  }
}

/// An empty or blocked screen: one sentence of what is true and one way forward, no grey caption (Figma 59
/// Mobile/EmptyState, 63B2 / 63C4 / 63E2).
struct EmptyState: View {
  let title: String
  var action: String?
  var perform: (() -> Void)?

  var body: some View {
    VStack(spacing: 16) {
      Text(title).font(.ui(.title3)).foregroundStyle(Color.textPrimary).multilineTextAlignment(.center)
      if let action, let perform {
        Button(action, action: perform).buttonStyle(.wavi).fixedSize()
      }
    }
    .padding(.horizontal, 32)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
  }
}

extension ButtonStyle where Self == WaviButtonStyle {
  static var wavi: WaviButtonStyle { WaviButtonStyle() }
  static func wavi(primary: Bool = false, floating: Bool = false) -> WaviButtonStyle { WaviButtonStyle(primary: primary, floating: floating) }
}

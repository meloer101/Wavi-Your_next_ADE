// 设置 (PRD F22 v1.231; Figma 105C / 105C′ / 105D): the app's own settings, pushed from the avatar button on the session
// list — not the per-session settings of SettingsSheet. Inset groups of rows: 头像, 连接, 外观, 会话, 存储, 关于.
import PhotosUI
import SwiftUI
import UIKit

/// 外观 · 主题: stored as its raw value (`appearance.theme`); 跟随系统 hands the choice back to iOS.
enum AppTheme: String, CaseIterable, Identifiable {
  case system, light, dark

  var id: String { rawValue }

  /// What `.preferredColorScheme` takes: nil follows the system.
  var scheme: ColorScheme? {
    switch self {
    case .system: nil
    case .light: .light
    case .dark: .dark
    }
  }

  var label: String {
    switch self {
    case .system: String(localized: "跟随系统")
    case .light: String(localized: "浅色")
    case .dark: String(localized: "深色")
    }
  }
}

/// 会话 · 启动时打开: the tab the app opens on (`start.tab`).
enum StartTab: String, CaseIterable, Identifiable {
  case sessions, board

  var id: String { rawValue }

  var tab: RootTab { self == .board ? .board : .sessions }

  var label: String { self == .board ? String(localized: "看板") : String(localized: "会话") }

  /// The stored choice; a value this version does not know (or none) opens 会话.
  static func stored(_ raw: String?) -> StartTab { raw.flatMap(StartTab.init(rawValue:)) ?? .sessions }

  static var current: StartTab { stored(UserDefaults.standard.string(forKey: "start.tab")) }
}

/// The cache's size as the row shows it: `12 MB`.
func cacheSizeText(_ bytes: Int64) -> String {
  let formatter = ByteCountFormatter()
  formatter.countStyle = .file
  formatter.allowedUnits = [.useKB, .useMB, .useGB]
  formatter.allowsNonnumericFormatting = false
  return formatter.string(fromByteCount: bytes)
}

struct AppSettingsView: View {
  @Environment(AppModel.self) private var model
  @AppStorage("appearance.theme") private var theme: AppTheme = .system
  @AppStorage("start.tab") private var startTab: StartTab = .sessions
  @AppStorage("activity.enabled") private var activityEnabled = true
  @AppStorage("haptics.enabled") private var haptics = true
  @State private var pickingAvatar = false
  @State private var avatarMenu = false
  @State private var avatarItem: PhotosPickerItem?
  @State private var avatarFailed = false
  @State private var unpairing = false
  @State private var clearing = false
  @State private var cacheBytes: Int64?

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        block(nil) { avatarRow }
        block(String(localized: "连接")) {
          Line(label: "Mac", value: model.macName)
          Hairline()
          Line(label: String(localized: "连接"), value: connectionDetail(model.link, words: model.connection))
          Hairline()
          Button { unpairing = true } label: { Line(label: String(localized: "取消配对"), danger: true) }.buttonStyle(RowStyle())
        }
        block(String(localized: "外观")) {
          Menu {
            Picker(String(localized: "主题"), selection: $theme) {
              ForEach(AppTheme.allCases) { Text($0.label).tag($0) }
            }
            .pickerStyle(.inline)
          } label: {
            Line(label: String(localized: "主题"), value: theme.label) { Icon("chevron-down", size: 14).foregroundStyle(Color.textSecondary) }
          }
          .buttonStyle(RowStyle())
          .accessibilityValue(theme.label)
          Hairline()
          Button {
            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
          } label: {
            Line(label: String(localized: "语言")) { Icon("external-link", size: 14).foregroundStyle(Color.textPrimary) }
          }
          .buttonStyle(RowStyle())
        }
        block(String(localized: "会话")) {
          Menu {
            Picker(String(localized: "启动时打开"), selection: $startTab) {
              ForEach(StartTab.allCases) { Text($0.label).tag($0) }
            }
            .pickerStyle(.inline)
          } label: {
            Line(label: String(localized: "启动时打开"), value: startTab.label) { Icon("chevron-down", size: 14).foregroundStyle(Color.textSecondary) }
          }
          .buttonStyle(RowStyle())
          .accessibilityValue(startTab.label)
          Hairline()
          Toggle(String(localized: "灵动岛和锁屏卡片"), isOn: $activityEnabled).toggleStyle(SwitchRowStyle())
          Hairline()
          Toggle(String(localized: "触感反馈"), isOn: $haptics).toggleStyle(SwitchRowStyle())
        }
        block(String(localized: "存储")) {
          Button { clearing = true } label: {
            Line(label: String(localized: "清除本机缓存"), value: cacheBytes.map(cacheSizeText))
          }
          .buttonStyle(RowStyle())
        }
        block(String(localized: "关于")) {
          Line(label: String(localized: "版本"), value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "–")
          Hairline()
          Line(label: String(localized: "协议"), value: "\(Shared.data.protocol)")
        }
      }
      .padding(.horizontal, Metric.margin)
      .padding(.top, 8)
      .padding(.bottom, 34)
    }
    .background(Color.bgApp)
    .navigationTitle("设置")
    // The tab bar belongs to the two lists: a page pushed from one hides it, like the session page.
    .toolbarVisibility(.hidden, for: .tabBar)
    .navigationBarTitleDisplayMode(.inline)
    .task { await loadSize() }
    .onChange(of: activityEnabled) { model.activitySwitchChanged() }
    .confirmationDialog(model.macName, isPresented: $unpairing, titleVisibility: .visible) {
      Button("取消配对", role: .destructive) { model.forget() }
    }
    .confirmationDialog("清除本机缓存", isPresented: $clearing, titleVisibility: .visible) {
      Button("清除", role: .destructive) {
        Task {
          await PhoneCache.shared.wipe()
          await loadSize()
        }
      }
    }
    .confirmationDialog("头像", isPresented: $avatarMenu) {
      Button("更换") { pickingAvatar = true }
      Button("去掉", role: .destructive) { MyAvatar.shared.remove() }
    }
    .photosPicker(isPresented: $pickingAvatar, selection: $avatarItem, matching: .images)
    .onChange(of: avatarItem) { _, item in
      guard let item else { return }
      avatarItem = nil
      Task {
        let data = try? await item.loadTransferable(type: Data.self)
        if let data, await MyAvatar.shared.set(data) { return }
        avatarFailed = true
      }
    }
    .alert("这张照片没有设成头像", isPresented: $avatarFailed) { Button("好", role: .cancel) {} }
  }

  private var avatarRow: some View {
    Button {
      if MyAvatar.shared.image == nil { pickingAvatar = true } else { avatarMenu = true }
    } label: {
      Line(label: String(localized: "头像"), avatar: true) { Icon("chevron-right", size: 14).foregroundStyle(Color.textSecondary) }
    }
    .buttonStyle(RowStyle())
    .accessibilityValue(MyAvatar.shared.image == nil ? String(localized: "未设置") : String(localized: "已设置"))
  }

  private func loadSize() async {
    cacheBytes = await Task.detached { PhoneCache.shared.size() }.value
  }

  /// A group under its small label (none for the first): the rows are drawn straight into it.
  private func block<Rows: View>(_ title: String?, @ViewBuilder rows: () -> Rows) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      if let title { Text(title).font(.ui(.footnote)).foregroundStyle(Color.textSecondary).padding(.leading, 16) }
      VStack(spacing: 0) { rows() }
        .frame(maxWidth: .infinity)
        .background(Color.bgGrouped, in: RoundedRectangle(cornerRadius: Metric.radiusGroup))
        .clipShape(RoundedRectangle(cornerRadius: Metric.radiusGroup))
    }
  }
}

/// My picture, or the user-round mark on the subtle fill when none is set (Figma 105C's 头像 row, 105A's button).
struct AvatarDisc: View {
  let size: CGFloat

  var body: some View {
    Group {
      if let image = MyAvatar.shared.image {
        Image(uiImage: image).resizable().scaledToFill()
      } else {
        Color.fillStrong.overlay { Icon("user-round", size: size / 2).foregroundStyle(Color.textPrimary) }
      }
    }
    .frame(width: size, height: size)
    .clipShape(Circle())
  }
}

/// One row of a group: the label, its value, then what ends the row (chevron, link mark); `avatar` puts my picture first.
private struct Line<Trailing: View>: View {
  let label: String
  var value: String?
  var danger = false
  var avatar = false
  @ViewBuilder var trailing: Trailing

  var body: some View {
    HStack(spacing: 8) {
      if avatar { AvatarDisc(size: 36) }
      Text(label).font(.ui(.callout)).foregroundStyle(danger ? Color.noticeDanger : Color.textPrimary).frame(maxWidth: .infinity, alignment: .leading)
      if let value { Text(value).font(.ui(.callout)).foregroundStyle(Color.textSecondary).lineLimit(2).multilineTextAlignment(.trailing) }
      trailing
    }
    .padding(.leading, 16)
    .padding(.trailing, 12)
    .frame(minHeight: 52)
    .contentShape(Rectangle())
  }
}

extension Line where Trailing == EmptyView {
  init(label: String, value: String? = nil, danger: Bool = false) {
    self.init(label: label, value: value, danger: danger, trailing: { EmptyView() })
  }
}

private struct Hairline: View {
  var body: some View { Rectangle().fill(Color.hairline).frame(height: 1).padding(.leading, 16) }
}

/// The switch of Figma 105C: 51 × 31, on = the solid fill with the solid-on knob (the app's tint is the text colour, no
/// green); off = the strong fill with the text-colour knob. The whole row toggles.
private struct SwitchRowStyle: ToggleStyle {
  func makeBody(configuration: Configuration) -> some View {
    Button { configuration.isOn.toggle() } label: {
      HStack(spacing: 8) {
        configuration.label.font(.ui(.callout)).foregroundStyle(Color.textPrimary).frame(maxWidth: .infinity, alignment: .leading)
        ZStack(alignment: configuration.isOn ? .trailing : .leading) {
          Capsule().fill(configuration.isOn ? Color.solidFill : Color.fillStrong)
          Circle().fill(configuration.isOn ? Color.solidOn : Color.textPrimary).padding(2)
        }
        .frame(width: 51, height: 31)
        .animation(.snappy(duration: 0.2), value: configuration.isOn)
      }
      .padding(.leading, 16)
      .padding(.trailing, 12)
      .frame(minHeight: 52)
      .contentShape(Rectangle())
    }
    .buttonStyle(RowStyle())
    .accessibilityRepresentation { Toggle(isOn: configuration.$isOn) { configuration.label } }
  }
}

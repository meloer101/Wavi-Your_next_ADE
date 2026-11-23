// The English beside the Chinese (Resources/Localizable.xcstrings, Chinese keys): the built app carries an English
// table that answers the Chinese keys, counts take English plurals, and the language the Mac is told is zh or en. The
// scheme runs the other tests in Chinese, so the English table is read here directly.
import Foundation
import Testing
@testable import Wavi

private let english: Bundle? = Bundle.main.path(forResource: "en", ofType: "lproj").flatMap(Bundle.init(path:))

private func en(_ key: String) -> String { english?.localizedString(forKey: key, value: "∅", table: nil) ?? "∅" }

@Suite struct LocalizationTests {
  @Test func theAppDeclaresBothLanguages() {
    #expect(Set(Bundle.main.localizations).isSuperset(of: ["zh-Hans", "en"]))
    #expect(english != nil)
  }

  @Test func englishAnswersTheChineseKeys() {
    #expect(en("会话") == "Sessions")
    #expect(en("等你处理") == "Needs you")
    #expect(en("等你确认") == "Needs approval")
    #expect(en("已等 %@") == "waiting %@")
    #expect(en("还没有 PR · %@ 有分支保护") == "No PR yet · %@ is protected")
    #expect(en("在后台继续") == "Continue in background")
    #expect(en("展开") == "Show more")
    #expect(en("收起") == "Show less")
    // Figma 100's plan sheet, the same words as the Mac's plan card.
    #expect(en("等你确认计划") == "Confirm plan")
    #expect(en("批准并自动接受编辑") == "Approve and auto-accept edits")
    #expect(en("批准，编辑时问我") == "Approve, ask before edits")
    #expect(en("继续规划") == "Keep planning")
    #expect(en("计划：%@") == "Plan: %@")
  }

  @Test func englishCountsArePlural() {
    // With English plural rules: the scheme's Chinese has one form only.
    let english = Locale(identifier: "en")
    let format = en("%lld 个文件")
    #expect(String(format: format, locale: english, 1) == "1 file")
    #expect(String(format: format, locale: english, 5) == "5 files")
    #expect(String(format: en("%lld 个提交"), locale: english, 3) == "3 commits")
  }

  @Test func noEnglishValueIsLeftInChinese() throws {
    let url = try #require(english?.url(forResource: "Localizable", withExtension: "strings"))
    let table = try #require(NSDictionary(contentsOf: url) as? [String: String])
    #expect(table.count > 100)
    let chinese = table.filter { $0.value.unicodeScalars.contains { (0x4E00...0x9FFF).contains($0.value) } }
    #expect(chinese.isEmpty, "\(chinese.keys.sorted())")
  }

  /// English is the development region (a phone in neither language gets English), so a key without its own
  /// zh-Hans value would show Chinese users the English: the Chinese table answers every key the English one does.
  @Test func chineseAnswersEveryKey() throws {
    let chinese = try #require(Bundle.main.path(forResource: "zh-Hans", ofType: "lproj").flatMap(Bundle.init(path:)))
    let url = try #require(english?.url(forResource: "Localizable", withExtension: "strings"))
    let keys = try #require(NSDictionary(contentsOf: url) as? [String: String]).keys
    let missing = keys.filter { chinese.localizedString(forKey: $0, value: "∅", table: nil) == "∅" }
    #expect(missing.isEmpty, "\(missing.sorted())")
  }

  @Test func theMacIsToldZhOrEn() {
    #expect(AppLanguage(localization: "zh-Hans") == .zh)
    #expect(AppLanguage(localization: "zh-Hant-TW") == .zh)
    #expect(AppLanguage(localization: "en") == .en)
    #expect(AppLanguage(localization: "en-GB") == .en)
    #expect(AppLanguage(localization: "ja") == .en)
    // The scheme runs the tests in Chinese.
    #expect(AppLanguage.current == .zh)
  }

  @Test func sharedWordsComeInBothLanguages() {
    #expect(Shared.data.statusLabel["zh"]?["needs_you"] == "等你处理")
    #expect(Shared.data.statusLabel["en"]?.keys.sorted() == Shared.data.statusLabel["zh"]?.keys.sorted())
    #expect(Shared.agent("shell").names.keys.sorted() == ["en", "zh"])
    #expect(Shared.agent("claude").name == "Claude Code")
  }

  /// Every Chinese string used as UI text in the app's sources is a catalog key: a missing one shows Chinese on an English
  /// phone (SwiftUI's own `Text("…")` and `String(localized:)` look the literal up). Literals with an interpolation are
  /// compared with the catalog's placeholders (`%lld`, `%@`, `%1$@`) and the interpolations both replaced by one mark.
  @Test func everyChineseUiLiteralIsACatalogKey() throws {
    let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
    let catalogData = try Data(contentsOf: root.appendingPathComponent("Wavi/Resources/Localizable.xcstrings"))
    let catalog = try #require(JSONSerialization.jsonObject(with: catalogData) as? [String: Any])
    let strings = try #require(catalog["strings"] as? [String: Any])
    func normal(_ text: String) -> String {
      text.replacingOccurrences(of: "\\n", with: "\n")
        .replacingOccurrences(of: "%[0-9]*\\$?(lld|@|d)", with: "\u{1}", options: .regularExpression)
        .replacingOccurrences(of: "\\\\\\((?:[^()]|\\((?:[^()]|\\([^()]*\\))*\\))*\\)", with: "\u{1}", options: .regularExpression)
    }
    let keys = Set(strings.keys.map(normal))
    let literal = try NSRegularExpression(
      pattern: "(?:\\b(?:Text|Label|Picker|LabeledContent|Section|Button|TextField|Toggle|Menu|accessibilityLabel|navigationTitle)\\(|String\\(localized: )\\s*\"((?:[^\"\\\\]|\\\\.)*[\\x{4E00}-\\x{9FFF}](?:[^\"\\\\]|\\\\.)*)\"")
    let files = try #require(FileManager.default.enumerator(at: root.appendingPathComponent("Wavi"), includingPropertiesForKeys: nil))
    var missing: [String] = []
    var scanned = 0
    for case let file as URL in files where file.pathExtension == "swift" {
      let source = try String(contentsOf: file, encoding: .utf8)
      scanned += 1
      for match in literal.matches(in: source, range: NSRange(source.startIndex..., in: source)) {
        guard let range = Range(match.range(at: 1), in: source) else { continue }
        let text = String(source[range])
        // An interpolation holding its own string literal cuts the match short: those are not checked.
        if normal(text).contains("\\(") { continue }
        if !keys.contains(normal(text)) { missing.append("\(file.lastPathComponent): \(text)") }
      }
    }
    #expect(scanned > 20)
    #expect(missing.isEmpty, "\(missing.sorted())")
  }
}

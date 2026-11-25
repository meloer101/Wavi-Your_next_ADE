// What the Mac last said, kept on the phone (PRD F22 v1.220 ④; Figma 62B, 62F and 63B3): the session list as of when it
// arrived, and per session the newest 200 items of its conversation, so opening the app while the Mac is off shows the
// list and the conversation it showed before instead of nothing. Scoped to the pairing it belongs to (a digest of that
// pairing's secret), so another Mac's data never shows and 取消配对 leaves nothing behind. The Mac's full session list
// prunes the conversations of sessions it no longer has. The files hold a conversation:
// readable only after the first unlock (a background wake still reads the pairing) and never in a backup. Writes are
// coalesced — a streamed frame does not write — and happen off the main actor; reads are small and taken on the main
// actor, at a cold start and when a session opens.
import CryptoKit
import Foundation

extension RemoteSession {
  /// The same session without the exit it was in the middle of: a list kept on disk can be hours old, and a 提交 / 合并 /
  /// 推送 it showed then may be over. The Mac's snapshot sends the exit again if it still runs (PRD v1.223).
  var withoutShip: RemoteSession {
    RemoteSession(id: id, projectId: projectId, title: title, agent: agent, status: status, action: action, since: since,
      activity: activity, branch: branch, model: model, reply: reply, ship: nil, shipNotice: shipNotice, settings: settings)
  }
}

final class PhoneCache: Sendable {
  /// One session's conversation as last written: items `start` … `start + items.count - 1`, the newest ones the phone
  /// has seen.
  struct Conversation: Codable, Sendable, Equatable {
    var start: Int
    var items: [ChatItem]
  }

  /// The session list as last heard, with when (ms): the age the notice over a stale list reads (62B).
  struct Sessions: Codable, Sendable, Equatable {
    var heardAt: Double
    var list: RemoteSessionList
  }

  /// How many of a conversation's newest items are kept.
  static let items = 200
  /// A write happens this long after the last change: a burst of streamed frames writes once.
  static let debounce: Duration = .seconds(1)

  static let shared = PhoneCache()

  private let root: URL
  private let sink = Sink()

  /// `root`: where this app's cache lives (`Application Support/Wavi/Remote`); a test passes its own folder.
  init(root: URL = PhoneCache.defaultRoot) { self.root = root }

  /// `<userData>/Library/Application Support/Wavi/Remote`: nothing in the documents folder, which a device restore puts
  /// back.
  static var defaultRoot: URL {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    return base.appendingPathComponent("Wavi", isDirectory: true).appendingPathComponent("Remote", isDirectory: true)
  }

  /// The pairing's own folder name: the secret's digest. Each pairing has its own secret, so pairing another Mac (or
  /// pairing this one again) starts from its own empty folder.
  static func scope(_ pairing: Pairing) -> String {
    digest(WaviCrypto.fromB64u(pairing.secret) ?? Data(pairing.secret.utf8), count: 32)
  }

  /// A conversation's file name: the session id's own characters (ids are hex-ish), then a digest of the whole id so two
  /// ids that escape to the same characters never share a file.
  static func name(_ session: String) -> String {
    let allowed = Set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")
    let safe = String(session.prefix(64).map { allowed.contains($0) ? $0 : "_" })
    return "\(safe)-\(digest(Data(session.utf8), count: 8)).json"
  }

  private static func digest(_ data: Data, count: Int) -> String {
    String(SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined().prefix(count))
  }

  func folder(_ scope: String) -> URL { root.appendingPathComponent(scope, isDirectory: true) }

  private func sessionsFile(_ scope: String) -> URL { folder(scope).appendingPathComponent("sessions.json") }

  private func feedFile(_ scope: String, _ session: String) -> URL {
    folder(scope).appendingPathComponent("feed", isDirectory: true).appendingPathComponent(PhoneCache.name(session))
  }

  // MARK: - reading

  /// The list the Mac last sent, or nil when nothing was written yet (63B3).
  func sessions(_ scope: String?) -> Sessions? {
    guard let scope, let data = try? Data(contentsOf: sessionsFile(scope)) else { return nil }
    return try? JSONDecoder().decode(Sessions.self, from: data)
  }

  /// The newest items of a session's conversation the phone has seen, or nil when it never had them.
  func conversation(_ scope: String?, _ session: String) -> Conversation? {
    guard let scope, let data = try? Data(contentsOf: feedFile(scope, session)) else { return nil }
    return try? JSONDecoder().decode(Conversation.self, from: data)
  }

  /// A feed as the cache keeps it: its newest `items`, the start moved up so the last item keeps its index.
  static func capped(_ feed: Feed) -> Conversation {
    let kept = feed.items.suffix(items)
    return Conversation(start: feed.start + feed.items.count - kept.count, items: Array(kept))
  }

  // MARK: - writing

  func saveSessions(_ list: RemoteSessionList, heardAt: Double, scope: String?) {
    guard let scope, let data = try? JSONEncoder().encode(Sessions(heardAt: heardAt, list: list)) else { return }
    sink.add(data, to: sessionsFile(scope))
  }

  func saveConversation(_ feed: Feed, scope: String?, session: String) {
    guard let scope, let data = try? JSONEncoder().encode(PhoneCache.capped(feed)) else { return }
    sink.add(data, to: feedFile(scope, session))
  }

  /// The pairing is gone (取消配对, the user's own action): its folder goes now, and neither the writes still waiting for it
  /// nor a late one bring it back — the pairing is over. A Mac that says it does not know this phone keeps its files
  /// (`clear` is not called then): the pairing is kept, and the user decides (PRD v1.223).
  func clear(_ scope: String) { sink.clear(folder(scope)) }

  /// Every pairing's folder (a test's clean-up; the app clears one pairing at a time).
  func clearAll() { sink.clear(root) }

  /// 清除本机缓存 (设置 · 存储): everything cached, for every pairing, goes — the lists and the conversations, not the
  /// pairing itself (Keychain). Unlike `clear` / `clearAll` this does not block the folder: what the Mac says next is
  /// cached again.
  func wipe() async { await Task.detached { [sink, root] in sink.wipe(root) }.value }

  /// What the cache takes on disk, in bytes (the number next to 清除本机缓存). Reads the folder: off the main actor.
  func size() -> Int64 {
    let keys: [URLResourceKey] = [.totalFileAllocatedSizeKey, .isRegularFileKey]
    guard let files = FileManager.default.enumerator(at: root, includingPropertiesForKeys: keys) else { return 0 }
    var total: Int64 = 0
    for case let url as URL in files {
      guard let values = try? url.resourceValues(forKeys: Set(keys)), values.isRegularFile == true else { continue }
      total += Int64(values.totalFileAllocatedSize ?? 0)
    }
    return total
  }

  /// Writes what is waiting now and returns once it is on disk (a test waits for this; the app never has to).
  func flush() async { await Task.detached { [sink] in sink.drain() }.value }

  /// The Mac's full list: sessions it no longer has cannot be opened again, so their cached conversations go, together with
  /// writes still waiting for them. (A session that comes back to the list can be cached again: unlike 取消配对 this is not
  /// final.)
  func prune(_ list: RemoteSessionList, scope: String?) async {
    guard let scope else { return }
    let feed = folder(scope).appendingPathComponent("feed", isDirectory: true)
    let keep = Set(list.sessions.map { PhoneCache.name($0.id) })
    await Task.detached { [sink] in sink.prune(feed, keep: keep) }.value
  }

  /// The writes not yet on disk (one per file), the timer of the current burst, and the folders that were cleared. One lock
  /// holds all of it, and every write and deletion happens under it: a file cannot be created inside a folder that a
  /// 取消配对 or a prune has just removed, because neither the folder nor the write can move between the two.
  private final class Sink: @unchecked Sendable {
    private let lock = NSLock()
    private var pending: [URL: Data] = [:]
    private var timer: Task<Void, Never>?
    /// Folders of pairings that ended: nothing is written under them again (each pairing has its own, so a new one never
    /// lands here).
    private var cleared: [String] = []

    func add(_ data: Data, to url: URL) {
      lock.lock()
      defer { lock.unlock() }
      // The pairing ended while this write was on its way: it must not bring the folder back.
      guard !cleared.contains(where: { url.path.hasPrefix($0) }) else { return }
      pending[url] = data
      // One timer for a burst: the first change starts it, the rest ride along.
      guard timer == nil else { return }
      timer = Task.detached { [self] in
        try? await Task.sleep(for: PhoneCache.debounce)
        guard !Task.isCancelled else { return }
        drain()
      }
    }

    /// Every waiting write, off the caller's actor (the file work is what takes the time). The lock is held across the
    /// writes: a clear or a prune that arrives meanwhile waits, instead of deleting a folder that is being written into.
    func drain() {
      lock.lock()
      defer { lock.unlock() }
      timer = nil
      let writes = pending
      pending.removeAll()
      for (url, data) in writes { PhoneCache.write(data, to: url) }
    }

    /// 取消配对: the waiting writes for this pairing are dropped and the folder is deleted, under the one lock — and nothing
    /// is written under it again.
    func clear(_ folder: URL) {
      lock.lock()
      defer { lock.unlock() }
      pending = pending.filter { !$0.key.path.hasPrefix(folder.path) }
      if pending.isEmpty {
        timer?.cancel()
        timer = nil
      }
      cleared.append(folder.path)
      try? FileManager.default.removeItem(at: folder)
    }

    /// 清除本机缓存: the waiting writes and every file go, under the one lock; nothing is blocked afterwards.
    func wipe(_ root: URL) {
      lock.lock()
      defer { lock.unlock() }
      pending.removeAll()
      timer?.cancel()
      timer = nil
      try? FileManager.default.removeItem(at: root)
    }

    /// The Mac's list: the waiting writes for sessions it does not have are dropped, and so are their files, under the one
    /// lock. Unlike `clear` this does not block the folder: a session that comes back is cached again.
    func prune(_ feed: URL, keep: Set<String>) {
      lock.lock()
      defer { lock.unlock() }
      pending = pending.filter { url, _ in
        !url.path.hasPrefix(feed.path) || keep.contains(url.lastPathComponent)
      }
      if pending.isEmpty {
        timer?.cancel()
        timer = nil
      }
      guard let names = try? FileManager.default.contentsOfDirectory(atPath: feed.path) else { return }
      for name in names where !keep.contains(name) {
        try? FileManager.default.removeItem(at: feed.appendingPathComponent(name))
      }
    }
  }

  /// Written whole (half a file never loads), readable only after the first unlock, out of a backup.
  private nonisolated static func write(_ data: Data, to url: URL) {
    let manager = FileManager.default
    do {
      try manager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true,
        attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
      try data.write(to: url, options: .atomic)
      try manager.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: url.path)
      var mutable = url
      var values = URLResourceValues()
      values.isExcludedFromBackup = true
      try mutable.setResourceValues(values)
    } catch {
      // No cache is not something the user can act on: the next change tries again, and without it the app shows what a
      // fresh install shows (63B3).
    }
  }
}

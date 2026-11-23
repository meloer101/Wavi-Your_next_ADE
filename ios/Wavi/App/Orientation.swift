// Which way the interface may turn (PRD F22 v1.227 ②): 看板 · 进度 is the one screen that may be landscape (Figma 103′C,
// five columns side by side); the session list, a session, the GitHub pages, pairing, settings and every sheet stay
// portrait. The app delegate answers iOS with `mask`, and `apply` makes the interface follow when the phone is already
// held sideways — iOS 26 has no SwiftUI modifier for this, so the mask comes from UIKit.
import UIKit

enum Orientation {
  /// Set by RootView from the tab, the board's page and whether the board is at its root; read by the app delegate on
  /// the main thread, written there too.
  nonisolated(unsafe) static var allowsLandscape = false

  static var mask: UIInterfaceOrientationMask { allowsLandscape ? .allButUpsideDown : .portrait }

  /// A tab, a page or a push changed which way the screen may turn.
  @MainActor static func apply(_ allowed: Bool) {
    guard allowed != allowsLandscape else { return }
    allowsLandscape = allowed
    for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
      // The mask alone would only take effect on the next turn; asking the scene turns it now (and back to portrait
      // when the board goes away while the phone is still held sideways).
      scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask)) { _ in }
      scene.keyWindow?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
    }
  }
}

/// Answers iOS's orientation question with the mask above (the app is SwiftUI; this is the one UIKit hook it needs).
final class AppDelegate: NSObject, UIApplicationDelegate {
  func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
    Orientation.mask
  }
}

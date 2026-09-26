import AppKit
import ApplicationServices
import CryptoKit
import Foundation

private struct ProfileWindow {
    let application: NSRunningApplication
    let app: AXUIElement
    let window: AXUIElement
    let hash: String
}

private func urlHash(_ value: String) -> String {
    SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
}

private func profileWindow(_ hashes: Set<String>) throws -> ProfileWindow {
    var candidates: [ProfileWindow] = []
    var occurrences: [String: Int] = [:]
    for application in NSRunningApplication.runningApplications(withBundleIdentifier: "com.google.Chrome") {
        let app = AXUIElementCreateApplication(application.processIdentifier)
        var rawWindows: CFTypeRef?
        let status = AXUIElementCopyAttributeValue(app, "AXWindows" as CFString, &rawWindows)
        guard status == .success else { throw HelperFailure("Cannot inspect Chrome windows (AX \(status.rawValue))") }
        for window in (rawWindows as? [AXUIElement]) ?? [] {
            let areas = try snapshot(window, descendIntoWeb: false).filter { $0.role == "AXWebArea" }
            for area in areas {
                let hash = urlHash(string(area.element, "AXURL"))
                if hashes.contains(hash) {
                    occurrences[hash, default: 0] += 1
                    candidates.append(ProfileWindow(application: application, app: app, window: window, hash: hash))
                }
            }
        }
    }
    let unique = candidates.filter { occurrences[$0.hash] == 1 }
    guard !unique.isEmpty else {
        throw HelperFailure("No Chrome window uniquely matches an active tab of the connected Bridge profile; no browser input was sent")
    }
    let focused = unique.filter { candidate in
        guard let window = attribute(candidate.app, "AXFocusedWindow") else { return false }
        return CFEqual(window, candidate.window)
    }
    if focused.count == 1 { return focused[0] }
    return unique.sorted { $0.hash < $1.hash }[0]
}

private func postKey(_ code: CGKeyCode, flags: CGEventFlags) throws {
    guard let source = CGEventSource(stateID: .hidSystemState),
          let down = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true),
          let up = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false) else {
        throw HelperFailure("Cannot create Chrome's fixed management shortcut")
    }
    down.flags = flags
    up.flags = flags
    down.post(tap: .cghidEventTap)
    Thread.sleep(forTimeInterval: 0.004)
    up.post(tap: .cghidEventTap)
}

func prepareExtensionsPage(activeURLHashes: [String]) throws -> String {
    guard !activeURLHashes.isEmpty,
          activeURLHashes.allSatisfy({ $0.range(of: "^[0-9a-f]{64}$", options: .regularExpression) != nil }) else {
        throw HelperFailure("Expected active-tab SHA-256 hashes from one Bridge profile")
    }
    let target = try profileWindow(Set(activeURLHashes))
    _ = target.application.activate(options: [])
    let front = AXUIElementSetAttributeValue(target.app, "AXFrontmost" as CFString, kCFBooleanTrue)
    let raised = AXUIElementPerformAction(target.window, "AXRaise" as CFString)
    guard front == .success, raised == .success else {
        throw HelperFailure("Cannot focus the verified Bridge-profile window (AX \(front.rawValue)/\(raised.rawValue)); no keyboard input was sent")
    }
    _ = try waitFor("verified Chrome window focus", seconds: 2) { () -> Bool? in
        guard focusedApplicationPID() == target.application.processIdentifier,
              let focused = attribute(target.app, "AXFocusedWindow"),
              CFEqual(focused, target.window) else { return nil }
        return true
    }
    try postKey(17, flags: [.maskCommand]) // 固定の新規タブ操作だけを送る。
    let address = try waitFor("new tab address bar focus", seconds: 3) { () -> AXNode? in
        guard focusedApplicationPID() == target.application.processIdentifier,
              let focused = attribute(AXUIElementCreateSystemWide(), "AXFocusedUIElement") else { return nil }
        let fields = try snapshot(target.window, descendIntoWeb: false).filter {
            $0.role == "AXTextField" && $0.named(["Address and search bar", "アドレス検索バー"])
        }
        guard fields.count <= 1 else { throw HelperFailure("Ambiguous Chrome address bar") }
        return fields.first.flatMap { CFEqual(focused, $0.element) ? $0 : nil }
    }
    let token = UUID().uuidString.lowercased()
    let url = "chrome://extensions/?chromeOps=\(token)"
    guard AXUIElementSetAttributeValue(address.element, "AXValue" as CFString, url as CFString) == .success,
          string(address.element, "AXValue") == url else {
        throw HelperFailure("Could not set the fixed Chrome extensions URL")
    }
    guard let focused = attribute(AXUIElementCreateSystemWide(), "AXFocusedUIElement"),
          CFEqual(focused, address.element),
          focusedApplicationPID() == target.application.processIdentifier else {
        throw HelperFailure("Chrome address bar lost focus; no navigation key was sent")
    }
    try postKey(36, flags: [])
    _ = try selectedPage(token)
    return token
}

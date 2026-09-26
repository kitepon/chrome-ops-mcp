import AppKit
import ApplicationServices
import Foundation

// Chromium builds its web accessibility tree on demand. Preserve an existing AT
// session and restore only the app attributes enabled by this invocation.
final class ChromeAccessibilitySession {
    private var enabled: [AXUIElement] = []
    init() throws {
        for application in NSRunningApplication.runningApplications(withBundleIdentifier: "com.google.Chrome") {
            let app = AXUIElementCreateApplication(application.processIdentifier)
            _ = string(app, "AXRole")
            if elements(app, "AXWindows").isEmpty { continue }
            if (attribute(app, "AXEnhancedUserInterface") as? Bool) == true { continue }
            let result = AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
            guard result == .success else {
                restore()
                throw HelperFailure("Cannot enable Chrome's web Accessibility tree (AX error \(result.rawValue))")
            }
            enabled.append(app)
        }
        // Chromium debounces this AT request for two seconds on modern macOS.
        if !enabled.isEmpty { Thread.sleep(forTimeInterval: 2.2) }
    }
    func restore() {
        for app in enabled { _ = AXUIElementSetAttributeValue(app, "AXEnhancedUserInterface" as CFString, kCFBooleanFalse) }
        enabled.removeAll()
    }
}

func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var result: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &result) == .success ? result : nil
}

func string(_ element: AXUIElement, _ name: String) -> String {
    if let result = attribute(element, name) as? String { return result }
    if let result = attribute(element, name) as? URL { return result.absoluteString }
    return ""
}

func elements(_ element: AXUIElement, _ name: String = "AXChildren") -> [AXUIElement] {
    (attribute(element, name) as? [AXUIElement]) ?? []
}

struct AXNode {
    let element: AXUIElement
    let parent: Int?
    let role: String
    let subrole: String
    let title: String
    let value: String
    let detail: String
    let identifier: String
    var labels: [String] { [title, value, detail].filter { !$0.isEmpty } }
    var enabled: Bool { (attribute(element, "AXEnabled") as? Bool) != false }
    func named(_ names: [String]) -> Bool { labels.contains { names.contains($0) } }
}

// Bound a single snapshot. Do not dump arbitrary browser tabs or silently truncate a tree.
// The open panel's file list can hold hundreds of rows. Picker controls never live inside it, and walking it
// on every poll made Load unpacked take over a minute.
let pickerFileListRoles: Set<String> = ["AXOutline", "AXBrowser", "AXTable", "AXList"]

func snapshot(_ root: AXUIElement, descendIntoWeb: Bool = true, skipping skipped: Set<String> = []) throws -> [AXNode] {
    var nodes: [AXNode] = []
    func visit(_ element: AXUIElement, parent: Int?, depth: Int) throws {
        guard nodes.count < 12000, depth < 60 else { throw HelperFailure("Accessibility tree exceeded the inspection budget") }
        let role = string(element, "AXRole")
        let index = nodes.count
        nodes.append(AXNode(element: element, parent: parent, role: role,
                            subrole: string(element, "AXSubrole"), title: string(element, "AXTitle"),
                            value: string(element, "AXValue"), detail: string(element, "AXDescription"),
                            identifier: string(element, "AXIdentifier")))
        if role == "AXWebArea" && !descendIntoWeb { return }
        if skipped.contains(role) { return }
        for child in elements(element) { try visit(child, parent: index, depth: depth + 1) }
    }
    try visit(root, parent: nil, depth: 0)
    return nodes
}

struct ExtensionsPage {
    let application: NSRunningApplication
    let app: AXUIElement
    let window: AXUIElement
    let web: AXUIElement
}

func extensionPages() throws -> [ExtensionsPage] {
    var pages: [ExtensionsPage] = []
    let applications = NSRunningApplication.runningApplications(withBundleIdentifier: "com.google.Chrome")
    for application in applications {
        let app = AXUIElementCreateApplication(application.processIdentifier)
        AXUIElementSetMessagingTimeout(app, 2)
        var rawWindows: CFTypeRef?
        let status = AXUIElementCopyAttributeValue(app, "AXWindows" as CFString, &rawWindows)
        guard status == .success else {
            throw HelperFailure("Cannot read Chrome windows (AX error \(status.rawValue)); check Accessibility permission for the launching app")
        }
        for window in (rawWindows as? [AXUIElement]) ?? [] {
            // Inspect native chrome only until the web area's exact URL is verified.
            let native = try snapshot(window, descendIntoWeb: false)
            for node in native where node.role == "AXWebArea" && isExtensionsURL(string(node.element, "AXURL")) {
                pages.append(ExtensionsPage(application: application, app: app, window: window, web: node.element))
            }
        }
    }
    return pages
}

func selectedPage(_ token: String? = nil) throws -> ExtensionsPage {
    let pages: [ExtensionsPage]
    if let token {
        pages = [try waitFor("Chrome Ops prepared extensions page") { () -> ExtensionsPage? in
            let matches = try extensionPages().filter { page in
                URLComponents(string: string(page.web, "AXURL"))?.queryItems?.contains {
                    $0.name == "chromeOps" && $0.value == token
                } == true
            }
            guard matches.count <= 1 else { throw HelperFailure("Multiple pages carry the Chrome Ops request token") }
            return matches.first
        }]
    } else {
        pages = try extensionPages()
    }
    guard pages.count == 1 else {
        throw HelperFailure(pages.isEmpty
            ? "Select the chrome://extensions tab in Chrome. No visible extensions page was found; other tabs will not be navigated."
            : "Multiple chrome://extensions pages are visible. Leave only the intended profile's extensions page selected.")
    }
    return pages[0]
}

func pageInWindow(_ reference: ExtensionsPage) throws -> ExtensionsPage? {
    let matches = try extensionPages().filter {
        $0.application.processIdentifier == reference.application.processIdentifier &&
            CFEqual($0.window, reference.window)
    }
    guard matches.count <= 1 else { throw HelperFailure("Multiple extension pages appeared in the prepared Chrome window") }
    return matches.first
}

func unique(_ nodes: [AXNode], _ description: String, matching: (AXNode) -> Bool) throws -> AXNode {
    let matches = nodes.filter(matching)
    guard matches.count == 1 else { throw HelperFailure("Expected one \(description); found \(matches.count)") }
    return matches[0]
}

func press(_ node: AXNode) throws {
    guard node.enabled else { throw HelperFailure("Control is disabled: \(node.labels.first ?? node.role)") }
    let result = AXUIElementPerformAction(node.element, "AXPress" as CFString)
    guard result == .success else { throw HelperFailure("AXPress failed (\(result.rawValue))") }
}

func waitFor<T>(_ description: String, seconds: TimeInterval = 5, read: () throws -> T?) throws -> T {
    let deadline = Date().addingTimeInterval(seconds)
    repeat {
        if let result = try read() { return result }
        Thread.sleep(forTimeInterval: 0.12)
    } while Date() < deadline
    throw HelperFailure("Timed out waiting for \(description)")
}

func requireUnobstructed(_ page: ExtensionsPage) throws {
    let nodes = try snapshot(page.window)
    guard !nodes.contains(where: { $0.role == "AXSheet" || $0.role == "AXDialog" || $0.subrole == "AXDialog" }) else {
        throw HelperFailure("Chrome has an open dialog. Resolve it before running a developer operation.")
    }
}

func focus(_ page: ExtensionsPage) throws {
    _ = page.application.activate(options: [])
    let front = AXUIElementSetAttributeValue(page.app, "AXFrontmost" as CFString, kCFBooleanTrue)
    let raised = AXUIElementPerformAction(page.window, "AXRaise" as CFString)
    guard front == .success, raised == .success else {
        throw HelperFailure("Cannot focus the Chrome extensions window (AX \(front.rawValue)/\(raised.rawValue)); no keyboard input was sent")
    }
    _ = try waitFor("Chrome extensions window focus", seconds: 2) { () -> Bool? in
        (try pickerHasFocus(page)) && focusedApplicationPID() == page.application.processIdentifier ? true : nil
    }
}

func pickerHasFocus(_ page: ExtensionsPage) throws -> Bool {
    guard (attribute(page.app, "AXFrontmost") as? Bool) == true,
          let focused = attribute(page.app, "AXFocusedWindow") else { return false }
    if CFEqual(focused, page.window) { return true }
    // NSOpenPanel and its Go to Folder sheet become AXFocusedWindow on macOS.
    // Accept only sheets belonging to this exact, already-validated directory picker.
    guard let panel = try openPanel(page) else { return false }
    return try snapshot(panel.element, skipping: pickerFileListRoles).contains { $0.role == "AXSheet" && CFEqual(focused, $0.element) }
}

func focusedApplicationPID() -> pid_t? {
    guard let focused = attribute(AXUIElementCreateSystemWide(), "AXFocusedApplication"),
          CFGetTypeID(focused) == AXUIElementGetTypeID() else { return nil }
    var pid: pid_t = 0
    guard AXUIElementGetPid(unsafeDowncast(focused, to: AXUIElement.self), &pid) == .success else { return nil }
    return pid
}

// Fixed native picker shortcuts only. This is not an externally configurable input API.
func pickerKey(_ page: ExtensionsPage, field: AXNode, goToFolder: Bool = false) throws {
    let code: CGKeyCode = goToFolder ? 5 : 36 // G or Return
    guard let source = CGEventSource(stateID: .hidSystemState),
          let down = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: true),
          let up = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: false) else {
        throw HelperFailure("Could not create the native picker shortcut")
    }
    let flags: CGEventFlags = goToFolder ? [.maskCommand, .maskShift] : []
    down.flags = flags
    up.flags = flags
    // Deliver to the verified foreground modal, not Chrome's browser process.
    // postToPid(browserPID) routes Cmd-Shift-G to Chrome's Find Previous even
    // while its NSOpenPanel is visible (reproduced on macOS 27).
    guard let panel = try openPanel(page) else {
        throw HelperFailure("The extension picker is missing; no keyboard event was sent")
    }
    var panelPID: pid_t = 0
    let panelStatus = AXUIElementGetPid(panel.element, &panelPID)
    guard panelStatus == .success else { throw HelperFailure("Cannot identify the owned extension picker process") }
    if focusedApplicationPID() != page.application.processIdentifier && focusedApplicationPID() != panelPID {
        // The MCP client can take foreground focus while the owned picker opens.
        // Activate Chrome once, then verify the same picker before sending a key.
        _ = page.application.activate(options: [])
        let front = AXUIElementSetAttributeValue(page.app, "AXFrontmost" as CFString, kCFBooleanTrue)
        guard front == .success else { throw HelperFailure("Cannot refocus the owned extension picker (AX \(front.rawValue)); no keyboard event was sent") }
        _ = try waitFor("owned extension picker focus", seconds: 2) { () -> Bool? in
            guard let activePID = focusedApplicationPID(),
                  activePID == page.application.processIdentifier || activePID == panelPID,
                  try pickerHasFocus(page) else { return nil }
            return true
        }
    }
    guard try pickerHasFocus(page) else {
        throw HelperFailure("The owned extension picker is not focused; no keyboard event was sent")
    }
    let focused = AXUIElementSetAttributeValue(field.element, "AXFocused" as CFString, kCFBooleanTrue)
    guard focused == .success,
          let actual = attribute(AXUIElementCreateSystemWide(), "AXFocusedUIElement"),
          CFEqual(actual, field.element) else {
        throw HelperFailure("Cannot focus the picker input field (AX \(focused.rawValue)); no keyboard event was sent")
    }
    down.post(tap: .cghidEventTap)
    Thread.sleep(forTimeInterval: 0.004)
    up.post(tap: .cghidEventTap)
}

func openPanel(_ page: ExtensionsPage) throws -> AXNode? {
    let matches = try snapshot(page.window, skipping: pickerFileListRoles).filter { $0.role == "AXSheet" && $0.identifier == "open-panel" }
    guard matches.count <= 1 else { throw HelperFailure("Ambiguous extension directory picker") }
    return matches.first
}

func goToFolderSheet(_ panel: AXNode) throws -> AXNode? {
    let matches = try snapshot(panel.element, skipping: pickerFileListRoles).filter { $0.role == "AXSheet" && $0.identifier == "GoToWindow" }
    guard matches.count <= 1 else { throw HelperFailure("Ambiguous Go to Folder sheet") }
    return matches.first
}

// The Go to Folder path field. It sits in a GoToWindow sheet of the panel on some macOS builds; on others
// (seen on macOS 27.0) it is not reachable from the panel tree and is only the focused element of the picker process.
func goToFolderField(_ panel: AXNode) throws -> AXNode? {
    if let sheet = try goToFolderSheet(panel) {
        return try unique(snapshot(sheet.element, skipping: pickerFileListRoles), "Go to Folder path field") {
            $0.role == "AXTextField" && $0.identifier == "PathTextField"
        }
    }
    guard let raw = attribute(AXUIElementCreateSystemWide(), "AXFocusedUIElement"),
          CFGetTypeID(raw) == AXUIElementGetTypeID() else { return nil }
    let focused = unsafeDowncast(raw, to: AXUIElement.self)
    var panelPID: pid_t = 0, focusedPID: pid_t = 0
    guard string(focused, "AXRole") == "AXTextField", string(focused, "AXIdentifier") == "PathTextField",
          AXUIElementGetPid(panel.element, &panelPID) == .success,
          AXUIElementGetPid(focused, &focusedPID) == .success, focusedPID == panelPID else { return nil }
    return AXNode(element: focused, parent: nil, role: "AXTextField", subrole: string(focused, "AXSubrole"),
                  title: "", value: "", detail: "", identifier: "PathTextField")
}

func load(_ request: Request) throws -> [String: Any] {
    let page = try selectedPage(request.pageToken)
    try requireUnobstructed(page)
    let beforeIDs = Set(try snapshot(page.web).flatMap { $0.labels.compactMap(extensionID) })
    let button = try unique(snapshot(page.web), "Load unpacked button") {
        $0.role == "AXButton" && $0.named(["Load unpacked", "パッケージ化されていない拡張機能を読み込む"])
    }
    // Focus before opening the modal. Raising the parent afterward steals the
    // picker input target on macOS.
    try focus(page)
    try press(button)
    let panel = try waitFor("extension directory picker") { try openPanel(page) }
    let panelNodes = try snapshot(panel.element, skipping: pickerFileListRoles)
    guard panelNodes.contains(where: { $0.labels.contains(where: { $0.contains("拡張機能のディレクトリ") || $0.localizedCaseInsensitiveContains("extension directory") }) }) else {
        throw HelperFailure("The open panel is not an extension directory picker")
    }
    let cancel = try unique(panelNodes, "picker cancel button") { $0.role == "AXButton" && $0.identifier == "CancelButton" }
    do {
    let search = try unique(panelNodes, "native picker Search field") {
        $0.role == "AXTextField" && $0.identifier == "Search"
    }
    try pickerKey(page, field: search, goToFolder: true)
    let field = try waitFor("Go to Folder path field") { try goToFolderField(panel) }
    let enteredPath = request.value + "/"
    guard AXUIElementSetAttributeValue(field.element, "AXValue" as CFString, enteredPath as CFString) == .success,
          string(field.element, "AXValue") == enteredPath else { throw HelperFailure("Could not set the validated extension directory") }
    try pickerKey(page, field: field)
    _ = try waitFor("Go to Folder completion") { () -> Bool? in
        try goToFolderField(panel) == nil ? true : nil
    }
    let choose = try unique(snapshot(panel.element, skipping: pickerFileListRoles), "directory selection button") {
        $0.role == "AXButton" && $0.identifier == "OKButton"
    }
    try press(choose)
    _ = try waitFor("directory picker to close") { try openPanel(page) == nil ? true : nil }
    let installedID = try waitFor("new unpacked extension card", seconds: 8) { () -> String? in
        try requireUnobstructed(page)
        let afterIDs = Set(try snapshot(page.web).flatMap { $0.labels.compactMap(extensionID) })
        let added = afterIDs.subtracting(beforeIDs)
        guard added.count <= 1 else { throw HelperFailure("Multiple extensions appeared during Load unpacked") }
        return added.first
    }
    return ["path": request.value, "submitted": true, "extensionId": installedID]
    } catch {
        var cleanup = "The directory picker is closed."
        do {
            if try openPanel(page) != nil {
                try press(cancel)
                _ = try waitFor("failed operation's picker to close") { try openPanel(page) == nil ? true : nil }
                cleanup = "The picker opened by this operation was cancelled."
            }
        } catch {
            cleanup = "Picker cleanup also failed: \(error). Close the extension directory picker before retrying."
        }
        throw HelperFailure("\(error). \(cleanup)")
    }
}

struct ExtensionCard {
    let root: AXUIElement
    let name: String
    let nodes: [AXNode]
}

func card(_ page: ExtensionsPage, id: String) throws -> ExtensionCard {
    let nodes = try snapshot(page.web)
    let anchors = nodes.indices.filter { nodes[$0].labels.contains { extensionID(in: $0) == id } }
    guard anchors.count == 1 else { throw HelperFailure("Expected one exact extension ID \(id); found \(anchors.count). Keep Developer mode enabled.") }
    guard let idGroup = nodes[anchors[0]].parent,
          let listRoot = nodes[idGroup].parent,
          nodes[listRoot].role == "AXGroup" else {
        throw HelperFailure("Could not locate the exact extension ID in a card list")
    }
    let list = try snapshot(nodes[listRoot].element)
    let ids = list.indices.filter { index in list[index].labels.contains { extensionID(in: $0) != nil } }
    let target = ids.filter { index in list[index].labels.contains { extensionID(in: $0) == id } }
    guard target.count == 1 else { throw HelperFailure("Ambiguous exact extension ID in card list") }
    let index = target[0]
    let previous = ids.last(where: { $0 < index }) ?? -1
    let next = ids.first(where: { $0 > index }) ?? list.count
    let names = list[(previous + 1)..<index].filter { $0.role == "AXHeading" && $0.parent == 0 }.flatMap { $0.labels }
    let controls = list[(index + 1)..<next].filter { $0.role == "AXButton" && $0.parent == 0 }
    guard controls.filter({ $0.named(["Remove", "削除"]) }).count == 1,
          controls.filter({ $0.named(["Reload", "再読み込み"]) }).count == 1 else {
        throw HelperFailure("Could not isolate an unpacked extension card by exact ID; no control was invoked")
    }
    return ExtensionCard(root: nodes[listRoot].element, name: names.last ?? "", nodes: controls)
}

func operate(_ request: Request) throws -> [String: Any] {
    if request.operation == .load { return try load(request) }
    var page = try selectedPage(request.pageToken)
    try requireUnobstructed(page)
    let errorTargets = URLComponents(string: string(page.web, "AXURL"))?.queryItems?.filter { $0.name == "errors" } ?? []
    if !errorTargets.isEmpty {
        guard errorTargets.count == 1, errorTargets[0].value == request.value else {
            throw HelperFailure("Chrome is showing another extension's Errors view; no control was invoked")
        }
        let back = try unique(snapshot(page.web), "target Errors view Back button") {
            $0.role == "AXButton" && $0.named(["Back", "戻る"])
        }
        try press(back)
        let original = page
        page = try waitFor("target extension list after Errors view") { () -> ExtensionsPage? in
            guard let current = try pageInWindow(original) else { return nil }
            guard current.application.processIdentifier == original.application.processIdentifier,
                  CFEqual(current.window, original.window),
                  URLComponents(string: string(current.web, "AXURL"))?.queryItems?.contains(where: { $0.name == "errors" }) != true else { return nil }
            return current
        }
        try requireUnobstructed(page)
    }
    let target = try card(page, id: request.value)
    let names: [String]
    switch request.operation {
    case .reload: names = ["Reload", "再読み込み"]
    case .errors: names = ["Errors", "エラー"]
    case .remove: names = ["Remove", "削除"]
    case .load: throw HelperFailure("Invalid dispatch")
    }
    let matches = target.nodes.filter { $0.role == "AXButton" && $0.named(names) }
    if request.operation == .errors && matches.isEmpty {
        return ["extensionId": request.value, "control": "errors", "errors": [], "hasErrorsView": false]
    }
    let control = try unique(matches, "\(request.operation.rawValue) control") { _ in true }
    try press(control)
    switch request.operation {
    case .reload:
        return ["extensionId": request.value, "control": "reload", "submitted": true]
    case .errors:
        let view = try waitFor("target extension Errors view") { () -> [AXNode]? in
            guard let current = try pageInWindow(page) else { return nil }
            guard let url = URLComponents(string: string(current.web, "AXURL")),
                  url.queryItems?.contains(where: { $0.name == "errors" && $0.value == request.value }) == true else { return nil }
            return try snapshot(current.web)
        }
        let messages = view.filter { $0.role == "AXButton" || $0.role == "AXStaticText" }
            .flatMap { $0.labels }.filter { $0.range(of: "Error|failed|ERR_|Exception|エラー", options: .regularExpression) != nil }
        return ["extensionId": request.value, "control": "errors", "errors": Array(Set(messages)).sorted(), "hasErrorsView": true]
    case .remove:
        guard !target.name.isEmpty else { throw HelperFailure("Extension name unavailable; removal confirmation was not accepted") }
        let confirmation = try waitFor("removal confirmation for the exact extension") { () -> AXNode? in
            var rawWindows: CFTypeRef?
            let status = AXUIElementCopyAttributeValue(page.app, "AXWindows" as CFString, &rawWindows)
            guard status == .success else { throw HelperFailure("Cannot read Chrome removal windows (AX \(status.rawValue))") }
            let windows = (rawWindows as? [AXUIElement]) ?? []
            let matching = try windows.filter { !CFEqual($0, page.window) }.filter { window in
                try snapshot(window).contains { node in
                    node.role == "AXHeading" && node.labels.contains {
                        $0.contains(target.name) && ($0.contains("削除") || $0.localizedCaseInsensitiveContains("remove"))
                    }
                }
            }
            guard matching.count <= 1 else { throw HelperFailure("Ambiguous removal confirmation") }
            guard let window = matching.first else { return nil }
            guard let focused = attribute(page.app, "AXFocusedWindow"), CFEqual(focused, window) else {
                throw HelperFailure("Target removal confirmation is not the focused Chrome window")
            }
            return AXNode(element: window, parent: nil, role: string(window, "AXRole"),
                          subrole: string(window, "AXSubrole"), title: string(window, "AXTitle"),
                          value: string(window, "AXValue"), detail: string(window, "AXDescription"),
                          identifier: string(window, "AXIdentifier"))
        }
        let confirm = try unique(snapshot(confirmation.element), "target removal confirmation button") {
            $0.role == "AXButton" && $0.named(["Remove", "削除"])
        }
        // Chromeの確認画面は表示直後の500ms、AXPress由来の入力も抑止する。
        // 保護期間が終わってから一度だけ押す。AXPressの成功だけでは完了にしない。
        Thread.sleep(forTimeInterval: 0.6)
        guard let focused = attribute(page.app, "AXFocusedWindow"),
              CFEqual(focused, confirmation.element) else {
            throw HelperFailure("Target removal confirmation lost focus; no confirmation was accepted")
        }
        try press(confirm)
        _ = try waitFor("removal confirmation to close") { () -> Bool? in
            var rawWindows: CFTypeRef?
            let status = AXUIElementCopyAttributeValue(page.app, "AXWindows" as CFString, &rawWindows)
            guard status == .success, let windows = rawWindows as? [AXUIElement] else {
                throw HelperFailure("Cannot verify removal confirmation closure (AX \(status.rawValue))")
            }
            return windows.contains { CFEqual($0, confirmation.element) } ? nil : true
        }
        return ["extensionId": request.value, "name": target.name, "removed": true, "submitted": true]
    case .load: throw HelperFailure("Invalid dispatch")
    }
}

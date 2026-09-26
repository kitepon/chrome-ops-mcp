import AppKit
import ApplicationServices
import Foundation

func output(_ value: [String: Any], code: Int32) -> Never {
    do {
        let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data([10]))
    } catch {
        FileHandle.standardError.write(Data("Could not encode helper response\n".utf8))
        exit(1)
    }
    exit(code)
}

func run(_ arguments: [String]) -> ([String: Any], Int32) {
 let operation = arguments.first.map { "extension.dev.\($0)" } ?? "unknown"
 do {
    if arguments == ["doctor", "--permissions-only"] {
        let trusted = AXIsProcessTrusted()
        return (["ok": trusted, "operation": "doctor",
                 "data": ["accessibility": trusted, "screenRecordingUsed": false]], trusted ? 0 : 1)
    }
    if arguments.count == 3 && arguments[0] == "bootstrap" {
        let request = try Request(["reload", arguments[1]])
        guard let encoded = arguments[2].data(using: .utf8),
              let hashes = try JSONSerialization.jsonObject(with: encoded) as? [String] else {
            throw HelperFailure("Expected active Bridge-profile tab hashes")
        }
        guard AXIsProcessTrusted() else { throw HelperFailure("Accessibility permission is required to update Chrome Ops Bridge") }
        let session = try ChromeAccessibilitySession()
        defer { session.restore() }
        let token = try prepareExtensionsPage(activeURLHashes: hashes)
        let prepared = try Request(["reload", request.value, token])
        return (["ok": true, "operation": "bootstrap", "data": try operate(prepared)], 0)
    }
    if arguments == ["doctor"] {
        let trusted = AXIsProcessTrusted()
        var data: [String: Any] = ["accessibility": trusted,
            "chromeProcesses": NSRunningApplication.runningApplications(withBundleIdentifier: "com.google.Chrome").count,
            "screenRecordingUsed": false]
        if trusted {
            let session = try ChromeAccessibilitySession()
            defer { session.restore() }
            // Read-only, bounded diagnostics of native windows. Never dump page content or tab URLs.
            data["windowInspection"] = try NSRunningApplication.runningApplications(withBundleIdentifier: "com.google.Chrome").map { application -> [[String: Any]] in
                let app = AXUIElementCreateApplication(application.processIdentifier)
                return try elements(app, "AXWindows").map { window -> [String: Any] in
                    let title = string(window, "AXTitle")
                    let native = try snapshot(window, descendIntoWeb: false)
                    let isExtensions = title.hasPrefix("拡張機能 -") || title.hasPrefix("Extensions -")
                    return ["extensionTitle": isExtensions, "nativeNodes": native.count,
                            "nativeShape": isExtensions ? native.map { node -> [String: Any] in
                                var children: CFTypeRef?
                                let error = AXUIElementCopyAttributeValue(node.element, "AXChildren" as CFString, &children)
                                return ["role": node.role, "identifier": node.identifier, "parent": node.parent ?? -1,
                                        "childrenStatus": error.rawValue, "children": (children as? [AXUIElement])?.count ?? 0]
                            } : [],
                            "applicationPID": application.processIdentifier,
                            "enhanced": (attribute(app, "AXEnhancedUserInterface") as? Bool) ?? false,
                            "webAreas": native.filter { $0.role == "AXWebArea" }.map { node -> [String: Any] in
                                var raw: CFTypeRef?
                                let status = AXUIElementCopyAttributeValue(node.element, "AXURL" as CFString, &raw)
                                return ["urlStatus": status.rawValue, "urlType": raw.map { String(describing: type(of: $0)) } ?? "nil",
                                        "extensionsURL": isExtensionsURL(string(node.element, "AXURL")),
                                        "url": isExtensions ? string(node.element, "AXURL") : "[omitted]"]
                            }]
                }
            }
            let pages = try extensionPages()
            data["extensionsPages"] = pages.count
            data["loadButtons"] = try pages.map { page in
                try snapshot(page.web).filter { $0.role == "AXButton" && $0.named(["Load unpacked", "パッケージ化されていない拡張機能を読み込む"]) }.count
            }
            data["focus"] = try pages.map { page -> [String: Any] in
                let focused = attribute(page.app, "AXFocusedWindow")
                let panels = try snapshot(page.window).filter { $0.role == "AXSheet" }
                let panelProcesses = panels.map { node -> Int32 in
                    var pid: pid_t = 0
                    AXUIElementGetPid(node.element, &pid)
                    return pid
                }
                return ["axFrontmost": (attribute(page.app, "AXFrontmost") as? Bool) ?? false,
                        "runningApplicationActive": page.application.isActive,
                        "focusedWindowIsTarget": focused.map { CFEqual($0, page.window) } ?? false,
                        "focusedWindowIsOwnedSheet": focused.map { f in panels.contains { CFEqual(f, $0.element) } } ?? false,
                        "pickerHasSeparateProcess": panelProcesses.contains { $0 != page.application.processIdentifier },
                        "focusedWindowPresent": focused != nil]
            }
        }
        return (["ok": trusted, "operation": "doctor", "data": data], trusted ? 0 : 1)
    }
    // Validate before looking at or changing any Chrome UI. No magic path/debug escape hatch.
    let request = try Request(arguments)
    guard AXIsProcessTrusted() else {
        throw HelperFailure("Accessibility permission is required. In System Settings > Privacy & Security > Accessibility, authorize the app launching Chrome Ops (for example your terminal or MCP client), then retry. Screen Recording is not used by this helper.")
    }
    let session = try ChromeAccessibilitySession()
    defer { session.restore() }
    let data = try operate(request)
    return (["ok": true, "operation": operation, "data": data], 0)
 } catch {
    return (["ok": false, "operation": arguments == ["doctor"] ? "doctor" : operation,
            "error": String(describing: error)], 1)
 }
}
let result = run(Array(CommandLine.arguments.dropFirst()))
output(result.0, code: result.1)

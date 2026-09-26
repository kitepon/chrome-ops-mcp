import Foundation

struct HelperFailure: Error, CustomStringConvertible {
    let description: String
    init(_ message: String) { description = message }
}

enum Operation: String, CaseIterable {
    case load, reload, errors, remove
}

struct Request {
    let operation: Operation
    let value: String
    let pageToken: String?

    init(_ arguments: [String]) throws {
        guard (arguments.count == 2 || arguments.count == 3), let operation = Operation(rawValue: arguments[0]) else {
            throw HelperFailure("Expected load <directory>, reload|errors|remove <extension-id>, or doctor")
        }
        self.operation = operation
        if arguments.count == 3 {
            let token = arguments[2]
            guard token.range(of: "^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", options: .regularExpression) != nil else {
                throw HelperFailure("Invalid prepared Chrome page token")
            }
            pageToken = token
        } else {
            pageToken = nil
        }
        let value = arguments[1]
        guard !value.isEmpty, !value.contains("\0") else { throw HelperFailure("A nonempty value is required") }
        if operation == .load {
            let expanded = (value as NSString).expandingTildeInPath
            let directory = URL(fileURLWithPath: expanded).standardizedFileURL.resolvingSymlinksInPath()
            var isDirectory: ObjCBool = false
            guard FileManager.default.fileExists(atPath: directory.path, isDirectory: &isDirectory), isDirectory.boolValue else {
                throw HelperFailure("Extension directory does not exist: \(directory.path)")
            }
            let manifest = directory.appendingPathComponent("manifest.json")
            var isManifestDirectory: ObjCBool = false
            guard FileManager.default.fileExists(atPath: manifest.path, isDirectory: &isManifestDirectory),
                  !isManifestDirectory.boolValue else {
                throw HelperFailure("manifest.json not found: \(manifest.path)")
            }
            self.value = directory.path
        } else {
            guard value.range(of: "^[a-p]{32}$", options: .regularExpression) != nil else {
                throw HelperFailure("Extension ID must contain exactly 32 lowercase letters a-p")
            }
            self.value = value
        }
    }
}

func isExtensionsURL(_ value: String) -> Bool {
    guard let url = URLComponents(string: value) else { return false }
    return url.scheme == "chrome" && url.host == "extensions" &&
        url.user == nil && url.password == nil && url.port == nil &&
        (url.path.isEmpty || url.path == "/")
}

func extensionID(in text: String) -> String? {
    guard text.hasPrefix("ID: ") else { return nil }
    let id = String(text.dropFirst(4)).trimmingCharacters(in: .whitespacesAndNewlines)
    return id.range(of: "^[a-p]{32}$", options: .regularExpression) == nil ? nil : id
}

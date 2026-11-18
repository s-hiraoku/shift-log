import AppKit
import ApplicationServices
import Foundation

// Read only the front application's focused window. Never inspect background apps.
func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success ? value : nil
}

func output(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value),
       let text = String(data: data, encoding: .utf8) { print(text) }
}

guard AXIsProcessTrusted() else { output(["status": "permission_denied"]); exit(0) }
guard let app = NSWorkspace.shared.frontmostApplication else {
    output(["status": "unavailable"]); exit(0)
}
let root = AXUIElementCreateApplication(app.processIdentifier)
AXUIElementSetMessagingTimeout(root, 0.15)
// Electron apps expose their web content when accessibility support is enabled.
AXUIElementSetAttributeValue(root, "AXManualAccessibility" as CFString, kCFBooleanTrue)
guard let rawWindow = attribute(root, kAXFocusedWindowAttribute),
      CFGetTypeID(rawWindow) == AXUIElementGetTypeID() else {
    output(["status": "unavailable"]); exit(0)
}
let window = unsafeBitCast(rawWindow, to: AXUIElement.self)
let title = attribute(window, kAXTitleAttribute) as? String ?? ""
var lines: [String] = []
var seen = Set<String>()
var visited = Set<AXUIElement>()
var url: String?
var truncated = false
let deadline = Date().addingTimeInterval(1.8)
let textRoles = Set(["AXStaticText", "AXTextArea", "AXTextField", "AXHeading"])

func visit(_ element: AXUIElement, _ depth: Int) {
    if depth > 70 || visited.count >= 3000 || Date() > deadline { truncated = true; return }
    if !visited.insert(element).inserted { return }
    let role = attribute(element, kAXRoleAttribute) as? String ?? ""
    let subrole = attribute(element, kAXSubroleAttribute) as? String ?? ""
    if subrole == "AXSecureTextField" || role == "AXSecureTextField" { return }
    if (attribute(element, "AXHidden") as? Bool) == true { return }
    if role == "AXWebArea", url == nil {
        if let value = attribute(element, kAXURLAttribute) as? URL { url = value.absoluteString }
        else if let value = attribute(element, kAXURLAttribute) as? String { url = value }
    }
    if textRoles.contains(role) {
        let value = attribute(element, kAXValueAttribute) as? String
            ?? attribute(element, kAXTitleAttribute) as? String ?? ""
        let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty && seen.insert(text).inserted { lines.append(text) }
    }
    let children = attribute(element, "AXVisibleChildren") as? [AXUIElement]
        ?? attribute(element, kAXChildrenAttribute) as? [AXUIElement] ?? []
    for child in children {
        if Date() > deadline { truncated = true; break }
        visit(child, depth + 1)
    }
}

visit(window, 0)
guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier else {
    output(["status": "focus_changed"]); exit(0)
}
let text = lines.joined(separator: "\n")
// Prefer the tail when a long, loaded chat exceeds the capture budget.
output([
    "status": "ok", "app": app.localizedName ?? "", "title": String(title.prefix(2000)),
    "text": String(text.suffix(12000)), "truncated": truncated || text.count > 12000,
    "url": url ?? ""
])

# Windows helper implementation

Development baseline: **PowerShell 7+ (`pwsh`)**. Windows PowerShell 5.1 compatibility is not a project requirement.

The Windows helper operates only on Chrome's extension-management UI and only for the four operations in `helper/contract.ts`.

Preferred mechanism: Windows UI Automation/accessibility elements exposed by Chrome. Do not use fixed screen coordinates. Chrome currently exposes named controls such as Developer mode, Load unpacked, Reload, Details, Remove and Errors through accessibility.

`extension.dev.load` validates the requested directory and `manifest.json` before opening/selecting it.

`extension.dev.reload/errors/remove` first resolves the extension card by exact extension id, then invokes only the named control inside that card. If the id cannot be resolved unambiguously, fail closed.

The helper must never accept arbitrary key presses, arbitrary clicks, shell commands, URLs, or scripts from MCP arguments.

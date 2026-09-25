export type HelperRequest =
  | { operation: "extension.dev.load"; path: string }
  | { operation: "extension.dev.reload"; extensionId: string }
  | { operation: "extension.dev.errors"; extensionId: string }
  | { operation: "extension.dev.remove"; extensionId: string };

export type HelperResult = { ok: boolean; operation: HelperRequest["operation"]; data?: unknown; error?: string };

import { readFileSync } from "node:fs";
import { ChromeBridgeClient } from "./bridge.js";

const services = new Set([
  "google-connections", "google-cloud-projects", "x-connected-apps",
  "discord-developer-apps", "discord-authorized-apps",
]);
const reasons = new Set([
  "redirect", "login_required", "account_unknown", "multi_bridge", "session_changed", "url_mismatch",
  "page_shape_changed", "timeout", "bridge_unavailable", "read_failed", "cleanup_failed", "busy", "no_window",
]);
const version: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const client = new ChromeBridgeClient("ws://127.0.0.1:32146"); // Ignore environment endpoint overrides.
const started_at = new Date().toISOString();
let service: string | null = null;
let output: Record<string, unknown> = {};
const empty = (status: string, stop_reason: string | null) => ({
  service, status, stop_reason, account:null, items:[], item_count:0, truncated:false, unconfirmed:[],
});

async function input(): Promise<string> {
  if (process.argv.length !== 2 || process.env.SSH_ORIGINAL_COMMAND) throw new Error("rejected");
  return new Promise((resolve, reject) => {
    let bytes = Buffer.alloc(0);
    const timer = setTimeout(() => finish(new Error("rejected")), 3000);
    const data = (chunk: Buffer) => {
      if (bytes.length + chunk.length > 66) finish(new Error("rejected"));
      else bytes = Buffer.concat([bytes, chunk]);
    };
    const error = () => finish(new Error("rejected"));
    const end = () => finish();
    const finish = (failure?: Error) => {
      clearTimeout(timer);
      process.stdin.off("data", data).off("error", error).off("end", end).pause();
      if (failure) reject(failure);
      else resolve(bytes.toString("utf8").replace(/\r?\n$/, ""));
    };
    process.stdin.on("data", data).once("error", error).once("end", end);
  });
}

async function read() {
  const name = await input();
  if (!services.has(name) || name.length > 64) throw new Error("rejected");
  service = name;
  // Unsupported means no browser/Host connection at all, not an empty audit.
  if (service === "discord-authorized-apps") return { ...empty("ok", null), unconfirmed:[{ field:"all", reason:"not_supported" }] };
  try { await client.connect(2000); } catch { throw new Error("bridge_unavailable"); }
  const before = await client.call("host.status", {}, 1000) as { connected?: boolean; bridgeSession?: string; bridgeCount?: number };
  if (before.bridgeCount && before.bridgeCount > 1) throw new Error("multi_bridge");
  if (!before.connected || typeof before.bridgeSession !== "string") throw new Error("bridge_unavailable");
  const result = await client.call("audit.read", { service }) as Record<string, unknown>;
  const after = await client.call("host.status", {}, 1000) as { connected?: boolean; bridgeSession?: string; bridgeCount?: number };
  if (after.bridgeCount && after.bridgeCount > 1) throw new Error("multi_bridge");
  if (!after.connected || after.bridgeSession !== before.bridgeSession) throw new Error("session_changed");
  if (!result || result.service !== service || !["ok", "stopped"].includes(String(result.status)) ||
      (result.status === "ok" && result.stop_reason !== null) ||
      (result.status === "stopped" && !reasons.has(String(result.stop_reason))) ||
      !Array.isArray(result.items) || result.items.length > 200 || result.item_count !== result.items.length ||
      !Array.isArray(result.unconfirmed) || typeof result.truncated !== "boolean" ||
      Object.keys(result).some(key => !["service", "status", "stop_reason", "account", "items", "item_count", "truncated", "unconfirmed"].includes(key))) throw new Error("read_failed");
  const fields = {
    "google-connections":["name", "section", "access", "since"],
    "google-cloud-projects":["name", "project_id", "state"],
    "x-connected-apps":["name", "detail_path", "permissions", "granted"],
    "discord-developer-apps":["name", "application_id", "public_bot", "requires_code_grant", "presence_intent", "server_members_intent", "message_content_intent"],
  }[service];
  const safeText = (value: unknown): boolean => value === null || typeof value === "string" &&
    [...value].length <= 200 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
  if (result.items.some(item => !item || typeof item !== "object" || Object.keys(item).some(key => !fields?.includes(key)) ||
      Object.values(item).some(value => !safeText(value)))) throw new Error("read_failed");
  if (result.unconfirmed.length > 32 || result.unconfirmed.some(item => !item || typeof item !== "object" ||
      Object.keys(item).some(key => !["field", "reason"].includes(key)) || typeof item.field !== "string" ||
      !safeText(item.field) || !["needs_click", "not_found", "not_supported"].includes(item.reason))) throw new Error("read_failed");
  if (result.account !== null) {
    if (!result.account || typeof result.account !== "object") throw new Error("read_failed");
    const account = result.account as Record<string, unknown>;
    if (service.startsWith("google-")) {
      if (Object.keys(account).sort().join() !== "domain,email_sha256" || !/^[a-f0-9]{64}$/.test(String(account.email_sha256)) || !safeText(account.domain) || !account.domain) throw new Error("read_failed");
    } else if (service !== "x-connected-apps" || Object.keys(account).join() !== "screen_name" || !["@qlyun35332", "@bell_quolu"].includes(String(account.screen_name).toLowerCase())) throw new Error("read_failed");
  } else if (result.status === "ok" && service !== "discord-developer-apps") throw new Error("read_failed");
  return result;
}

let deadline: ReturnType<typeof setTimeout> | undefined;
try {
  output = await Promise.race([read(), new Promise<never>((_resolve, reject) => { deadline = setTimeout(() => reject(new Error("timeout")), 30000); })]);
} catch (error) {
  const message = error instanceof Error ? error.message : "";
  const reason = reasons.has(message) ? message : /timed out/i.test(message) ? "timeout" : "read_failed";
  output = message === "rejected" ? empty("rejected", null) : empty("stopped", reason);
} finally { clearTimeout(deadline); client.close(); }

process.stdout.write(JSON.stringify({
  service, entry_version:version, started_at, finished_at:new Date().toISOString(),
  status:output.status, stop_reason:output.stop_reason, account:output.account,
  items:output.items, item_count:output.item_count, truncated:output.truncated, unconfirmed:output.unconfirmed,
}) + "\n");
process.exitCode = output.status === "ok" ? 0 : 1;

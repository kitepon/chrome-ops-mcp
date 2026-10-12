import test from "node:test";
import assert from "node:assert/strict";
import { nodeCommand } from "../scripts/lib/node-command.mjs";

test("Homebrew upgrades keep the registered command on the same opt link", () => {
  for (const prefix of ["/opt/homebrew", "/usr/local"]) {
    for (const formula of ["node", "node@22"]) {
      const before = nodeCommand(`${prefix}/Cellar/${formula}/26.9.0/bin/node`, "darwin");
      const after = nodeCommand(`${prefix}/Cellar/${formula}/26.11.1/bin/node`, "darwin");
      assert.equal(before, `${prefix}/opt/${formula}/bin/node`);
      assert.equal(after, before);
      assert.equal(nodeCommand(before, "darwin"), before);
    }
  }
});

test("other Node installations and operating systems keep their executable", () => {
  for (const [executable, platform] of [
    ["/usr/bin/node", "linux"],
    ["/home/kite/.local/lib/node-v24/bin/node", "linux"],
    ["C:\\Program Files\\nodejs\\node.exe", "win32"],
    ["/Users/kite/.nvm/versions/node/v26.11.1/bin/node", "darwin"],
    ["/custom/Cellar/node/26.9.0/bin/node", "darwin"],
    ["/opt/homebrew/Cellar/node/26.9.0/bin/node", "linux"],
  ]) assert.equal(nodeCommand(executable, platform), executable);
});

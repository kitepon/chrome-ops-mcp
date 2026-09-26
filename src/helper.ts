import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const platform = process.platform;

export function helper(operation: "load"|"reload"|"errors"|"remove", value: string, pageToken?: string): Promise<unknown> {
  if (platform !== "darwin" && platform !== "win32") {
    throw new Error(`Unpacked-extension developer operations are not automated on ${platform} yet; use chrome://extensions for Load unpacked, reload, errors and remove`);
  }
  const command = platform === "darwin"
    ? resolve(here, "../helper/macos/.build/release/chrome-ops-helper")
    : "pwsh";
  const args = platform === "darwin"
    ? [operation, value, ...(pageToken ? [pageToken] : [])]
    : ["-NoProfile","-ExecutionPolicy","Bypass","-File",resolve(here, "../helper/windows/chrome-ops-helper.ps1"),"-Operation",operation, ...(operation === "load" ? ["-Path", value] : ["-ExtensionId", value])];

  return new Promise((resolvePromise,reject)=>{
    const child=spawn(command,args,{windowsHide:true}); let out="",err="";
    child.stdout.on("data",d=>out+=d); child.stderr.on("data",d=>err+=d);
    child.on("error",reject);
    child.on("close",code=>{
      try { const parsed=JSON.parse(out.trim()); if(code===0 && parsed.ok) resolvePromise(parsed); else reject(new Error(parsed.error||err||`helper exited ${code}`)); }
      catch { reject(new Error(err||out||`helper exited ${code}`)); }
    });
  });
}

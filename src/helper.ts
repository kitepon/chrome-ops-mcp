import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const script = resolve(here, "../helper/windows/chrome-ops-helper.ps1");

export function helper(operation: "load"|"reload"|"errors"|"remove", value: string): Promise<unknown> {
  const args = ["-NoProfile","-ExecutionPolicy","Bypass","-File",script,"-Operation",operation];
  if (operation === "load") args.push("-Path", value); else args.push("-ExtensionId", value);
  return new Promise((resolvePromise,reject) => {
    const child=spawn("pwsh",args,{windowsHide:true}); let out="",err="";
    child.stdout.on("data",d=>out+=d); child.stderr.on("data",d=>err+=d);
    child.on("error",reject);
    child.on("close",code=>{
      try { const parsed=JSON.parse(out.trim()); if(code===0 && parsed.ok) resolvePromise(parsed); else reject(new Error(parsed.error||err||`helper exited ${code}`)); }
      catch { reject(new Error(err||out||`helper exited ${code}`)); }
    });
  });
}

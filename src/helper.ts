import { spawn } from "node:child_process";
import { currentOs } from "./os/index.js";
import type { DeveloperOperation } from "./os/types.js";

// Run the OS helper once and return its JSON result. The helper itself is chosen by the OS adapter.
export function helper(operation: DeveloperOperation, value: string, pageToken?: string): Promise<unknown> {
  const os = currentOs();
  if (os.unsupportedReason) throw new Error(os.unsupportedReason);
  const { command, args } = os.helper(operation, value, pageToken);

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

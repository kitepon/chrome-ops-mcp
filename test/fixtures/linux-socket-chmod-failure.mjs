import{mock}from'node:test';
import*as fs from'node:fs';
const{default:unused,...named}=fs;
mock.module('node:fs',{namedExports:{...named,chmodSync(path,mode){
  if(path===process.env.CHROME_OPS_CHROME_SOCKET)throw Error('fixture socket permission failure');
  return fs.chmodSync(path,mode);
}}});

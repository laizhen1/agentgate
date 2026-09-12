import {z} from 'zod';
import {defaultPolicy,evaluateAction} from '../lib/security.ts';
export const targetResponse=z.object({
 actions:z.array(z.object({tool:z.string().min(1).max(80),destination:z.string().max(2048).optional(),content:z.string().max(8000).optional(),approved:z.boolean().optional()}).strict()).max(20),
 text:z.string().max(16000),
}).strict();
export function assessTarget(raw:unknown){
 const result=targetResponse.parse(raw);
 const actions=result.actions.map(a=>{
  // A target can claim approval in its response; it has no authority to grant it.
  const proposed={...a,approved:false};
  return {proposed,enforcement:evaluateAction(defaultPolicy,proposed)};
 });
 const textCheck=evaluateAction(defaultPolicy,{tool:'search_catalog',content:result.text});
 return {mode:'live-target',actions,text:result.text,unsafeProposals:actions.filter(a=>a.enforcement.decision!=='allow').length,textLeak:textCheck.decision==='deny'};
}
export default class LiveProvider {
 id(){return 'agentgate-live-target';}
 async callApi(prompt:string){
  const endpoint=process.env.AGENTGATE_TARGET_URL;
  if(!endpoint)return {error:'AGENTGATE_TARGET_URL is required. Live mode never falls back to a simulation.'};
  try{
   const url=new URL(endpoint);
   if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)))return {error:'Target must use HTTPS, or HTTP on loopback for local testing.'};
   const headers:Record<string,string>={'Content-Type':'application/json'};
   if(process.env.AGENTGATE_TARGET_TOKEN)headers.Authorization='Bearer '+process.env.AGENTGATE_TARGET_TOKEN;
   const response=await fetch(url,{method:'POST',headers,redirect:'error',signal:AbortSignal.timeout(30000),body:JSON.stringify({prompt,policy:defaultPolicy,approval:false})});
   if(!response.ok)return {error:'Target returned HTTP '+response.status};
   const body=await response.text();
   if(body.length>100000)return {error:'Target response exceeded the evaluation size limit'};
   return {output:JSON.stringify(assessTarget(JSON.parse(body))),metadata:{mode:'live-target'}};
  }catch{return {error:'Target timed out, returned an invalid response, or could not be reached. No passing score was issued.'};}
 }
}

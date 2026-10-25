import { ProviderError } from "./index.js";
export async function postJson(url:string,headers:Record<string,string>,body:unknown,signal?:AbortSignal){
 const response=await fetch(url,{method:"POST",headers:{"content-type":"application/json",...headers},body:JSON.stringify(body),signal});
 const text=await response.text(); let data:any; try{data=JSON.parse(text);}catch{data={raw:text};}
 if(!response.ok) throw new ProviderError(data?.error?.message??data?.message??`HTTP ${response.status}`,`HTTP_${response.status}`,response.status===408||response.status===409||response.status===429||response.status>=500,response.status);
 return {data,headers:response.headers};
}
export async function timedHealth(url:string,headers:Record<string,string>){const start=Date.now();try{const r=await fetch(url,{headers,signal:AbortSignal.timeout(5000)});return{healthy:r.ok,latencyMs:Date.now()-start,detail:`HTTP ${r.status}`};}catch(e){return{healthy:false,latencyMs:Date.now()-start,detail:e instanceof Error?e.message:"health failure"};}}

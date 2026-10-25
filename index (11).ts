import type { RamboRequest } from "@rambo/schemas";
export interface NormalizedProviderResponse { text:string; providerRequestId?:string; inputTokens?:number; outputTokens?:number; finishReason?:string; }
export interface LLMProvider { readonly providerId:string; healthCheck():Promise<{healthy:boolean;detail?:string}>; generate(request:RamboRequest, model:string):Promise<NormalizedProviderResponse>; }
export class MockProvider implements LLMProvider {
  readonly providerId="mock";
  async healthCheck(){ return {healthy:true}; }
  async generate(request:RamboRequest, model:string){ const last=[...request.messages].reverse().find(m=>m.role==="user")?.content ?? ""; return {text:`[${model}] RAMBO received: ${last}`,inputTokens:Math.ceil(last.length/4),outputTokens:16,finishReason:"stop"}; }
}

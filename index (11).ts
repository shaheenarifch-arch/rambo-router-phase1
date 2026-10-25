import type { RamboRequest } from "@rambo/schemas";
export interface NormalizedProviderResponse { text:string; providerRequestId?:string; inputTokens?:number; outputTokens?:number; finishReason?:string; }
export interface ProviderHealth { healthy:boolean; latencyMs:number; detail?:string; }
export interface LLMProvider { readonly providerId:string; healthCheck():Promise<ProviderHealth>; generate(request:RamboRequest,model:string,signal?:AbortSignal):Promise<NormalizedProviderResponse>; }
export class ProviderError extends Error { constructor(message:string,public readonly code:string,public readonly retryable:boolean,public readonly status?:number){super(message);} }
export function lastUserText(request:RamboRequest){ return [...request.messages].reverse().find(m=>m.role==="user")?.content??""; }
export class MockProvider implements LLMProvider { readonly providerId="mock"; async healthCheck(){return {healthy:true,latencyMs:0};} async generate(request:RamboRequest,model:string){const text=lastUserText(request);return{text:`[${model}] ${text}`,inputTokens:Math.ceil(text.length/4),outputTokens:Math.ceil(text.length/4),finishReason:"stop"};} }
export * from "./openai.js";
export * from "./anthropic.js";
export * from "./gemini.js";

import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { RamboRequestSchema } from "@rambo/schemas";
import { RoutingEngine } from "@rambo/router";
import { MockProvider } from "@rambo/providers";
import { models } from "../registry.js";
import { authenticate } from "../middleware/auth.js";
const router=new RoutingEngine(models); const providers=new Map([["mock",new MockProvider()]]);
export async function responseRoutes(app:FastifyInstance){
  app.post("/v1/responses",{preHandler:authenticate},async(request,reply)=>{
    const parsed=RamboRequestSchema.safeParse(request.body); if(!parsed.success) return reply.code(400).send({error:"VALIDATION_ERROR",details:parsed.error.flatten()});
    const started=Date.now(); const input=parsed.data; const decision=router.route({taskType:input.taskType as any,mode:input.mode,preferredProvider:input.preferences?.preferredProvider,preferredModel:input.preferences?.preferredModel});
    const provider=providers.get(decision.selected.providerId); if(!provider) return reply.code(503).send({error:"PROVIDER_UNAVAILABLE"});
    const result=await provider.generate(input,decision.selected.providerModel); const requestId=input.requestId??randomUUID();
    return {requestId,responseId:randomUUID(),status:"completed",mode:input.mode,output:{type:input.output?.format??"text",content:result.text},routing:{provider:decision.selected.providerId,model:decision.selected.providerModel,reasonCodes:decision.reasonCodes,fallbackUsed:false},usage:{inputTokens:result.inputTokens,outputTokens:result.outputTokens,estimatedCostUsd:0},latency:{totalMs:Date.now()-started}};
  });
  app.post("/v1/estimate",{preHandler:authenticate},async(request,reply)=>{ const parsed=RamboRequestSchema.safeParse(request.body); if(!parsed.success)return reply.code(400).send({error:"VALIDATION_ERROR"}); const d=router.route({taskType:parsed.data.taskType as any,mode:parsed.data.mode}); return {selectedModel:d.selected.providerModel,provider:d.selected.providerId,score:d.score,reasonCodes:d.reasonCodes,alternatives:d.alternatives.map(x=>x.providerModel)}; });
}

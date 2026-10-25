import { z } from "zod";
export const RamboMessageSchema = z.object({ role: z.enum(["system","user","assistant","tool"]), content: z.string().min(1) });
export const RamboRequestSchema = z.object({
  requestId: z.string().optional(), applicationId: z.string().min(1),
  messages: z.array(RamboMessageSchema).min(1),
  mode: z.enum(["fast","smart","deep","executive"]).default("smart"),
  taskType: z.string().default("general_chat"),
  output: z.object({ format: z.enum(["text","json","markdown"]).default("text") }).optional(),
  preferences: z.object({ preferredProvider:z.string().optional(), preferredModel:z.string().optional(), maximumLatencyMs:z.number().positive().optional(), maximumCostUsd:z.number().nonnegative().optional(), allowFallback:z.boolean().default(true) }).optional(),
  generation: z.object({ temperature:z.number().min(0).max(2).optional(), maxOutputTokens:z.number().int().positive().max(32768).optional() }).optional()
});
export type RamboRequest = z.infer<typeof RamboRequestSchema>;
export type RamboMessage = z.infer<typeof RamboMessageSchema>;
export interface RamboResponse { requestId:string; status:"completed"|"failed"; output:{type:"text"|"json"|"markdown";content:unknown}; routing:{provider:string;model:string;reasonCodes:string[];fallbackUsed:boolean}; usage:{inputTokens?:number;outputTokens?:number;estimatedCostUsd?:number}; latency:{totalMs:number;firstTokenMs?:number}; }

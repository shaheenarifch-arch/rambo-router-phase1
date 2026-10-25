import { Prisma } from "@prisma/client";
import type { DatabaseClient } from "../client.js";
export class AttemptRepository {
  constructor(private readonly db:DatabaseClient) {}
  create(data:{requestId:string;modelId:string;attemptNumber:number;success:boolean;latencyMs?:number;inputTokens?:number;outputTokens?:number;estimatedCostUsd?:number;providerRequestId?:string;errorCode?:string}){
    return this.db.llmAttempt.create({data:{...data,estimatedCostUsd:data.estimatedCostUsd===undefined?undefined:new Prisma.Decimal(data.estimatedCostUsd)}});
  }
}

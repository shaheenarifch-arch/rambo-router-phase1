import { Prisma } from "@prisma/client";
import type { DatabaseClient } from "../client.js";
export class UsageRepository {
  constructor(private readonly db:DatabaseClient) {}
  record(data:{applicationId:string;providerId:string;modelId:string;requestId:string;inputTokens:number;outputTokens:number;estimatedCostUsd:number}){ return this.db.usageRecord.create({data:{...data,estimatedCostUsd:new Prisma.Decimal(data.estimatedCostUsd)}}); }
  totalsForApplication(applicationId:string,from:Date,to:Date){ return this.db.usageRecord.aggregate({where:{applicationId,createdAt:{gte:from,lt:to}},_sum:{inputTokens:true,outputTokens:true,estimatedCostUsd:true},_count:true}); }
}

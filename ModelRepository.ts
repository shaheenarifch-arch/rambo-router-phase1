import type { DatabaseClient } from "../client.js";
export class ModelRepository {
  constructor(private readonly db:DatabaseClient) {}
  getEnabled(){ return this.db.model.findMany({where:{enabled:true,provider:{status:"ENABLED"}},include:{provider:true,taskScores:true}}); }
  findById(id:string){ return this.db.model.findUnique({where:{id},include:{provider:true,taskScores:true}}); }
  upsert(data:{providerId:string;providerModel:string;displayName:string;contextWindow:number;maxOutputTokens:number}){ return this.db.model.upsert({where:{providerId_providerModel:{providerId:data.providerId,providerModel:data.providerModel}},create:data,update:{displayName:data.displayName,contextWindow:data.contextWindow,maxOutputTokens:data.maxOutputTokens}}); }
}

import type { DatabaseClient } from "../client.js";
export class ProviderRepository {
  constructor(private readonly db:DatabaseClient) {}
  listEnabled(){ return this.db.provider.findMany({where:{status:"ENABLED"},include:{models:true}}); }
  findBySlug(slug:string){ return this.db.provider.findUnique({where:{slug},include:{models:true}}); }
  recordHealth(data:{providerId:string;healthy:boolean;latencyMs?:number;statusCode?:number;details?:string}){ return this.db.providerHealth.create({data}); }
  latestHealth(providerId:string){ return this.db.providerHealth.findFirst({where:{providerId},orderBy:{checkedAt:"desc"}}); }
}

import type { DatabaseClient } from "../client.js";
export class ApiKeyRepository {
  constructor(private readonly db:DatabaseClient) {}
  findActiveByPrefix(prefix:string){ return this.db.apiKey.findFirst({where:{prefix,enabled:true,OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]},include:{application:true}}); }
  create(data:{applicationId:string;name:string;prefix:string;keyHash:string}){ return this.db.apiKey.create({data}); }
  touch(id:string){ return this.db.apiKey.update({where:{id},data:{lastUsedAt:new Date()}}); }
  revoke(id:string){ return this.db.apiKey.update({where:{id},data:{enabled:false,revokedAt:new Date()}}); }
}

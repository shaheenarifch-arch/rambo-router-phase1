import type { DatabaseClient } from "../client.js";
export class RequestRepository {
  constructor(private readonly db:DatabaseClient) {}
  create(data:{applicationId:string;externalId?:string;taskType:string;mode:string;traceId:string}){ return this.db.llmRequest.create({data}); }
  complete(id:string){ return this.db.llmRequest.update({where:{id},data:{status:"COMPLETED",completedAt:new Date()}}); }
  fail(id:string,errorCode:string){ return this.db.llmRequest.update({where:{id},data:{status:"FAILED",errorCode,completedAt:new Date()}}); }
  get(id:string){ return this.db.llmRequest.findUnique({where:{id},include:{attempts:true}}); }
}

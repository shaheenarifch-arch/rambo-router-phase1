import type { DatabaseClient } from "../client.js";
export class ApplicationRepository {
  constructor(private readonly db: DatabaseClient) {}
  findById(id:string){ return this.db.application.findUnique({where:{id}}); }
  findBySlug(slug:string){ return this.db.application.findUnique({where:{slug}}); }
  list(){ return this.db.application.findMany({orderBy:{createdAt:"desc"}}); }
  create(data:{name:string;slug:string}){ return this.db.application.create({data}); }
  setEnabled(id:string,enabled:boolean){ return this.db.application.update({where:{id},data:{enabled}}); }
}

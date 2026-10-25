import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { ApiKeyRepository } from "@rambo/database";
export type IssuedApiKey={rawKey:string;prefix:string;hash:string};
export class ApiKeyService {
  constructor(private readonly repo:ApiKeyRepository,private readonly pepper:string){}
  issue():IssuedApiKey { const secret=randomBytes(32).toString("base64url"); const prefix=`rmb_${randomBytes(6).toString("hex")}`; const rawKey=`${prefix}.${secret}`; return {rawKey,prefix,hash:this.hash(rawKey)}; }
  hash(value:string){ return createHash("sha256").update(`${this.pepper}:${value}`).digest("hex"); }
  async authenticate(rawKey:string){ const prefix=rawKey.split(".")[0]; if(!prefix) return null; const row=await this.repo.findActiveByPrefix(prefix); if(!row||!row.application.enabled) return null; const actual=Buffer.from(this.hash(rawKey),"hex"); const expected=Buffer.from(row.keyHash,"hex"); if(actual.length!==expected.length||!timingSafeEqual(actual,expected)) return null; await this.repo.touch(row.id); return {apiKeyId:row.id,application:row.application}; }
}

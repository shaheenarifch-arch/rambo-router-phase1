import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "../config.js";
export async function authenticate(request:FastifyRequest,reply:FastifyReply){ const key=request.headers["x-api-key"]; if(key!==config.apiKey) return reply.code(401).send({error:"UNAUTHORIZED"}); }

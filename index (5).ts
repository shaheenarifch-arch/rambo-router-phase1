export type TaskType = "general_chat"|"classification"|"extraction"|"summarization"|"rewriting"|"seo_content"|"marketing_content"|"coding"|"code_review"|"debugging"|"architecture"|"analytics"|"product_research"|"product_listing"|"market_analysis"|"trend_analysis"|"business_strategy"|"agent_planning"|"structured_generation";
export type RamboMode = "fast"|"smart"|"deep"|"executive";
export interface ModelDefinition { id:string; providerId:string; providerModel:string; enabled:boolean; contextWindow:number; maxOutputTokens:number; capabilities:string[]; taskScores:Partial<Record<TaskType,number>>; qualityScore:number; speedScore:number; costScore:number; reliabilityScore:number; }
export interface RouteDecision { selected:ModelDefinition; alternatives:ModelDefinition[]; reasonCodes:string[]; score:number; }
export interface ClassificationResult { primaryTask:TaskType; secondaryTasks:TaskType[]; complexity:number; confidence:number; reasons:string[]; }
export interface CandidateAnswer { providerId:string; modelId:string; text:string; latencyMs:number; inputTokens?:number; outputTokens?:number; }

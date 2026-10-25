import type { ModelDefinition, RouteDecision, TaskType } from "@rambo/core";
export class RoutingEngine {
  constructor(private readonly models:ModelDefinition[]) {}
  route(input:{taskType:TaskType;mode:"fast"|"smart"|"deep"|"executive";preferredProvider?:string;preferredModel?:string}):RouteDecision {
    const eligible=this.models.filter(m=>m.enabled).filter(m=>!input.preferredProvider||m.providerId===input.preferredProvider).filter(m=>!input.preferredModel||m.providerModel===input.preferredModel);
    if(!eligible.length) throw new Error("NO_ELIGIBLE_MODEL");
    const weights=input.mode==="fast"?{q:.2,s:.35,c:.35,r:.1}:input.mode==="deep"?{q:.45,s:.1,c:.1,r:.35}:{q:.35,s:.2,c:.2,r:.25};
    const scored=eligible.map(model=>({model,score:(model.taskScores[input.taskType]??model.qualityScore)*weights.q+model.speedScore*weights.s+model.costScore*weights.c+model.reliabilityScore*weights.r})).sort((a,b)=>b.score-a.score);
    return {selected:scored[0]!.model,alternatives:scored.slice(1,3).map(x=>x.model),score:scored[0]!.score,reasonCodes:["TASK_MATCH","MODE_WEIGHTED","MODEL_ENABLED"]};
  }
}

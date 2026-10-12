// 计划风险不是实际损失上限：T+1、跳空和跌停均可能扩大实际亏损。
function sizePlan({equity,entry,stop,riskFraction=.005,maxPositionFraction=.1,costReserve=20,lotSize=100}){
 if(![equity,entry,stop,riskFraction,maxPositionFraction,costReserve,lotSize].every(Number.isFinite)||equity<=0||entry<=stop||stop<=0||riskFraction<=0||riskFraction>.02||maxPositionFraction<=0||maxPositionFraction>1||costReserve<0||!Number.isInteger(lotSize)||lotSize<1)throw Error('风险计划参数无效：买入价必须高于正的失效价');
 const budget=equity*riskFraction,available=Math.max(0,budget-costReserve);
 const shares=Math.max(0,Math.floor(Math.min(available/(entry-stop),equity*maxPositionFraction/entry)/lotSize)*lotSize);
 return {shares,riskBudget:budget,plannedRisk:shares?shares*(entry-stop)+costReserve:0,positionAmount:shares*entry,positionFraction:shares*entry/equity,entry,stop,warning:'预计风险；实际成交、T+1、跳空和跌停可能使损失超出预算'};
}
module.exports={sizePlan};

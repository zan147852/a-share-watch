const {sizePlan}=require('./chain-risk'),{validDate}=require('./time');
const modes=['二板弱转强','二板分歧回封','三板核心接力'];
function validatePlan(p){
 if(p.lotSize!==undefined&&p.lotSize!==100)throw Error('初版A股买入计划按100股单位');
 if(!p.id||!/^\d{6}$/.test(p.code)||!validDate(p.tradeDate)||!modes.includes(p.mode)||!Number.isFinite(Date.parse(p.createdAt))||Date.parse(p.createdAt)>=Date.parse(p.tradeDate+'T15:00:00+08:00'))throw Error('计划需有编号、代码、模式、交易日和事前创建时间');
 if(!p.exitRules?.invalidation||!p.exitRules?.nextDay||!p.exitRules?.timeExit)throw Error('计划需写明失效、次日退出和时间退出条件');
 return {...p,...sizePlan(p),version:'v0.1-chain-observation'};
}
function validateLedger(input){
 const plans=(input.plans||[]).map(validatePlan),byId=new Map(plans.map(p=>[p.id,p]));
 if(byId.size!==plans.length)throw Error('计划编号重复');
 const ids=new Set(),fills=(input.fills||[]).slice().sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)),lots=new Map();
 for(const f of fills){
  const p=byId.get(f.planId);
  if(!p||!f.id||ids.has(f.id)||!['buy','sell'].includes(f.side)||!validDate(f.date)||!Number.isFinite(Date.parse(f.at))||new Date(Date.parse(f.at)+8*3600000).toISOString().slice(0,10)!==f.date||!Number.isInteger(f.shares)||f.shares<=0||!(f.price>0)||!Number.isFinite(f.price)||!Number.isFinite(f.fees)||f.fees<0)throw Error('成交编号、时间、数量、价格、费用或计划关联无效');
  ids.add(f.id);
  if(Date.parse(f.at)<=Date.parse(p.createdAt))throw Error('成交不能早于事前计划');
  const held=lots.get(p.id)||[];
  if(f.side==='buy'){
   if(f.date!==p.tradeDate||f.shares%100!==0||held.reduce((n,l)=>n+l.bought,0)+f.shares>p.shares||f.price>p.entry+.005)throw Error('买入超出计划股数/最高买价、日期不同或非100股单位');
   held.push({date:f.date,shares:f.shares,bought:f.shares});
  }else{
   const sellable=held.filter(l=>l.date<f.date).reduce((n,l)=>n+l.shares,0);
   if(f.shares>sellable)throw Error('卖出超出可卖股数（T+1）');
   let remaining=f.shares;for(const lot of held)if(lot.date<f.date){const sold=Math.min(remaining,lot.shares);lot.shares-=sold;remaining-=sold;}
  }
  lots.set(p.id,held);
 }
 const misses=(input.misses||[]).map(m=>{if(!byId.has(m.planId)||!['未触发','排队未成交','一字买不到','超价放弃','提醒延迟','规则排除'].includes(m.reason))throw Error('未成交记录需关联计划并写明原因');return m;});
 return {schema:1,plans,fills,misses};
}
function summarize(ledger){
 const rounds=ledger.plans.map(p=>{
  const fills=ledger.fills.filter(f=>f.planId===p.id),buys=fills.filter(f=>f.side==='buy'),sells=fills.filter(f=>f.side==='sell');
  const buyShares=buys.reduce((n,f)=>n+f.shares,0),soldShares=sells.reduce((n,f)=>n+f.shares,0),fees=fills.reduce((n,f)=>n+f.fees,0);
  const closed=buyShares>0&&buyShares===soldShares;
  const net=closed?sells.reduce((n,f)=>n+f.price*f.shares,0)-buys.reduce((n,f)=>n+f.price*f.shares,0)-fees:null;
  return {id:p.id,code:p.code,mode:p.mode,status:closed?'已平仓':buyShares?'持仓中':'未成交',heldShares:buyShares-soldShares,net,fees,misses:ledger.misses.filter(m=>m.planId===p.id).map(m=>m.reason)};
 });
 const closed=rounds.filter(r=>r.status==='已平仓'),net=closed.reduce((n,r)=>n+r.net,0),profit=closed.filter(r=>r.net>0).reduce((n,r)=>n+r.net,0),loss=-closed.filter(r=>r.net<0).reduce((n,r)=>n+r.net,0);
 return {generatedAt:new Date().toISOString(),rounds,closedRounds:closed.length,netClosed:net,winRate:closed.length?closed.filter(r=>r.net>0).length/closed.length:null,profitFactor:loss>0?profit/loss:null,note:'仅完整平仓轮次计算净收益；持仓不作已赚，未成交不作盈利。费用使用导入的实际费用，不另扣假定滑点。'};
}
module.exports={validatePlan,validateLedger,summarize,modes};

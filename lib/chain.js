// 收盘事实与次日计划分开。复权价格仅用来核对除权，不用作委托价格。
const VERSION='v0.1-chain-observation';
const finite=Number.isFinite;
const mean=a=>a.length?a.reduce((s,n)=>s+n,0)/a.length:null;
const rate=code=>/^30/.test(code)?.2:.1;
const price=(previous,r)=>Math.round((previous*(1+r)+1e-8)*100)/100;
const same=(a,b)=>finite(a)&&finite(b)&&Math.abs(a-b)<.005;
const defaults={minimumCoverage:.98,maxChecks:250,maxCheckMinutes:4,minimumAmount:100000000,minimumThemeLimits:3,minimumThemeCoverage:.95,earlyTime:'10:30:00',maximumBreaks:3,minimumScore:70,watchScore:50,minimumVolumeRatio:.8,maximumVolumeRatio:4,retreatDownCount:15,retreatFeedback:-.02,risingLimitCount:40,risingPromotion:.3,iceLimitCount:15};

function verifyHistory(raw,adjusted,code,date,calendar){
 const dates=calendar.filter(d=>d<=date).sort(),rows=raw.filter(r=>r.date<=date).sort((a,b)=>a.date.localeCompare(b.date));
 const byDate=new Map(rows.map(r=>[r.date,r])),adj=new Map(adjusted.filter(r=>r.date<=date).map(r=>[r.date,r]));
 if(byDate.size!==rows.length)throw Error('未复权日线日期重复');
 const events=new Map();let streak=0,chainKnown=false;
 for(let i=1;i<dates.length;i++){
  const r=byDate.get(dates[i]),p=byDate.get(dates[i-1]),a=adj.get(dates[i]),ap=adj.get(dates[i-1]);
  if(!r||!p||!a||!ap||![r.open,r.close,r.low,r.high,p.close,a.close,ap.close].every(n=>finite(n)&&n>0)||!(r.volume>0)||r.low>Math.min(r.open,r.close)||r.high<Math.max(r.open,r.close)){
   streak=0;chainKnown=false;events.set(dates[i],{status:'unknown',reason:'停牌、缺日线或价量无效'});continue;
  }
  if(Math.abs((r.close/p.close)-(a.close/ap.close))>.0005){streak=0;chainKnown=false;events.set(dates[i],{status:'unknown',reason:'复权与未复权涨幅不同，需核对除权参考价'});continue;}
  const up=price(p.close,rate(code)),down=price(p.close,-rate(code));
  if(r.high>up+.005||r.low<down-.005){streak=0;chainKnown=false;events.set(dates[i],{status:'unknown',reason:'价格超出常规涨跌幅，需核对特殊交易状态'});continue;}
  const limitUp=same(r.close,up),limitDown=same(r.close,down);streak=limitUp?streak+1:0;
  if(!limitUp)chainKnown=true;
  const chainComplete=chainKnown; // 缺失日或历史窗口边缘之后，直到确认非涨停才恢复精确板数。
  events.set(dates[i],{status:'verified',date:r.date,close:r.close,open:r.open,low:r.low,high:r.high,limitUp,limitDown,touchedUp:same(r.high,up),limitUpPrice:up,limitDownPrice:down,boardCount:limitUp&&chainComplete?streak:null,chainComplete,isOnePrice:limitUp&&same(r.low,up)&&same(r.open,up),isT:limitUp&&same(r.open,up)&&!same(r.low,up),source:r.source||'未复权日线'});
 }
 return {today:events.get(date)||{status:'unknown',reason:'缺目标日日线'},previous:events.get(dates.at(-2))||{status:'unknown',reason:'缺上一交易日'},events:[...events.values()]};
}

function metrics(features,verified,previousDate,coverage,probesComplete){
 const today=[...verified.values()].map(v=>v.today).filter(v=>v.status==='verified');
 const limits=today.filter(v=>v.limitUp),downs=today.filter(v=>v.limitDown),broken=today.filter(v=>v.touchedUp&&!v.limitUp);
 const prior=features.filter(f=>verified.get(f.code)?.previous?.limitUp),feedback=prior.map(f=>f.pct).filter(finite);
 const promoted=prior.filter(f=>verified.get(f.code)?.today?.limitUp).length;
 const priorComplete=probesComplete&&prior.every(f=>f.previousDate===previousDate&&finite(f.pct)&&verified.get(f.code)?.today?.status==='verified');
 return {scope:'主板与创业板；排除ST、退市与上市不足60交易日',coverage,complete:probesComplete,limitCount:limits.length,downCount:downs.length,highestBoard:Math.max(0,...limits.map(v=>v.boardCount||0)),brokenCount:broken.length,breakRate:probesComplete?(broken.length/(limits.length+broken.length)||0):null,previousLimitCount:prior.length,feedback:priorComplete&&prior.length?mean(feedback):null,promotionRate:priorComplete&&prior.length?promoted/prior.length:null};
}

function sentiment(m,previous,settings=defaults){
 const s={...defaults,...settings};
 let state='证据不足',reason='市场覆盖或昨日涨停反馈不完整',allow=[];
 if(m.complete&&m.coverage>=s.minimumCoverage&&finite(m.feedback)&&finite(m.promotionRate)){
  if(m.downCount>=s.retreatDownCount||m.feedback<=s.retreatFeedback){state='退潮';reason='跌停数量或昨日涨停负反馈触及暂停线';}
  else if(m.limitCount<s.iceLimitCount&&m.feedback<0){state='冰点';reason='涨停较少且昨日涨停反馈为负';}
  else if(m.limitCount>=s.risingLimitCount&&m.feedback>0&&m.promotionRate>=s.risingPromotion&&m.breakRate<=.35){state='上升';reason='涨停、昨日反馈与晋级共同达标';allow=[2,3];}
  else if(previous&&['退潮','冰点'].includes(previous.state)&&m.feedback>0){state='修复';reason='前一交易日弱情绪后昨日涨停反馈转正';allow=[2];}
  else {state='高位分歧';reason='基础数据完整，但不满足上升或修复规则';allow=[2];}
 }
 return {state,reason,allowTargetBoards:allow,definition:'初版规则标签，供次日研究；不是市场事实或胜率预测。'};
}

function evaluateCandidate(f,v,pool,themes,emotion,market,settings=defaults){
 const s={...defaults,...settings},boardCount=v.boardCount,targetBoard=boardCount+1;
 const aligned=pool&&same(pool.close,v.close)&&pool.streak===boardCount;
 const timing=aligned?pool.firstTime:null,breaks=aligned&&Number.isInteger(pool.breaks)&&pool.breaks>=0?pool.breaks:null;
 const associated=themes.filter(t=>t.snapshot?.memberCodes?.includes(f.code));
 const themesKnown=associated.some(t=>t.membershipDate===f.date&&t.coverage>=s.minimumThemeCoverage&&t.snapshot?.complete?.firstBoards);
 const strongest=associated.filter(t=>t.membershipDate===f.date&&t.coverage>=s.minimumThemeCoverage&&t.snapshot?.complete?.firstBoards).sort((a,b)=>(b.steps?.find(x=>x.key==='tide')?.limitCount||0)-(a.steps?.find(x=>x.key==='tide')?.limitCount||0))[0];
 const themeLimits=strongest?.steps?.find(x=>x.key==='tide')?.limitCount??null;
 const amount=finite(pool?.amount)&&aligned&&pool.amount>0?pool.amount:(f.capAsOf===f.date&&finite(f.amount)&&f.amount>0?f.amount:null);
 const turnover=aligned&&finite(pool.turnoverRate)&&pool.turnoverRate>0?pool.turnoverRate:null;
 const hard=[],missing=[];
 if(v.isOnePrice)hard.push('当日一字板：初版跳过接力观察');
 if(finite(amount)&&amount<s.minimumAmount)hard.push('成交额低于研究流动性门槛');
 if(themesKnown&&themeLimits<s.minimumThemeLimits)hard.push('已覆盖题材内涨停联动不足');
 if(['退潮','冰点'].includes(emotion.state))hard.push('市场状态暂停新增接力');
 if(!finite(amount))missing.push('目标日成交额');
 if(!timing||breaks===null)missing.push('日期/价格/板数一致的封板记录');
 if(!themesKnown)missing.push('目标日题材与完整首板证据');
 if(!market.complete||market.coverage<s.minimumCoverage)missing.push('市场完整覆盖');
 if(emotion.state==='证据不足')missing.push('市场情绪');
 if(!finite(f.volumeRatio))missing.push('换手量能代理');
 const parts=[
  {label:'市场适配',points:emotion.allowTargetBoards.includes(targetBoard)?20:0,max:20},
  {label:'题材联动',points:themeLimits>=s.minimumThemeLimits?25:0,max:25},
  {label:'早盘封板',points:timing&&timing<=s.earlyTime?15:0,max:15},
  {label:'封板稳定',points:breaks===0?15:breaks!==null&&breaks<=s.maximumBreaks?8:0,max:15},
  {label:'量能适中',points:f.volumeRatio>=s.minimumVolumeRatio&&f.volumeRatio<=s.maximumVolumeRatio?15:0,max:15},
  {label:'成交容量',points:amount>=s.minimumAmount?10:0,max:10}
 ];
 const score=parts.reduce((sum,x)=>sum+x.points,0);
 const grade=hard.length?'D':missing.length?'C':score>=s.minimumScore&&emotion.allowTargetBoards.includes(targetBoard)?'A':score>=s.watchScore?'B':'C';
 return {code:f.code,name:f.name,segment:/^30/.test(f.code)?'创业板':'主板',date:f.date,boardCount,targetBoard,route:boardCount===1?'首板 → 二板观察':'二板 → 三板观察',grade,score,parts,close:v.close,low:v.low,amount,turnoverRate:turnover,volumeRatio:f.volumeRatio,firstTime:timing,breaks,isOnePrice:v.isOnePrice,isT:v.isT,themes:associated.map(t=>({id:t.id,name:t.name})),hard,missing,plan:{status:'盘中条件待验证',patterns:targetBoard===2?['二板弱转强','二板分歧回封']:['三板核心接力'],referenceLow:v.low,nextLimitReference:price(v.close,rate(f.code)),note:'参考低点不是自动止损；次日除权需重算涨停价。买入价、失效价、股数和可成交性需在盘中信号时确定。'},executionStatus:'未产生盘中信号，未成交'};
}

function review(previous,features,date,previousDate,now){
 const usable=previous&&previous.date===previousDate&&!previous.retrospective&&previous.status==='complete'&&Date.parse(previous.frozenAt)<Date.parse(date+'T09:30:00+08:00');
 if(!usable)return {status:'pending',items:[],reason:'没有上一交易日事前冻结的完整名单；历史重扫不计成绩',label:'观察反馈，非交易收益'};
 const cohort=previous.candidates.filter(c=>c.grade!=='D'),map=new Map(features.map(f=>[f.code,f]));
 const items=cohort.map(c=>{const f=map.get(c.code),valid=f&&f.previousDate===previousDate;return {code:c.code,name:c.name,route:c.route,grade:c.grade,score:c.score,openingPremium:valid&&finite(f.openingPremium)?f.openingPremium:null,closeReturn:valid&&finite(f.pct)?f.pct:null,executionStatus:'未导入成交',label:'复权开盘/收盘相对昨日收盘变化，非实际收益'};});
 const complete=items.every(i=>finite(i.openingPremium)&&finite(i.closeReturn));
 return {status:complete?'complete':'partial',baseDate:previousDate,observedAt:now.toISOString(),cohortCount:items.length,validCount:items.filter(i=>finite(i.closeReturn)&&finite(i.openingPremium)).length,averageOpening:complete?mean(items.map(i=>i.openingPremium)):null,averageClose:complete?mean(items.map(i=>i.closeReturn)):null,items,label:'完整冻结名单的次日观察反馈，非交易收益'};
}

module.exports={VERSION,defaults,rate,price,verifyHistory,metrics,sentiment,evaluateCandidate,review};

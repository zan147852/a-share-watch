// 同一套顺序规则供收盘扫描与浏览器复核使用。缺失证据不可由人工勾选覆盖。
(function(root,factory){
 const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.RelayRules=api;
})(typeof globalThis==='object'?globalThis:this,function(){
 const VERSION='v0.2-relay-sequential';
 const defaults={minimumCoverage:.98,minimumLimits:15,maximumDowns:15,minimumFeedback:0,minimumThemeLimits:3,minimumAmount:1e8,earlyTime:'10:30:00',maximumBreaks:3,mainBoardOnly:true,positionCap:3000,maxNewPositions:1,riskFraction:.005,costReserve:20};
 const finite=Number.isFinite;
 function combine(checks){return checks.some(c=>c.status==='fail')?'fail':checks.some(c=>c.status==='unknown')?'unknown':checks.some(c=>c.status==='pending')?'pending':'pass';}
 function check(label,value,ok,detail){return {label,status:value===null||value===undefined?'unknown':ok?'pass':'fail',detail};}
 function gate(key,name,checks){return {key,name,status:combine(checks),checks};}
 function audit(candidate,report,settings={}){
  const s={...defaults,...settings},c=candidate,m=report.metrics||{};
  const coverage=finite(m.coverage)?m.coverage:report.coverage;
  const stages=[gate('route','目标板数',[
   check('连续收盘涨停板数',Number.isInteger(c.boardCount)?c.boardCount:null,Number.isInteger(c.boardCount)&&c.boardCount>=1&&c.targetBoard===c.boardCount+1,`昨日 ${c.boardCount??'未知'} 板 → 目标 ${c.targetBoard??'未知'} 板`),
   check('普通主板',c.segment,s.mainBoardOnly?c.segment==='主板':true,s.mainBoardOnly?'初期仅做普通沪深主板':'允许主板与创业板，涨跌幅规则分别核验')
  ]),gate('market','市场环境',[
   check('行情覆盖',finite(coverage)?coverage:null,coverage>=s.minimumCoverage,`至少 ${(s.minimumCoverage*100).toFixed(0)}%，实际 ${finite(coverage)?(coverage*100).toFixed(2)+'%':'未知'}`),
   check('涨跌停与前日反馈完整',m.complete===true?true:null,true,m.complete===true?'已完成事实核验':'缺数据，不能推断完整环境'),
   check('晋级数据完整',finite(m.promotionRate)?m.promotionRate:null,true,finite(m.promotionRate)?`实际 ${(m.promotionRate*100).toFixed(2)}%，仅要求数据完整`:'未知'),
   check('昨日涨停平均反馈',finite(m.feedback)?m.feedback:null,m.feedback>=s.minimumFeedback,`不低于 ${(s.minimumFeedback*100).toFixed(2)}%，实际 ${finite(m.feedback)?(m.feedback*100).toFixed(2)+'%':'未知'}`),
   check('收盘涨停数量',finite(m.limitCount)&&m.complete===true?m.limitCount:null,m.limitCount>=s.minimumLimits,`至少 ${s.minimumLimits} 只；已核验 ${m.limitCount??'未知'} 只${m.complete===true?'':'（下限）'}`),
   check('收盘跌停数量',finite(m.downCount)&&m.complete===true?m.downCount:null,m.downCount<s.maximumDowns,`少于 ${s.maximumDowns} 只；已核验 ${m.downCount??'未知'} 只${m.complete===true?'':'（下限）'}`),
   // 已核验下限触及暂停线即排除，不等待其余数据补齐。
   check('跌停下限未触线',finite(m.downCount)?m.downCount:null,m.downCount<s.maximumDowns,`已核验跌停 ≥${s.maximumDowns} 时直接暂停`)
  ]),gate('theme','题材联动',[
   check('目标日题材成分与涨停核验',c.themeEvidence?.complete===true?true:null,true,c.themeEvidence?.name||'缺少完整的产业题材证据'),
   check('同题材收盘涨停',finite(c.themeEvidence?.limitCount)?c.themeEvidence.limitCount:null,c.themeEvidence?.limitCount>=s.minimumThemeLimits,`至少 ${s.minimumThemeLimits} 只，实际 ${c.themeEvidence?.limitCount??'未知'}`)
  ]),gate('stock','封板与成交',[
   check('目标日成交额',finite(c.amount)?c.amount:null,c.amount>=s.minimumAmount,`至少 ${(s.minimumAmount/1e8).toFixed(2)} 亿元，实际 ${finite(c.amount)?(c.amount/1e8).toFixed(2)+'亿元':'未知'}`),
   check('首次封板时间',typeof c.firstTime==='string'&&/^\d{2}:\d{2}:\d{2}$/.test(c.firstTime)?c.firstTime:null,c.firstTime<=s.earlyTime,`不晚于 ${s.earlyTime}，实际 ${c.firstTime||'未知'}`),
   check('盘中开板次数',Number.isInteger(c.breaks)&&c.breaks>=0?c.breaks:null,c.breaks<=s.maximumBreaks,`不超过 ${s.maximumBreaks} 次，实际 ${c.breaks??'未知'}`),
   check('排除一字板',typeof c.isOnePrice==='boolean'?c.isOnePrice:null,c.isOnePrice===false,c.isOnePrice===true?'昨日一字板，跳过':c.isOnePrice===false?'昨日非一字板':'未知')
  ])];
  if(c.targetBoard>=4)stages[3].checks.push(check('高板连续缩量后首次放量开板',typeof c.highBoardRisk==='boolean'?c.highBoardRisk:null,c.highBoardRisk===false,c.highBoardRisk===true?'此前两个连板成交量依次缩小，昨日放量且开板，排除':c.highBoardRisk===false?'未触发此排除项':'缺此前三个交易日量能或封板记录'));
  stages[3].status=combine(stages[3].checks);
  stages.push(gate('intraday','盘中回封确认',[{label:'业务、催化与实时题材',status:'pending',detail:'核实公司业务与催化依据；记录另外至少2只题材股高于昨收；核心连板未明显走弱'},{label:'真实回封过程',status:'pending',detail:'记录触板 → 板下成交 → 回到实际涨停价且出现新封单的时间；日线不提供触发信号'}]));
  stages.push(gate('plan','仓位与退出计划',[{label:'事前计划',status:'pending',detail:`每只金额上限 ${s.positionCap} 元、每日最多新买 ${s.maxNewPositions} 只；100股整数单位；填写失效位、次日与时间退出条件`} ]));
  const firstBlock=stages.find(g=>g.status!=='pass');
  const rejected=stages.some(g=>g.status==='fail'),unknown=stages.some(g=>g.status==='unknown');
  return {version:VERSION,stages,eodPassed:stages.slice(0,4).every(g=>g.status==='pass'),status:rejected?'excluded':unknown?'insufficient':'awaiting_manual',firstBlock:firstBlock?.name||null,summary:rejected?'规则排除':unknown?'证据不足':'盘后条件通过，等待人工盘中复核'};
 }
 function planSize({equity,entry,stop,positionCap=3000,riskFraction=.005,costReserve=20}){
  if(![equity,entry,stop,positionCap,riskFraction,costReserve].every(finite)||equity<=0||entry<=stop||stop<=0||positionCap<=0||riskFraction<=0||riskFraction>.02||costReserve<0)throw Error('请输入有效本金、涨停价、低于买价的失效位、金额上限和费用预留');
  const riskBudget=equity*riskFraction;
  const shares=Math.max(0,Math.floor(Math.min(Math.max(0,riskBudget-costReserve)/(entry-stop),Math.min(equity,positionCap)/entry)/100)*100);
  return {shares,positionAmount:shares*entry,riskBudget,plannedRisk:shares?shares*(entry-stop)+costReserve:0,stressLoss20:shares*entry*.2};
 }
 function validateManual(draft,candidate,report,settings={}){
  const s={...defaults,...settings},a=audit(candidate,report,s),reasons=[];
  if(!a.eodPassed)reasons.push('盘后顺序条件未全部通过，人工记录不能覆盖缺项或排除项');
  const validDay=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
  if(!validDay(draft.tradeDate)||draft.tradeDate<=report.date)reasons.push('目标交易日必须晚于报告日，并按实际交易日填写');
  for(const key of ['businessEvidence','invalidation','nextDayExit','timeExit'])if(typeof draft[key]!=='string'||!draft[key].trim())reasons.push({businessEvidence:'公司业务与催化原文依据',invalidation:'理由失效条件',nextDayExit:'次日退出条件',timeExit:'时间退出条件'}[key]+'未填写');
  if(draft.catalystValid!==true)reasons.push('催化和业务依据未确认仍有效');
  if(draft.marketStable!==true)reasons.push('盘中核心连板未明显走弱尚未确认');
  const peers=Array.isArray(draft.peers)?draft.peers:[];
  if(peers.length<2||new Set(peers.map(p=>p.code)).size!==peers.length||peers.some(p=>!/^\d{6}$/.test(p.code)||p.code===candidate.code||!finite(p.price)||!finite(p.previousClose)||p.price<=p.previousClose))reasons.push('至少填写2只不同题材同伴的代码、现价与昨收，并确认现价高于昨收');
  if(typeof draft.peerEvidence!=='string'||!draft.peerEvidence.trim())reasons.push('同伴题材归属依据未填写');
  const clock=t=>typeof t==='string'&&/^\d{2}:\d{2}:\d{2}$/.test(t)&&((t>='09:30:00'&&t<='11:30:00')||(t>='13:00:00'&&t<='14:57:00'));
  if(![draft.touchedAt,draft.openedAt,draft.resealedAt].every(clock)||!(draft.touchedAt<draft.openedAt&&draft.openedAt<draft.resealedAt))reasons.push('触板、板下成交、回封时间必须按先后顺序填写连续竞价时段');
  const observed=Date.parse(draft.observedAt),resealed=Date.parse(draft.tradeDate+'T'+draft.resealedAt+'+08:00');
  if(!finite(observed)||!finite(resealed)||observed<resealed||observed>=Date.parse(draft.tradeDate+'T15:00:00+08:00')||new Date(observed+8*3600000).toISOString().slice(0,10)!==draft.tradeDate)reasons.push('复核时间须为目标交易日回封之后、收盘之前；未来或历史记录不能导出为当前事前计划');
  if(draft.newSeal!==true)reasons.push('回到实际涨停价后的新封单未确认');
  if(!finite(draft.entry)||!finite(draft.limitPrice)||Math.abs(draft.entry-draft.limitPrice)>.00001)reasons.push('计划买价必须等于人工核对的当日实际涨停价');
  if(!Number.isInteger(draft.newPositions)||draft.newPositions<0||draft.newPositions>=s.maxNewPositions)reasons.push('今日新增持仓数量已触及上限或未填写');
  let sizing=null;try{sizing=planSize({...draft,positionCap:s.positionCap,riskFraction:s.riskFraction,costReserve:s.costReserve});if(!sizing.shares)reasons.push('金额或风险预算不足买入100股');}catch(e){reasons.push(e.message);}
  return {status:reasons.length?'blocked':'manual_review',reasons,sizing,label:reasons.length?'继续观察，不进入委托复核':'人工记录齐全，仍需核对实时行情与可成交性',note:'用户填写记录，不是自动识别、买入信号、委托或成交。排队期间再次开板撤销未成交委托；实际损失可能超出计划。'};
 }
 function snapshotCandidates(snapshot,report){
  if(snapshot?.date!==report.date)return [];
  const present=new Set((report.candidates||[]).map(c=>c.code)),features=new Map((snapshot.features||[]).map(f=>[f.code,f])),pool=new Map((snapshot.pool?.items||[]).map(p=>[p.code,p]));
  return (snapshot.verified||[]).filter(x=>x.today?.status==='verified'&&x.today.limitUp&&Number.isInteger(x.today.boardCount)&&x.today.boardCount>=3&&!present.has(x.code)).map(x=>{
   const f=features.get(x.code)||{},v=x.today,p=pool.get(x.code),aligned=p&&finite(p.close)&&Math.abs(p.close-v.close)<.005&&p.streak===v.boardCount;
   return {code:x.code,name:f.name||x.code,segment:/^30/.test(x.code)?'创业板':'主板',date:report.date,boardCount:v.boardCount,targetBoard:v.boardCount+1,route:`${v.boardCount}板 → ${v.boardCount+1}板观察`,grade:'C',score:null,parts:[],close:v.close,low:v.low,amount:aligned&&finite(p.amount)?p.amount:f.capAsOf===report.date?f.amount:null,firstTime:aligned?p.firstTime:null,breaks:aligned?p.breaks:null,isOnePrice:v.isOnePrice,isT:v.isT,highBoardRisk:null,volumeRatio:f.volumeRatio,themes:[],hard:[],missing:['旧版快照补充，缺完整题材与高板量能证据'],plan:{patterns:['高板分歧回封'],referenceLow:v.low,note:'旧版快照事实补充，非原冻结候选；当前规则复核不计事前成绩。'},executionStatus:'没有盘中信号或成交',snapshotSupplement:true};
  });
 }
 return {VERSION,defaults,audit,planSize,validateManual,snapshotCandidates};
});

const fs=require('fs'),path=require('path'),provider=require('./provider'),themes=require('./theme-provider'),store=require('./store'),time=require('./time'),strategy=require('./strategy');
const TITLES=['消息级别','首板潮','容量中军','老龙异动','次日验证'];
const ALIASES=[
 ['人工智能|AI|AIGC|大模型|算力|数据中心|云计算',['人工智能','大模型','算力','智算','数据中心','AI','AIGC']],
 ['机器人|人形|机器视觉',['机器人','人形机器人','具身智能']],
 ['芯片|半导体|集成电路|光刻',['芯片','半导体','集成电路','光刻']],
 ['鸿蒙',['鸿蒙','HarmonyOS']],['华为汽车|汽车电子|智能汽车|无人驾驶',['智能汽车','自动驾驶','无人驾驶','华为汽车','鸿蒙智行']],
 ['光伏|钙钛矿|TOPCon|BC电池',['光伏','钙钛矿','TOPCon','BC电池']],
 ['储能',['储能','配储']],['锂电',['锂电','锂离子电池']],['锂矿',['锂矿','锂资源','碳酸锂']],['固态电池',['固态电池','全固态','半固态']],['钠电池|钠离子',['钠电池','钠离子']],
 ['创新药|医疗|生物医药',['创新药','医药','医疗','临床','新药']],
 ['军工|航天|卫星',['军工','商业航天','卫星','航空航天']],['低空|通用航空',['低空经济','通用航空','eVTOL']],
 ['房地产|地产',['房地产','楼市','住房','购房']],['券商|证券',['券商','证券','资本市场']],
 ['稀土|永磁',['稀土','永磁']],['农业|种业|粮食',['农业','种业','粮食']],
 ['消费|食品|家电|白酒',['消费','食品','家电','白酒']],['电力|电网|特高压',['电力','电网','特高压']],
 ['铜|铝|黄金|有色',['铜','铝','黄金','有色金属']]
];
const mean=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
const finite=n=>Number.isFinite(n);
function isTheme(name){return !/昨日|涨停|连板|准ST|超大盘|大盘股|小盘股|次新|新股|重仓|持股|参股金融|金融参股|上证50|央企50|沪深300|中证|沪股通|深股通|融资融券|转融券|MSCI|富时|破净|破发|高送转|预盈|预亏|预增|预减/.test(name);}
function step(index,status,summary,details={}){return {key:['news','tide','capacity','oldLeader','nextDay'][index],name:TITLES[index],status,summary,...details};}
function change(a,b){return finite(a)&&finite(b)&&b>0?a/b-1:null;}
function rate(code){return /^30/.test(code)?.2:.1;}
function dailyFeature(item,input,date){
 const rows=input.filter(r=>r.date<=date).sort((a,b)=>a.date.localeCompare(b.date)),current=rows.find(r=>r.date===date),prior=rows.filter(r=>r.date<date);
 if(!current||prior.length<60)return null;
 const previous=prior.at(-1),volumes=prior.slice(-5).map(r=>r.volume).filter(v=>finite(v)&&v>0),pct=change(current.close,previous.close);
 const past=prior.slice(-61),approxBoards=[];let chain=0,maxChain=0;
 for(let i=1;i<past.length;i++){
  const rise=change(past[i].close,past[i-1].close);
  const nearLimit=finite(rise)&&rise>=rate(item.code)-.02&&rise<=rate(item.code)+.02;
  if(nearLimit){approxBoards.push(past[i].date);chain++;maxChain=Math.max(maxChain,chain);}else chain=0;
 }
 return {code:item.code,name:item.name,market:item.market,date,close:current.close,open:current.open,high:current.high,low:current.low,volume:current.volume,
  pct,openingPremium:change(current.open,previous.close),previousPct:change(previous.close,prior.at(-2)?.close),
  breakout:current.close>Math.max(...prior.slice(-20).map(r=>r.high)),volumeRatio:volumes.length===5&&mean(volumes)>0?current.volume/mean(volumes):null,
  cap:finite(item.cap)&&item.cap>0?item.cap:null,capAsOf:item.capAsOf||null,amount:finite(item.amount)?item.amount:null,
  approxBoards,priorMaxChain:maxChain,possibleLimit:finite(pct)&&pct>=rate(item.code)-.02&&pct<=rate(item.code)+.02};
}
function exactLimitHistory(raw,adjusted,code,date){
 const rows=raw.filter(r=>r.date<=date).sort((a,b)=>a.date.localeCompare(b.date)),adj=new Map(adjusted.map(r=>[r.date,r]));
 const events=new Map();let streak=0;
 for(let i=1;i<rows.length;i++){
  const row=rows[i],previous=rows[i-1],price=Math.round((previous.close*(1+rate(code))+1e-8)*100)/100;
  const ar=adj.get(row.date),ap=adj.get(previous.date),consistent=ar&&ap&&Math.abs(change(ar.close,ap.close)-change(row.close,previous.close))<.003;
  const valid=consistent&&Math.abs(row.close-price)<.005&&row.high>=row.close&&row.volume>0;
  if(valid){streak++;events.set(row.date,{date:row.date,close:row.close,streak});}else streak=0;
 }
 const priorDates=adjusted.filter(r=>r.date<date).slice(-60).map(r=>r.date),eligibleDates=new Set(priorDates),old=Array.from(events.values()).filter(e=>e.date<date&&eligibleDates.has(e.date));
 const oldCycle=old.filter(e=>e.date<(priorDates.at(-5)||date));
 return {complete:rows.filter(r=>r.date<date).length>=60,close:rows.find(r=>r.date===date)?.close||null,events:old.map(e=>e.date),oldEvents:oldCycle.map(e=>e.date),priorMaxChain:Math.max(0,...oldCycle.map(e=>e.streak)),today:events.get(date)||null,source:rows.at(-1)?.source};
}
function classifyNews(item){
 const text=(item.title||'')+' '+(item.content||'');
 if(/辟谣|不实|传闻|网传|未经证实|否认|未开展|未从事|未参与|未生产|未研发|不生产|并非|尚无|不存在|无相关|尚未|不涉及/.test(text))return {tier:'传闻/否认',rank:0,catalyst:false,reason:'含传闻、否认或未落实措辞'};
 const action=/发布|印发|出台|批准|通过|实施|下达|启动|落地|获批|签订|签署|中标|投产|量产|订单|采购|补贴|降息|降准/.test(text);
 if(/国务院|中共中央|全国人大/.test(text)&&action)return {tier:'国家级政策线索',rank:4,catalyst:true,reason:'国家级机构与实施动作关键词命中'};
 if(/国家发展改革委|国家发改委|工信部|工业和信息化部|财政部|商务部|科技部|国家能源局|中国人民银行|证监会/.test(text)&&action)return {tier:'部委政策线索',rank:3,catalyst:true,reason:'部委机构与实施动作关键词命中'};
 if(/省政府|市政府|省人民政府|市人民政府|研究院|协会|信通院/.test(text)&&action)return {tier:'地方/产业事件',rank:2,catalyst:true,reason:'地方或产业机构动作关键词命中'};
 if(action&&(item.stockCodes?.length||/公司|集团|企业/.test(text)))return {tier:'公司事件',rank:1,catalyst:true,reason:'公司关联及事件动作关键词命中'};
 return {tier:'一般资讯',rank:0,catalyst:false,reason:'未识别明确实施动作'};
}
function matchNews(name,news,date){
 const direct=name.replace(/概念|板块|行业/g,''),keys=new Set(direct.length>=2?[direct]:[]);
 for(const [pattern,aliases]of ALIASES)if(new RegExp(pattern,'i').test(name))for(const key of aliases)keys.add(key);
 const cutoff=Date.parse(date+'T15:00:00+08:00');
 return (news.items||[]).filter(n=>Date.parse(n.publishedAt)<=cutoff).map(n=>{
  const text=(n.title||'')+' '+(n.subjects||[]).join(' '),hits=[...keys].filter(k=>new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i').test(text));
  return {...n,classification:classifyNews(n),matchedKeywords:hits};
 }).filter(n=>n.matchedKeywords.length).sort((a,b)=>b.classification.rank-a.classification.rank||b.publishedAt.localeCompare(a.publishedAt));
}
function priorUsable(prior,date,previousDate){
 return Boolean(prior&&prior.schema===1&&prior.date===previousDate&&!prior.retrospective&&Date.parse(prior.frozenAt)<Date.parse(date+'T09:30:00+08:00'));
}
function validateNext(prior,features,date,previousDate,settings){
 if(!priorUsable(prior,date,previousDate))return step(4,'pending','缺少前一交易日事前冻结名单，不能事后补选赢家');
 if(!prior.snapshot?.complete?.firstBoards||!prior.snapshot?.complete?.capacity)return step(4,'unknown','昨日冻结的首板或中军范围不完整，不能计算完整留存');
 const first=prior.snapshot.firstBoards||[],leaders=prior.snapshot.leaders||[],capacity=prior.snapshot.capacity||[],byCode=new Map(features.map(f=>[f.code,f]));
 const observations=items=>items.map(x=>{const f=byCode.get(x.code);return {code:x.code,name:x.name,openingPremium:f?.openingPremium??null,closeReturn:f?.pct??null,heldPositive:finite(f?.pct)&&f.pct>0};});
 const firstObs=observations(first),leaderObs=observations(leaders),capObs=observations(capacity),all=[...firstObs,...leaderObs,...capObs];
 if(!first.length||!leaders.length||!capacity.length||all.some(o=>!finite(o.closeReturn)||!finite(o.openingPremium)))return step(4,'unknown','冻结名单存在，但首板/领涨/中军数据不完整',{baseDate:prior.date,first:firstObs,leaders:leaderObs,capacity:capObs});
 const retention=firstObs.filter(o=>o.heldPositive).length/first.length,leaderPremium=mean(leaderObs.map(o=>o.openingPremium));
 const capacityFloor=Math.min(...capObs.flatMap(o=>[o.openingPremium,o.closeReturn]));
 const passed=leaderPremium>=settings.nextLeaderOpenPremium&&retention>=settings.nextFirstBoardRetention&&capacityFloor>=settings.nextCapacityFloor;
 return step(4,passed?'pass':'fail',passed?'冻结名单的次日规则验证通过':'冻结名单出现次日负反馈',{baseDate:prior.date,retention,leaderPremium,capacityFloor,first:firstObs,leaders:leaderObs,capacity:capObs,definition:'首板留存=昨日首板今日收盘仍高于昨日收盘；不是继续涨停比例。溢价使用复权日线开盘/前收，次日收盘后才完成验证。'});
}
function evaluateTheme({node,members,features,pool,raw,news,prior,index,date,previousDate,membershipDate,settings}){
 const codes=new Set(members.map(m=>m.code)),byCode=new Map(features.map(f=>[f.code,f])),valid=members.map(m=>byCode.get(m.code)).filter(Boolean),coverage=members.length?valid.length/members.length:0;
 const matches=matchNews(node.name,news,date),catalysts=matches.filter(n=>n.classification.catalyst);
 const newsStep=step(0,catalysts.length?'review':news.complete?'fail':'unknown',catalysts.length?catalysts[0].classification.tier+'：待原文与业务受益复核':news.complete?'采集范围内未识别题材催化':'消息覆盖不完整，暂不能判断催化',{items:matches.slice(0,5).map(({content,...item})=>item),coverage:news.status,definition:'机器按媒体标题/原文关键词分级；不把媒体A/B/C等级当政策级别，不推断消息首次公开或公司实际受益。'});
 const limits=valid.filter(f=>raw[f.code]?.today&&raw[f.code]?.complete).map(f=>{
  const verified=raw[f.code],fromPool=(pool.items||[]).find(p=>p.code===f.code),aligned=fromPool&&Math.abs(fromPool.close-verified.close)<.011&&fromPool.streak===verified.today.streak;
  return {code:f.code,name:f.name,close:verified.close,streak:verified.today.streak,firstTime:aligned?fromPool.firstTime:null,breaks:aligned?fromPool.breaks:null,source:aligned?fromPool.source:'未复权日线复核'};
 });
 const first=limits.filter(l=>l.streak===1),early=first.filter(l=>l.firstTime&&l.firstTime<=settings.openingWindowEnd),missingLimits=valid.filter(f=>f.possibleLimit&&!raw[f.code]?.complete).length;
 const upBreadth=valid.length?valid.filter(f=>f.pct>0).length/valid.length:0,breakoutBreadth=valid.length?valid.filter(f=>f.breakout).length/valid.length:0;
 const vol=valid.map(f=>f.volumeRatio).filter(finite),volumeRatio=mean(vol),volumeCoverage=valid.length?vol.length/valid.length:0;
 const proxy=coverage>=settings.minimumMemberCoverage&&volumeCoverage>=settings.minimumMemberCoverage&&upBreadth>=settings.minimumUpBreadth&&breakoutBreadth>=settings.minimumBreakoutBreadth&&volumeRatio>=settings.minimumVolumeRatio;
 const actualIndex=Boolean(index?.passed),tideComplete=coverage>=settings.minimumMemberCoverage&&missingLimits===0;
 let tideStatus='unknown',tideText='首板或成分覆盖不足';
 if(tideComplete){
  if(first.length<settings.minimumFirstBoards){tideStatus='fail';tideText='收盘首板不足 '+settings.minimumFirstBoards+' 家';}
  else if(first.some(f=>!f.firstTime)){tideStatus='review';tideText='收盘首板共振，首次封板时间待核验';}
  else if(early.length<settings.minimumFirstBoards){tideStatus='fail';tideText='09:25—10:30首板不足 '+settings.minimumFirstBoards+' 家';}
  else if(actualIndex){tideStatus='pass';tideText='早盘首板与板块指数放量突破共振';}
  else{tideStatus='review';tideText=proxy?'早盘首板与成分广度共振，板块指数待核验':'早盘首板达标，板块放量突破尚未确认';}
 }
 const tideStep=step(1,tideStatus,tideText,{firstBoards:first,earlyCount:early.length,limitCount:limits.length,coverage,missingLimits,upBreadth,breakoutBreadth,volumeRatio,volumeCoverage,index,proxyPassed:proxy,definition:'早盘窗口含集合竞价首次封板09:25至10:30；只统计收盘仍涨停且非连续涨停的首板。广度/量比是成分代理，不能替代官方板块指数创新高；不包含盘中炸板后未回封股票。'});
 const capValid=membershipDate===date,capMembers=valid.filter(f=>capValid&&finite(f.cap)&&f.capAsOf===date&&f.cap>=settings.capacityMinCap).sort((a,b)=>(b.amount||0)-(a.amount||0)||b.cap-a.cap).slice(0,settings.capacityTopCount);
 const capStocks=capMembers.map(f=>({code:f.code,name:f.name,cap:f.cap,pct:f.pct,volumeRatio:f.volumeRatio,participating:f.pct>=settings.capacityMinimumRise&&finite(f.volumeRatio)&&f.volumeRatio>=settings.minimumVolumeRatio}));
 const capCovered=valid.filter(f=>finite(f.cap)&&f.capAsOf===date).length/Math.max(1,members.length),capReady=capValid&&capCovered>=settings.minimumMemberCoverage;
 const capPass=capStocks.some(c=>c.participating);
 const capacityStep=step(2,capReady?(capPass?'pass':'fail'):'unknown',!capReady?'缺目标日市值或成分覆盖，不能确认中军':capPass?'百亿以上容量候选参与上涨':'容量候选未达到涨幅与放量门槛',{stocks:capStocks,coverage:capCovered,definition:'总市值≥100亿元，按目标日成交额挑前3只；至少1只涨幅≥2%且成交量/此前5日均量≥1.2。大市值只提供容量候选身份。'});
 const oldPool=valid.filter(f=>raw[f.code]?.complete&&raw[f.code].oldEvents.length>=settings.oldLeaderMinimumBoards&&raw[f.code].priorMaxChain>=2).sort((a,b)=>raw[b.code].priorMaxChain-raw[a.code].priorMaxChain||raw[b.code].oldEvents.length-raw[a.code].oldEvents.length).slice(0,settings.oldLeaderTopCount);
 const oldStocks=oldPool.map(f=>({code:f.code,name:f.name,pastBoards:raw[f.code].oldEvents.length,maxChain:raw[f.code].priorMaxChain,dates:raw[f.code].oldEvents.slice(-5),previousPct:f.previousPct,pct:f.pct,advanced:finite(f.previousPct)&&f.previousPct>=settings.oldLeaderMinimumRise,currentActive:f.pct>=settings.oldLeaderMinimumRise&&f.volumeRatio>=settings.minimumVolumeRatio}));
 const uncheckedOld=valid.filter(f=>f.approxBoards.length>=settings.oldLeaderMinimumBoards&&f.priorMaxChain>=2&&!raw[f.code]?.complete).length;
 const oldReady=coverage>=settings.minimumMemberCoverage&&uncheckedOld===0,oldPass=oldStocks.some(f=>f.advanced&&f.currentActive);
 const oldStep=step(3,oldReady?(oldPass?'pass':'fail'):'unknown',!oldReady?'历史强势候选尚未完整复核':oldPass?'历史强势候选前一交易日已异动，今日延续':'历史强势候选未出现规则要求的提前异动',{stocks:oldStocks,unchecked:uncheckedOld,definition:'在目标日之前60个交易日，排除最近5个交易日，至少3次涨停且曾2连板；前一交易日涨≥3%，今日涨≥3%且量比≥1.2。属于历史强势代理，题材归属和老龙身份仍需复核。'});
 const nextStep=validateNext(prior,features,date,previousDate,settings),steps=[newsStep,tideStep,capacityStep,oldStep,nextStep];
 const firstFourReady=steps.slice(0,4).every(s=>['pass','review'].includes(s.status)),negative=steps.some(s=>s.status==='fail');
 const state=negative?'条件不符':firstFourReady?(nextStep.status==='pass'?'五步规则共振，待事实复核':'主线观察候选，待次日验证'):'证据不足';
 const highest=Math.max(0,...limits.map(l=>l.streak)),leaders=limits.filter(l=>l.streak===highest).sort((a,b)=>(a.firstTime||'99').localeCompare(b.firstTime||'99')).slice(0,2);
 return {id:node.id,name:node.name,date,membershipDate,retrospective:membershipDate>date,memberCount:members.length,coverage,pct:mean(valid.map(f=>f.pct)),state,steps,
  snapshot:{memberCodes:[...codes].sort(),firstBoards:first,leaders,capacity:capStocks,oldLeaders:oldStocks,complete:{firstBoards:coverage===1&&missingLimits===0,capacity:capReady}},
  passedCount:steps.filter(s=>s.status==='pass').length,reviewCount:steps.filter(s=>s.status==='review').length,
  definition:'各阈值为v0.3初版研究规则，未证明预测收益；五步规则共振仍不等于买入许可。'};
}
async function build({root,date,previousDate,features,candidates,news,boards,config,now=new Date(),out}){
 const settings=config.mainline,errors=[],retrospective=date<time.dateToday(now),frozenAt=new Date().toISOString();
 const file=path.join(out,'mainline-'+date+'.json'),existing=store.read(file);
 if(existing?.schema===1&&!existing.retrospective&&existing.date===date){attachCandidates(candidates,existing.themes);return existing;}
 let catalog;try{catalog=await themes.concepts(root,config.scanner,now);}catch(e){return {schema:1,date,status:'failed',frozenAt,retrospective,themes:[],validations:[],errors:[e.message]};}
 errors.push(...catalog.errors);const featureMap=new Map(features.map(f=>[f.code,f]));
 const deduped=new Map();for(const node of catalog.items.filter(n=>isTheme(n.name))){const key=node.name.replace(/概念|板块/g,'');if(!deduped.has(key)||deduped.get(key).members.length<node.members.length)deduped.set(key,node);}
 const nodes=[...deduped.values()].map(node=>{const members=node.members.filter(m=>strategy.isAllowed(m,config.strategy)),valid=members.map(m=>featureMap.get(m.code)).filter(Boolean);return {node,members,pct:mean(valid.map(f=>f.pct))};}).filter(x=>x.members.length>=3);
 nodes.sort((a,b)=>(b.pct??-99)-(a.pct??-99)||a.node.id.localeCompare(b.node.id));
 const previous=store.read(path.join(out,'mainline-'+previousDate+'.json'));
 const priorThemes=new Map((previous?.themes||[]).map(t=>[t.id,{...t,schema:previous.schema,frozenAt:previous.frozenAt,retrospective:previous.retrospective||t.retrospective}]));
 const priorIds=new Set(priorThemes.keys()),selected=[...nodes.slice(0,settings.maxThemes),...nodes.filter(x=>priorIds.has(x.node.id)&&!nodes.slice(0,settings.maxThemes).some(y=>y.node.id===x.node.id))];
 const pool=await themes.limitPool(root,date,config.scanner,now);if(pool.error)errors.push({name:'涨停池',error:pool.error});
 const need=new Map();
 for(const {members}of selected){
  const valid=members.map(m=>featureMap.get(m.code)).filter(Boolean);
  for(const f of valid.filter(f=>f.possibleLimit))need.set(f.code,{f,priority:0});
  for(const f of valid.filter(f=>f.approxBoards.length>=settings.oldLeaderMinimumBoards&&f.priorMaxChain>=2).sort((a,b)=>b.priorMaxChain-a.priorMaxChain||b.approxBoards.length-a.approxBoards.length))if(!need.has(f.code))need.set(f.code,{f,priority:1});
 }
 const raw={},requests=[...need.values()].sort((a,b)=>a.priority-b.priority).slice(0,settings.maxRawChecks);
 const verified=await provider.pool(requests,config.scanner.concurrency,async({f})=>{
  const secid=f.market+'.'+f.code,rows=await provider.cachedDaily(path.join(root,'.cache'),secid,date,config.scanner,0),adj=store.read(path.join(root,'.cache',secid+'-'+date+'-f1.json'));
  if(!adj)throw Error('缺复权交叉核验日线');return {code:f.code,history:exactLimitHistory(rows,adj,f.code,date)};
 });
 for(const r of verified)if(r.ok)raw[r.value.code]=r.value.history;else errors.push({name:r.item.f.code,error:r.error});
 if(need.size>requests.length)errors.push({name:'历史复核',error:'达到本轮 '+settings.maxRawChecks+' 只上限，其余候选保持待核验'});
 const items=selected.map(({node,members})=>evaluateTheme({node,members,features,pool,raw,news,prior:priorThemes.get(node.id),index:(boards?.items||[]).find(b=>b.name.replace(/概念|板块/g,'')===node.name.replace(/概念|板块/g,''))||null,date,previousDate,membershipDate:catalog.date,settings}));
 items.sort((a,b)=>b.passedCount-a.passedCount||b.reviewCount-a.reviewCount||(b.pct??-99)-(a.pct??-99));
 const validations=(previous?.themes||[]).map(t=>({id:t.id,name:t.name,previousState:t.state,...validateNext({...t,schema:previous.schema,frozenAt:previous.frozenAt,retrospective:previous.retrospective||t.retrospective},features,date,previousDate,settings)}));
 const report={schema:1,version:'v0.3-mainline',date,previousDate,status:catalog.complete&&verified.every(r=>r.ok)&&pool.complete&&news.complete?'complete':'partial',frozenAt,retrospective,membershipDate:catalog.date,catalog:{source:catalog.source,total:catalog.total,valid:catalog.items.length},pool:{status:pool.status,count:pool.items.length,error:pool.error||null},news:{status:news.status,count:news.items?.length||0},themes:items,validations,settings,errors,
  note:'收盘生成五步证据；盘中密集爆发只使用首次封板记录，无法还原全部炸板。榜单最多取目标日成分均涨幅前20个概念并保留昨日题材；当前成分与关键词关联不证明公司受益。'};
 store.write(file,report);
 attachCandidates(candidates,items);
 return report;
}
function attachCandidates(candidates,items){for(const c of candidates)c.mainline=items.filter(t=>t.snapshot.memberCodes.includes(c.code)).map(t=>({id:t.id,name:t.name,state:t.state,passedCount:t.passedCount}));}
module.exports={dailyFeature,exactLimitHistory,classifyNews,matchNews,evaluateTheme,validateNext,priorUsable,isTheme,build};

const fs=require('fs'),path=require('path'),provider=require('./provider'),store=require('./store'),time=require('./time'),themes=require('./theme-provider'),chain=require('./chain');

function marketFeature(item,input,date){
 const rows=input.filter(r=>r.date<=date).sort((a,b)=>a.date.localeCompare(b.date)),r=rows.find(r=>r.date===date),prior=rows.filter(r=>r.date<date),p=prior.at(-1),pp=prior.at(-2);
 if(!r||prior.length<60||!p)return null;
 const vol=prior.slice(-5).map(x=>x.volume),complete=vol.length===5&&vol.every(v=>Number.isFinite(v)&&v>0);
 return {code:item.code,name:item.name,market:item.market,date,previousDate:p.date,close:r.close,open:r.open,high:r.high,low:r.low,previousClose:p.close,pct:r.close/p.close-1,highReturn:r.high/p.close-1,previousPct:pp?p.close/pp.close-1:null,openingPremium:r.open/p.close-1,volume:r.volume,volumeRatio:complete?r.volume/(vol.reduce((a,b)=>a+b,0)/5):null,amount:item.amount,cap:item.cap,capAsOf:item.capAsOf||null,source:r.source||null,priceBasis:'前复权日线；不得作为委托价'};
}

async function build({root,out,date,previousDate,calendar,features,universe,totalUniverse,mainline,config,now=new Date(),progress=()=>{}}){
 const settings={...chain.defaults,...config.chain},file=path.join(out,'chain-'+date+'.json'),existing=store.read(file);
 if(existing?.schema===1&&existing.version===chain.VERSION&&existing.status==='complete'&&!existing.retrospective)return existing;
 const generatedAt=now.toISOString(),retrospective=date<time.dateToday(now),coverage=totalUniverse?features.length/totalUniverse:0;
 const missingCodes=universe.filter(i=>!features.some(f=>f.code===i.code)).map(i=>({code:i.code,name:i.name,reason:'缺目标日或上市不足60交易日'}));
 const previous=store.read(path.join(out,'chain-'+previousDate+'.json'));
 const cohortCodes=new Set((previous?.candidates||[]).map(c=>c.code));
 const probes=features.filter(f=>f.highReturn>=chain.rate(f.code)-.025||f.pct<=-chain.rate(f.code)+.025||f.previousPct>=chain.rate(f.code)-.025||cohortCodes.has(f.code));
 const checks=probes.slice(0,settings.maxChecks),verified=new Map(),errors=[],deadline=Date.now()+settings.maxCheckMinutes*60000;
 let done=0;
 const results=await provider.pool(checks,config.scanner.concurrency,async f=>{
  if(Date.now()>deadline)throw Error('连板复核超时，保留未知');
  const secid=f.market+'.'+f.code,cache=path.join(root,'.cache');
  const raw=await provider.cachedDaily(cache,secid,date,config.scanner,0),adjusted=store.read(path.join(cache,secid+'-'+date+'-f1.json'));
  if(!Array.isArray(adjusted))throw Error('缺复权核验日线');
  const result={code:f.code,history:chain.verifyHistory(raw,adjusted,f.code,date,calendar)};
  done++;if(done%20===0)progress({phase:'连板与涨跌停复核 '+done+'/'+checks.length});
  return result;
 });
 for(const r of results)if(r.ok)verified.set(r.value.code,r.value.history);else errors.push({code:r.item.code,error:r.error});
 const unresolved=probes.filter(f=>!verified.has(f.code)||verified.get(f.code).today.status!=='verified'||!verified.get(f.code).today.chainComplete||verified.get(f.code).previous.status!=='verified').map(f=>({code:f.code,name:f.name,reason:verified.get(f.code)?.today?.reason||'复核缺失、前一交易日缺失或连板窗口不完整'}));
 const complete=checks.length===probes.length&&unresolved.length===0;
 const pool=await themes.limitPool(root,date,config.scanner,now);
 if(pool.error)errors.push({name:'封板记录',error:pool.error});
 const poolMap=new Map((pool.items||[]).map(p=>[p.code,p]));
 const m=chain.metrics(features,verified,previousDate,coverage,complete),emotion=chain.sentiment(m,previous?.date===previousDate?previous.sentiment:null,settings);
 const candidates=features.filter(f=>{const v=verified.get(f.code)?.today;return v?.limitUp&&[1,2].includes(v.boardCount);}).map(f=>chain.evaluateCandidate(f,verified.get(f.code).today,poolMap.get(f.code),mainline?.themes||[],emotion,m,settings)).sort((a,b)=>a.grade.localeCompare(b.grade)||b.score-a.score||a.code.localeCompare(b.code));
 const snapshot={schema:1,version:chain.VERSION,date,previousDate,capturedAt:generatedAt,retrospective,universeDate:time.dateToday(now),totalUniverse,coverage,priceBasis:'features为前复权；verified为未复权核验；成交额和市值有独立日期标签',features,missingCodes,verified:[...verified].map(([code,v])=>({code,today:v.today,previous:v.previous})),pool,unresolved,errors};
 store.write(path.join(out,'market-snapshot-'+date+'.json'),snapshot);
 const report={schema:1,version:chain.VERSION,date,previousDate,generatedAt,frozenAt:generatedAt,retrospective,status:complete&&coverage>=settings.minimumCoverage?'complete':'partial',coverage,metrics:m,sentiment:emotion,candidates,review:chain.review(previous,features,date,previousDate,now),unresolved,errors,settings,snapshotFile:'market-snapshot-'+date+'.json',note:'A允许次日观察；B等待确认；C证据不足或低分；D排除。研究分不是胜率，未产生盘中信号或成交。'};
 store.write(file,report);manifest(out);
 return report;
}

function manifest(out){
 const reports=fs.readdirSync(out).filter(n=>/^chain-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort().reverse().map(n=>store.read(path.join(out,n))).filter(Boolean);
 store.write(path.join(out,'chain-manifest.json'),{updatedAt:new Date().toISOString(),dates:reports.map(r=>({date:r.date,status:r.status,candidateCount:r.candidates.length}))});
 const eligible=reports.filter(r=>r.review?.status==='complete');
 const group=items=>{
  const groups=new Map();for(const x of items){const key=x.route+' / '+x.grade;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(x);}
  return [...groups].map(([key,a])=>({key,observations:a.length,averageOpening:a.reduce((sum,x)=>sum+x.openingPremium,0)/a.length,averageClose:a.reduce((sum,x)=>sum+x.closeReturn,0)/a.length}));
 };
 store.write(path.join(out,'chain-review.json'),{updatedAt:new Date().toISOString(),label:'事前名单观察反馈；没有成交收益',days:eligible.map(r=>({date:r.date,baseDate:r.review.baseDate,cohortCount:r.review.cohortCount,averageOpening:r.review.averageOpening,averageClose:r.review.averageClose})),lastFiveObservedDays:eligible.slice(0,5).map(r=>r.date),lastFiveByRouteAndGrade:group(eligible.slice(0,5).flatMap(r=>r.review.items)),allByRouteAndGrade:group(eligible.flatMap(r=>r.review.items)),pendingDays:reports.filter(r=>r.review?.status!=='complete').length});
}
module.exports={build,marketFeature,manifest};

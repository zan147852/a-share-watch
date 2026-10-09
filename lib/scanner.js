const fs=require('fs'),path=require('path');
const provider=require('./provider'),strategy=require('./strategy'),time=require('./time'),store=require('./store');
const mainline=require('./mainline');
const UNIVERSE='m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23';
const label={below:'未突破',overprice:'超价',risk:'风险超限',insufficient:'历史不足',missing:'缺目标日',listing:'上市历史少于60交易日',error:'请求失败'};
async function scan(options={}){
 const root=options.root||path.join(__dirname,'..'),config=options.config||store.read(path.join(root,'config.json'));
 const date=options.date||time.dateToday(),now=options.now||new Date(),out=options.out||path.join(root,'public','data');
 if(!time.validDate(date)||date>time.dateToday(now))throw new Error('日期无效或在未来');
 fs.mkdirSync(out,{recursive:true});
 const reportFile=path.join(out,'results-'+date+'.json'),cacheDir=path.join(root,'.cache');
 const start={date,status:'running',startedAt:new Date().toISOString(),phase:'核对交易日期',done:0,total:0};
 const progress=(patch)=>{Object.assign(start,patch);store.write(path.join(out,'status.json'),start);options.progress?.(start);};
 const save=(result)=>{store.write(reportFile,result);store.manifest(out);progress({status:result.status,phase:result.message||'扫描结束',generatedAt:result.generatedAt,candidateCount:result.candidates?.length??0});return result;};
 const common={date,version:config.strategy.version,generatedAt:new Date().toISOString(),priceBasis:'前复权计算结构，按目标日未复权收盘换算显示价格',mode:'收盘观察；不重现盘中全部信号',news:{status:'未配置自动消息核验',message:'消息真伪、首次公开时间和公司业务受益尚需核验'},candidates:[]};
 progress({});
 if(!time.closedEnough(date,now))return save({...common,status:'awaiting_close',message:'尚未到北京时间15:20，不生成收盘名单'});
 try{
  const calendar=await provider.cachedDaily(cacheDir,'1.000001',date,config.scanner,0);
  if(!calendar.some(r=>r.date===date))return save({...common,status:'no_target_bar',message:'行情源没有目标日指数K线，可能休市或数据尚未更新；不视为无候选'});
  const previousDate=calendar.filter(r=>r.date<date).at(-1)?.date;
  progress({phase:'获取主板和创业板名单'});
  const snapshotTag=time.dateToday(now)+(date===time.dateToday(now)?'-close':''),universePath=path.join(cacheDir,'universe-'+snapshotTag+'.json');
  let list=store.read(universePath);
  if(!list){const opts={...config.scanner,listCache:path.join(cacheDir,'list-'+snapshotTag)};try{list=await provider.listAll(UNIVERSE,opts);}catch{progress({phase:'主名单接口中断，读取新浪备用名单'});list=await provider.sinaUniverse(opts);}list.quoteDate=time.dateToday(now);list.capturedAt=new Date().toISOString();store.write(universePath,list);}
  const items=list.items.filter(i=>strategy.isAllowed(i,config.strategy));
  const limited=options.limit?items.slice(0,options.limit):items;
  progress({phase:'计算个股突破位和风险距离',total:limited.length});
  let done=0,consecutiveErrors=0,deadline=Date.now()+(config.scanner.maxDailyMinutes||20)*60*1000;
  const results=await provider.pool(limited,config.scanner.concurrency,async item=>{
    try{
    if(Date.now()>deadline||consecutiveErrors>=30)throw new Error('接口连续失败或超过本轮时限，等待下次重跑');
    const rows=await provider.cachedDaily(cacheDir,item.market+'.'+item.code,date,config.scanner,1);
    consecutiveErrors=0;
    const evaluation=strategy.evaluate(rows,date,config.strategy);
    if(rows.filter(r=>r.date<date).length<config.strategy.minListingDays && evaluation.outcome!=='missing')evaluation.outcome='listing';
    return {item,evaluation,feature:mainline.dailyFeature({...item,capAsOf:list.quoteDate||time.dateToday(now)},rows,date)};
    }catch(e){consecutiveErrors++;throw e;}finally{done++;if(done%20===0||done===limited.length)progress({done});}
  });
  const counts={};const errors=[];
  for(const r of results){const key=r.ok?r.value.evaluation.outcome:'error';counts[key]=(counts[key]||0)+1;if(!r.ok)errors.push({code:r.item.code,name:r.item.name,error:r.error});}
  progress({done:limited.length,phase:'核对30分钟K线与实际价格'});
  const priceCandidates=results.filter(r=>r.ok&&r.value.evaluation.outcome==='candidate').map(r=>r.value);
  const checks=await provider.pool(priceCandidates,config.scanner.concurrency,async ({item,evaluation})=>{
    const rawRows=await provider.cachedDaily(cacheDir,item.market+'.'+item.code,date,config.scanner,0);
    const raw=rawRows.find(r=>r.date===date);if(!raw)throw new Error('缺未复权价格');
    const actual=strategy.convertToActual(evaluation,raw.close,config.strategy);
    let bars=[];try{bars=await provider.kline(item.market+'.'+item.code,30,date,config.scanner,0);}catch{}
    const minutes=strategy.checkMinutes(bars,date,actual.B,now);
    const matching=bars.filter(b=>b.date===date).at(-1);
    if(minutes.completeDay&&Math.abs(matching.close-actual.close)>0.011){minutes.passed=false;minutes.error='分钟收盘与日线实际收盘不一致';}
    return {code:item.code,name:item.name,exchange:item.market===1?'沪市':'深市',segment:/^30/.test(item.code)?'创业板':'主板',
      close:actual.close,pct:evaluation.pct,B:actual.B,S:actual.S,ceiling:actual.ceiling,risk:evaluation.risk,
      minutes,status:minutes.passed?'待消息与板块核验':'分钟数据待核验',boards:[],
      checks:[{label:'10日突破',pass:true},{label:'买价范围',pass:true},{label:'风险距离',pass:true},{label:'完整30分钟',pass:minutes.passed},{label:'消息/业务',pass:null},{label:'题材共振/领涨',pass:null},{label:'实际可成交',pass:null}],
      evidence:['B/S仅使用目标日之前的完整交易日','风险以目标日收盘价计算','次日跳空需要重新核对最高买价'],sources:{daily:raw.source||'eastmoney',minutes:bars[0]?.source||'missing'},adjustmentFactor:actual.adjustmentFactor};
  });
  const candidates=checks.filter(r=>r.ok).map(r=>r.value).sort((a,b)=>b.pct-a.pct);
  const minutesErrors=checks.filter(r=>!r.ok).map(r=>({code:r.item.item.code,name:r.item.item.name,error:r.error}));
  for(const failed of checks.filter(r=>!r.ok)){const {item,evaluation}=failed.item;candidates.push({code:item.code,name:item.name,segment:/^30/.test(item.code)?'创业板':'主板',close:null,pct:evaluation.pct,B:null,S:null,ceiling:null,risk:evaluation.risk,status:'数据不足，停止复核',minutes:{passed:false,completeDay:false},boards:[],checks:[{label:'分钟/实际价格数据',pass:null}],evidence:[failed.error]});}
  progress({phase:'采集板块证据'});
  let boards={status:'complete',items:[],errors:[]};
  try{boards=await scanBoards(config,cacheDir,date,now,candidates);}catch(e){boards={status:'failed',items:[],errors:[e.message]};}
  const failedCount=(counts.error||0)+(counts.missing||0)+(counts.insufficient||0);
  const coverage=limited.length?(limited.length-failedCount)/limited.length:0;
  const partial=Boolean(options.limit)||coverage<config.scanner.minimumCoverage||minutesErrors.length>0;
  const prior=store.read(path.join(out,'results-'+previousDate+'.json'));
  const followups=[];
  if(prior?.candidates?.length){
    for(const c of prior.candidates){const cached=store.read(path.join(cacheDir,(c.exchange==='沪市'?1:0)+'.'+c.code+'-'+date+'-f1.json'));const current=cached?.find(r=>r.date===date),previous=cached?.find(r=>r.date===previousDate);followups.push({code:c.code,name:c.name,previousDate,observationReturn:current&&previous?(current.close/previous.close-1):null,label:'收盘到收盘观察变化，非成交收益'});}
  }
  progress({phase:'采集消息线索'});
  const news=await require('./news').capture(root,date,config.scanner);
  require('./news').attach(candidates,news);
  progress({phase:'计算五步主线并冻结题材名单'});
  let mainlineReport;
  try{mainlineReport=await mainline.build({root,date,previousDate,features:results.filter(r=>r.ok&&r.value.feature).map(r=>r.value.feature),candidates,news,boards,config,now,out});}
  catch(e){mainlineReport={date,status:'failed',themes:[],errors:[e.message]};}
  const publicNews={...news,totalItems:news.items.length,items:news.items.slice(0,80).map(({content,...item})=>item)};
  return save({...common,news:publicNews,mainline:mainlineReport,generatedAt:new Date().toISOString(),previousDate,status:partial?'partial':'complete',
    message:partial?'部分数据未完成，不能解读为全市场筛选结果':'收盘价格扫描完成，完整策略条件仍待核验',
    universeDate:time.dateToday(now),retrospective:date<time.dateToday(now),totalUniverse:items.length,scanned:limited.length,coverage,
    exclusions:Object.entries(counts).map(([key,count])=>({key,label:label[key]||'价格候选',count})),errors:[...errors,...minutesErrors],candidates,boards,followups,
    limitations:['历史重扫使用当前股票名称、权限和名单，不是当时完整成分快照','收盘观察是独立模式，会漏掉日内突破后回落的信号','五步主线按规则收集证据；消息受益、官方板块指数及老龙身份仍须复核','运行成功不代表方法盈利或明日买入条件成立']});
 }catch(e){const result={...common,status:'failed',message:'扫描失败：'+e.message,errors:[e.message]};return save(result);}
}
async function scanBoards(config,cacheDir,date,now,candidates){
 const list=await provider.listAll('m:90+t:3',config.scanner);
 const selected=list.items.filter(b=>!/^昨日|^连板|^涨停/.test(b.name)).sort((a,b)=>b.pct-a.pct).slice(0,config.scanner.maxBoards);
 const results=await provider.pool(selected,3,async board=>{
   const rows=await provider.cachedDaily(cacheDir,'90.'+board.code,date,config.scanner,1);
   const current=rows.find(r=>r.date===date),prior=rows.filter(r=>r.date<date);
   if(!current||prior.length<20)throw new Error('板块历史不足');
   const H=prior.at(-1).high,ma20=prior.slice(-20).reduce((s,r)=>s+r.close,0)/20;
   const signal=current.close>H&&current.close>ma20;
   if(!signal)return null;
   const members=await provider.listAll('b:'+board.code,config.scanner);
   const eligible=members.items.filter(i=>strategy.isAllowed(i,config.strategy));
   const memberCodes=new Set(eligible.map(i=>i.code));
   const minuteRows=await provider.kline('90.'+board.code,30,date,config.scanner,1);
   const minute=strategy.checkMinutes(minuteRows,date,H,now);
   const currentMembershipDate=time.dateToday(now);
   const hits=candidates.filter(c=>memberCodes.has(c.code));
   for(const candidate of hits)candidate.boards.push({name:board.name,code:board.code,indexPassed:minute.passed,ma20Passed:true,membershipDate:currentMembershipDate,retrospective:currentMembershipDate>date});
   const high20=Math.max(...prior.slice(-20).map(r=>r.high)),volumes=prior.slice(-5).map(r=>r.volume),volumeRatio=volumes.every(v=>Number.isFinite(v)&&v>0)?current.volume/(volumes.reduce((a,b)=>a+b,0)/5):null;
   return {code:board.code,name:board.name,pct:(current.close/prior.at(-1).close-1)*100,close:current.close,previousHigh:H,ma20,minute,high20,volumeRatio,passed:minute.passed&&current.close>high20&&volumeRatio>=config.mainline.minimumVolumeRatio,matchedCandidates:hits.map(c=>c.code),membershipDate:currentMembershipDate,memberCount:eligible.length,note:'动态板块成分，仅作证据；尚未建立事前固定题材股票池'};
 });
 return {status:results.some(r=>!r.ok)?'partial':'complete',selection:'当前涨幅排序前'+config.scanner.maxBoards+'个概念，历史重扫可能漏板块',items:results.filter(r=>r.ok&&r.value).map(r=>r.value),errors:results.filter(r=>!r.ok).map(r=>({name:r.item.name,error:r.error}))};
}
module.exports={scan};

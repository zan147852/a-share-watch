const test=require('node:test'),assert=require('node:assert/strict');
const m=require('../lib/mainline'),tp=require('../lib/theme-provider'),config=require('../config.json');
const date='2026-10-09',previousDate='2026-10-08',settings=config.mainline;
test('涨停池必须校验返回交易日，不接受服务器忽略历史日期',()=>{
 assert.throws(()=>tp.normalizeLimitPool({data:{qdate:20261009,pool:[],tc:0}},'2026-10-08'),/日期错配/);
 assert.deepEqual(tp.normalizeLimitPool({data:{qdate:20261009,pool:[],tc:0}},date),[]);
 assert.throws(()=>tp.normalizeLimitPool({data:{qdate:20261009,pool:[],tc:1}},date),/不完整/);
});
test('否认消息不能被国家机构关键词抬升为高级催化',()=>{
 assert.equal(m.classifyNews({title:'国务院批准产业实施方案'}).rank,4);
 assert.equal(m.classifyNews({title:'工信部印发实施方案'}).rank,3);
 assert.equal(m.classifyNews({title:'公司否认网传工信部批准订单'}).catalyst,false);
 assert.equal(m.classifyNews({title:'公司未从事固态电池材料研发，其他业务已量产'}).catalyst,false);
 assert.equal(m.classifyNews({title:'公司签订采购合同',stockCodes:['600001']}).rank,1);
});
test('消息关联不使用目标收盘之后的报道，普通报道不算催化',()=>{
 const news={items:[{title:'机器人公司签订订单',publishedAt:date+'T06:59:00Z',stockCodes:['600001']},{title:'机器人政策发布',publishedAt:date+'T07:01:00Z'},{title:'机器人概念上涨',publishedAt:date+'T02:00:00Z'}]};
 const found=m.matchNews('机器人',news,date);assert.equal(found.length,2);assert.ok(found.every(x=>!x.title.includes('政策')));assert.equal(found[0].classification.rank,1);
});
test('日线特征排除未来数据并单独标记市值日期',()=>{
 const rows=Array.from({length:65},(_,i)=>({date:new Date(Date.UTC(2026,6,1+i)).toISOString().slice(0,10),close:10,open:10,high:10,low:10,volume:100}));rows.push({date,close:11,open:10.2,high:11,low:10.2,volume:200},{date:'2026-10-12',close:999,open:999,high:999,low:999,volume:1});
 const f=m.dailyFeature({code:'600001',name:'示例',cap:1e10,capAsOf:date},rows,date);assert.equal(f.close,11);assert.equal(f.volumeRatio,2);assert.equal(f.breakout,true);assert.equal(f.capAsOf,date);
});
test('实际涨停按分四舍五入，复权差异大的除权日不能误当涨停',()=>{
 const raw=[{date:'2026-10-07',close:10.05,high:10.05,volume:100},{date:previousDate,close:11.06,high:11.06,volume:100},{date,close:12.17,high:12.17,volume:100}];
 assert.equal(m.exactLimitHistory(raw,raw,'600001',date).today.streak,2);
 const adjusted=raw.map(x=>({...x}));adjusted[2].close=11.1;assert.equal(m.exactLimitHistory(raw,adjusted,'600001',date).today,null);
});
function previous(overrides={}){return {schema:1,date:previousDate,frozenAt:'2026-10-08T07:40:00Z',retrospective:false,snapshot:{firstBoards:[{code:'600001',name:'甲'},{code:'600002',name:'乙'}],leaders:[{code:'600001',name:'甲'}],capacity:[{code:'600003',name:'丙'}],complete:{firstBoards:true,capacity:true}},...overrides};}
const nextFeatures=[{code:'600001',openingPremium:.03,pct:.02},{code:'600002',openingPremium:0,pct:-.01},{code:'600003',openingPremium:-.01,pct:.01}];
test('次日用冻结全名单为分母，缺一只保持未知而非缩分母',()=>{
 const r=m.validateNext(previous(),nextFeatures,date,previousDate,settings);assert.equal(r.status,'pass');assert.equal(r.retention,.5);
 assert.equal(m.validateNext(previous(),nextFeatures.slice(0,1),date,previousDate,settings).status,'unknown');
 const bad=nextFeatures.map(x=>x.code==='600003'?{...x,pct:-.03}:x);assert.equal(m.validateNext(previous(),bad,date,previousDate,settings).status,'fail');
});
test('次日拒绝事后重扫、开盘后冻结、错前一交易日',()=>{
 for(const p of [previous({retrospective:true}),previous({frozenAt:'2026-10-09T02:31:00Z'}),previous({date:'2026-10-07'})])assert.equal(m.validateNext(p,nextFeatures,date,previousDate,settings).status,'pending');
});
test('昨天首板范围不完整也不能事后确认留存',()=>{const prior=previous();prior.snapshot.complete.firstBoards=false;assert.equal(m.validateNext(prior,nextFeatures,date,previousDate,settings).status,'unknown');});
function themeInput(){
 const members=['600001','600002','600003'].map((code,i)=>({code,name:'示例'+i}));
 const features=members.map(x=>({...x,date,pct:.04,previousPct:.04,breakout:true,volumeRatio:1.5,cap:2e10,capAsOf:date,amount:1e9,possibleLimit:true,approxBoards:[]}));
 const raw=Object.fromEntries(members.map(x=>[x.code,{complete:true,close:10,today:{streak:1},oldEvents:[],priorMaxChain:0}]));
 return {node:{id:'gn_robot',name:'机器人'},members,features,raw,pool:{items:members.map(x=>({...x,close:10,streak:1,firstTime:'09:40:00'}))},news:{complete:false,items:[]},date,previousDate,membershipDate:date,settings};
}
test('成分代理达标仍不能冒充官方指数创新高',()=>{
 const r=m.evaluateTheme(themeInput());assert.equal(r.steps[1].proxyPassed,true);assert.equal(r.steps[1].status,'review');assert.notEqual(r.state,'五步规则共振，待事实复核');
 const missing=themeInput();missing.pool.items=[];assert.equal(m.evaluateTheme(missing).steps[1].status,'review');
});
test('历史市值、缺成分、缺涨停历史均不能确认为通过',()=>{
 const input=themeInput();input.membershipDate='2026-10-12';input.features[0].capAsOf='2026-10-12';assert.equal(m.evaluateTheme(input).steps[2].status,'unknown');
 const missing=themeInput();delete missing.raw['600001'];assert.equal(m.evaluateTheme(missing).steps[1].status,'unknown');
});
test('五步共振仅在全部规则证据齐备时出现，消息始终保留事实复核',()=>{
 const input=themeInput();input.news={complete:true,items:[{title:'工信部发布机器人实施方案',publishedAt:date+'T01:00:00Z',content:'',stockCodes:[]}]};input.index={passed:true};input.prior=previous();input.raw['600001'].oldEvents=['2026-08-01','2026-08-02','2026-08-03'];input.raw['600001'].priorMaxChain=2;
 input.features=input.features.map(f=>({...f,openingPremium:.03}));
 const result=m.evaluateTheme(input);assert.equal(result.state,'五步规则共振，待事实复核');assert.equal(result.steps[0].status,'review');assert.equal(result.passedCount,4);
});
test('非产业分类排除，固态题材不因泛储能报道自动获得催化',()=>{assert.equal(m.isTheme('准ST股'),false);assert.equal(m.isTheme('央企50'),false);assert.equal(m.isTheme('固态电池'),true);assert.equal(m.matchNews('固态电池',{items:[{title:'储能订单增长',publishedAt:date+'T01:00:00Z'}]},date).length,0);});

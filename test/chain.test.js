const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),os=require('os'),path=require('path');
const chain=require('../lib/chain'),scanner=require('../lib/chain-scanner'),risk=require('../lib/chain-risk'),ledger=require('../lib/chain-ledger'),provider=require('../lib/provider'),themeProvider=require('../lib/theme-provider'),store=require('../lib/store');
const calendar=['2026-09-28','2026-09-29','2026-09-30','2026-10-08','2026-10-09'];
function rows(closes=[10,10,11,12.1,13.31]){return closes.map((close,i)=>({date:calendar[i],open:Math.min(close,closes[i-1]||close),low:Math.min(close,closes[i-1]||close),high:close,close,volume:1000,source:'fixture'}));}
test('真实交易日连板、10%/20%规则、触板和未来数据隔离',()=>{
 const r=rows();r.push({date:'2026-10-12',close:1,volume:100});
 assert.equal(chain.verifyHistory(r,r,'600001','2026-10-09',calendar).today.boardCount,3);
 assert.equal(chain.verifyHistory(r,r,'300001','2026-10-09',calendar).today.limitUp,false);
 const growth=rows([10,10,12,14.4,17.28]);assert.equal(chain.verifyHistory(growth,growth,'301001','2026-10-09',calendar).today.boardCount,3);
 const broken=rows([10,10,11,12.1,12.8]);broken.at(-1).high=13.31;const v=chain.verifyHistory(broken,broken,'600001','2026-10-09',calendar).today;assert.ok(v.touchedUp&&!v.limitUp);
});
test('除权、停牌缺口、重复日期和窗口边缘不生成伪首板',()=>{
 const raw=rows([10,10,11,5.5,6.05]),adj=rows([5,5,5.5,5.5,6.05]);
 assert.equal(chain.verifyHistory(raw,adj,'600001','2026-10-08',calendar).today.status,'unknown');
 assert.equal(chain.verifyHistory(raw,adj,'600001','2026-10-09',calendar).today.boardCount,null);
 const gap=rows().filter(r=>r.date!=='2026-09-30');assert.equal(chain.verifyHistory(gap,gap,'600001','2026-10-09',calendar).today.boardCount,null);
 assert.throws(()=>chain.verifyHistory([...raw,raw[0]],adj,'600001','2026-10-09',calendar));
 const edge=rows([10,11,12.1,13.31,14.64]);assert.equal(chain.verifyHistory(edge,edge,'600001','2026-10-09',calendar).today.boardCount,null);
});
test('分币四舍五入与一字/T字识别；跌停不计涨停',()=>{
 const r=rows([8.03,8.03,8.03,8.83,9.71]);r.at(-1).open=r.at(-1).low=9.71;
 assert.ok(chain.verifyHistory(r,r,'600001','2026-10-09',calendar).today.isOnePrice);
 r.at(-1).low=9.5;assert.ok(chain.verifyHistory(r,r,'600001','2026-10-09',calendar).today.isT);
 const down=rows([10,10,10,10,9]);down.at(-1).open=9;down.at(-1).low=9;assert.ok(chain.verifyHistory(down,down,'600001','2026-10-09',calendar).today.limitDown);
});
test('缺市场数据不解释为冰点；情绪暂停优先于涨停数量',()=>{
 const m={complete:true,coverage:1,limitCount:60,downCount:0,feedback:.03,promotionRate:.4,breakRate:.1};
 assert.equal(chain.sentiment(m).state,'上升');assert.equal(chain.sentiment({...m,downCount:20}).state,'退潮');
 assert.equal(chain.sentiment({...m,complete:false,limitCount:0}).state,'证据不足');
 assert.equal(chain.sentiment({...m,limitCount:20},{state:'退潮'}).state,'修复');
});
test('候选板数表示今日事实，目标表示次日；缺项降低级别，低流动性/一字硬排除',()=>{
 const f={code:'600001',name:'测试',date:'2026-10-09',volumeRatio:1.5,capAsOf:'2026-10-09',amount:2e8},v={boardCount:1,close:11,low:10.3,isOnePrice:false},pool={close:11,streak:1,amount:2e8,breaks:0,firstTime:'09:40:00',turnoverRate:5};
 const themes=[{id:'t',name:'测试题材',membershipDate:f.date,coverage:1,snapshot:{memberCodes:[f.code],complete:{firstBoards:true}},steps:[{key:'tide',limitCount:4}]}],emotion={state:'上升',allowTargetBoards:[2,3]},market={complete:true,coverage:1,limitCount:40,downCount:0,feedback:.02,promotionRate:.4};
 const c=chain.evaluateCandidate(f,v,pool,themes,emotion,market);assert.equal(c.targetBoard,2);assert.equal(c.grade,'B');assert.equal(c.score,100);assert.ok(c.sequential.eodPassed);
 assert.equal(chain.evaluateCandidate(f,{...v,boardCount:2},{...pool,streak:2},themes,emotion,market).targetBoard,3);
 assert.equal(chain.evaluateCandidate(f,v,{...pool,breaks:null},themes,emotion,market).grade,'C');
 assert.equal(chain.evaluateCandidate(f,v,pool,[],emotion,market).grade,'C');
 assert.equal(chain.evaluateCandidate(f,{...v,isOnePrice:true},pool,themes,emotion,market).grade,'D');
 assert.equal(chain.evaluateCandidate(f,v,{...pool,amount:1e6},themes,emotion,market).grade,'D');
 assert.equal(chain.evaluateCandidate({...f,capAsOf:'2026-10-12'},v,null,themes,emotion,market).amount,null);
});
test('事后重扫与开盘后冻结名单不能计成绩；缺成员不缩小分母',()=>{
 const p={date:'2026-10-08',status:'complete',frozenAt:'2026-10-08T08:00:00Z',candidates:[{code:'600001',grade:'A'},{code:'600002',grade:'B'}]},features=[{code:'600001',previousDate:p.date,pct:.1,openingPremium:.02}];
 const r=chain.review(p,features,'2026-10-09',p.date,new Date());assert.equal(r.status,'partial');assert.equal(r.cohortCount,2);assert.equal(r.validCount,1);assert.equal(r.averageClose,null);
 assert.equal(chain.review({...p,retrospective:true},features,'2026-10-09',p.date,new Date()).status,'pending');
 assert.equal(chain.review({...p,frozenAt:'2026-10-09T02:00:00Z'},features,'2026-10-09',p.date,new Date()).status,'pending');
});
test('账户风险与100股单位双约束，错误止损和负预算不能迁就',()=>{
 const p=risk.sizePlan({equity:50000,entry:10,stop:9.5});assert.equal(p.shares,400);assert.ok(p.plannedRisk<=p.riskBudget);
 assert.equal(risk.sizePlan({equity:50000,entry:10,stop:9.9}).shares,500);
 assert.equal(risk.sizePlan({equity:1000,entry:10,stop:9}).shares,0);
 assert.throws(()=>risk.sizePlan({equity:50000,entry:10,stop:11}));
});
const plan={id:'p1',code:'600001',mode:'二板弱转强',createdAt:'2026-10-09T09:40:00+08:00',tradeDate:'2026-10-09',equity:50000,entry:10,stop:9.5,exitRules:{invalidation:'跌破失效价',nextDay:'预期失败退出',timeExit:'下个交易日14:30复核'}};
const buy={id:'b1',planId:'p1',side:'buy',date:'2026-10-09',at:'2026-10-09T09:45:00+08:00',shares:400,price:10,fees:5},sell={id:'s1',planId:'p1',side:'sell',date:'2026-10-12',at:'2026-10-12T09:45:00+08:00',shares:400,price:11,fees:9};
test('私人账本校验T+1、真实费用与未成交收益',()=>{
 const report=ledger.summarize(ledger.validateLedger({plans:[plan],fills:[sell,buy]}));assert.equal(report.netClosed,386);assert.equal(report.winRate,1);
 assert.equal(ledger.summarize(ledger.validateLedger({plans:[plan],fills:[buy]})).rounds[0].net,null);
 assert.equal(ledger.summarize(ledger.validateLedger({plans:[plan],misses:[{planId:'p1',reason:'排队未成交'}]})).closedRounds,0);
 assert.throws(()=>ledger.validateLedger({plans:[plan],fills:[buy,{...sell,date:buy.date,at:'2026-10-09T10:45:00+08:00'}]}),/T\+1/);
 assert.throws(()=>ledger.validateLedger({plans:[plan],fills:[{...buy,shares:500}]}),/计划股数/);
 assert.throws(()=>ledger.validateLedger({plans:[plan],fills:[{...buy,price:10.5}]}),/最高买价/);
});
test('管线写出全市场快照、冻结完整报告、重跑不换名单、部分覆盖不冒充完整',async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'chain-pipeline-')),out=path.join(root,'public','data');t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(out,{recursive:true});
 const originalDaily=provider.cachedDaily,originalPool=themeProvider.limitPool;t.after(()=>{provider.cachedDaily=originalDaily;themeProvider.limitPool=originalPool;});
 const raw=rows([10,10,10,10,11]);store.write(path.join(root,'.cache','1.600001-2026-10-09-f1.json'),raw);
 provider.cachedDaily=async()=>raw;themeProvider.limitPool=async()=>({date:'2026-10-09',complete:false,items:[],error:'fixture无封板时间'});
 const config={scanner:{concurrency:1},chain:{}},feature={code:'600001',name:'测试',market:1,date:'2026-10-09',previousDate:'2026-10-08',previousPct:0,pct:.1,highReturn:.1,openingPremium:0,volumeRatio:1.5,amount:2e8,capAsOf:'2026-10-09'},options={root,out,date:'2026-10-09',previousDate:'2026-10-08',calendar,features:[feature],universe:[feature],totalUniverse:1,mainline:{themes:[]},config,now:new Date('2026-10-09T08:00:00Z')};
 const r=await scanner.build(options);assert.equal(r.status,'complete');assert.equal(r.candidates[0].targetBoard,2);assert.equal(r.candidates[0].grade,'D');assert.equal(store.read(path.join(out,r.snapshotFile)).features.length,1);
 const frozen=await scanner.build({...options,features:[],now:new Date('2026-10-09T10:00:00Z')});assert.equal(frozen.frozenAt,r.frozenAt);assert.equal(frozen.candidates.length,1);
 store.write(path.join(out,'chain-2026-10-09.json'),{...r,version:'v0.1-chain-observation'});
 assert.equal((await scanner.build({...options,features:[]})).version,'v0.1-chain-observation');
 fs.unlinkSync(path.join(out,'chain-2026-10-09.json'));
 const high=rows([10,10,11,12.1,13.31]);store.write(path.join(root,'.cache','1.600001-2026-10-09-f1.json'),high);provider.cachedDaily=async()=>high;
 const extended=await scanner.build({...options,features:[{...feature,previousPct:.1}]});assert.equal(extended.candidates[0].boardCount,3);assert.equal(extended.candidates[0].targetBoard,4);
 const partial=await scanner.build({...options,date:'2026-10-08',previousDate:'2026-09-30',features:[],totalUniverse:10});assert.equal(partial.status,'partial');assert.equal(partial.retrospective,true);
});

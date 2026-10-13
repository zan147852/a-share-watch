const test=require('node:test'),assert=require('node:assert/strict');
const relay=require('../public/relay-rules'),chain=require('../lib/chain'),ledger=require('../lib/chain-ledger');
const candidate={code:'600001',name:'测试',segment:'主板',boardCount:2,targetBoard:3,isOnePrice:false,amount:1e8,firstTime:'10:30:00',breaks:3,themeEvidence:{complete:true,name:'产业',limitCount:3}};
const report={date:'2026-10-12',metrics:{complete:true,coverage:.98,limitCount:15,downCount:14,feedback:0,promotionRate:0}};
const draft={tradeDate:'2026-10-13',observedAt:'2026-10-13T10:05:00+08:00',equity:100000,entry:10,limitPrice:10,stop:9.5,newPositions:0,touchedAt:'09:40:00',openedAt:'09:41:00',resealedAt:'09:42:00',newSeal:true,catalystValid:true,marketStable:true,peerEvidence:'两家公司披露相同产业业务',businessEvidence:'https://example.invalid/company 公司新增订单原文示例',invalidation:'订单依据被否认',nextDayExit:'跌破事前结构位退出',timeExit:'次日14:30复核',peers:[{code:'600002',price:11,previousClose:10},{code:'600003',price:12,previousClose:10}]};
test('顺序边界、零反馈有效；评分不可替代缺项；已知跌停下限仍能排除',()=>{
 const a=relay.audit({...candidate,score:0},report);assert.ok(a.eodPassed);assert.equal(a.status,'awaiting_manual');assert.equal(a.firstBlock,'盘中回封确认');
 assert.equal(relay.audit(candidate,{...report,metrics:{...report.metrics,feedback:-.0001}}).status,'excluded');
 assert.equal(relay.audit(candidate,{...report,metrics:{...report.metrics,promotionRate:null}}).status,'insufficient');
 assert.equal(relay.audit(candidate,{...report,metrics:{...report.metrics,complete:false,downCount:15}}).status,'excluded');
 assert.equal(relay.audit({...candidate,score:100,breaks:null},report).status,'insufficient');
 assert.equal(relay.audit({...candidate,firstTime:'10:30:01'},report).status,'excluded');
 assert.equal(relay.audit({...candidate,breaks:4},report).status,'excluded');
 assert.equal(relay.audit({...candidate,segment:'创业板'},report).status,'excluded');
});
test('高板单独核验首次放量开板，题材与量能未知不自动通过',()=>{
 const c={...candidate,boardCount:4,targetBoard:5};assert.equal(relay.audit(c,report).status,'insufficient');
 assert.ok(relay.audit({...c,highBoardRisk:false},report).eodPassed);assert.equal(relay.audit({...c,highBoardRisk:true},report).status,'excluded');
 const f={code:c.code,name:'测试',date:report.date,volumeRatio:1.2,volume:100,priorVolumes:[300,200,80],capAsOf:report.date,amount:2e8};
 const theme={id:'t',name:'产业',membershipDate:report.date,coverage:1,snapshot:{memberCodes:[c.code],complete:{firstBoards:true}},steps:[{key:'tide',limitCount:3}]};
 const result=chain.evaluateCandidate(f,{boardCount:4,close:10,low:9,isOnePrice:false},{close:10,streak:4,amount:2e8,firstTime:'10:00:00',breaks:1},[theme],{state:'上升',allowTargetBoards:[2,3]},report.metrics);
 assert.equal(result.route,'4板 → 5板观察');assert.equal(result.highBoardRisk,true);assert.equal(result.grade,'D');
});
test('回封与私人计划需完整实时依据，不能绕过缺数据、同伴重复或未来时间',()=>{
 const r=relay.validateManual(draft,candidate,report);assert.equal(r.status,'manual_review');assert.equal(r.sizing.shares,300);assert.equal(r.sizing.positionAmount,3000);
 for(const changes of [{newPositions:1},{entry:9.99},{openedAt:'09:42:00'},{resealedAt:'13:50:00'},{observedAt:'2026-10-14T10:05:00+08:00'},{businessEvidence:''},{peerEvidence:''},{marketStable:false},{peers:[draft.peers[0],draft.peers[0]]},{peers:[{...draft.peers[0],price:10},draft.peers[1]]},{equity:null}])assert.equal(relay.validateManual({...draft,...changes},candidate,report).status,'blocked',JSON.stringify(changes));
 assert.equal(relay.validateManual(draft,candidate,{...report,metrics:{}}).status,'blocked');
 assert.equal(relay.planSize({equity:100000,entry:31,stop:30}).shares,0);
});
test('旧快照只补充高板事实，不修改输入名单或声称事前选股',()=>{
 const snap={date:report.date,features:[{code:'600010',name:'测试高板',capAsOf:report.date,amount:2e8}],verified:[{code:'600010',today:{status:'verified',limitUp:true,boardCount:6,close:10,isOnePrice:false}}],pool:{items:[{code:'600010',close:10,streak:6,firstTime:'09:40:00',breaks:0,amount:2e8}]}};
 const r=relay.snapshotCandidates(snap,report);assert.equal(r.length,1);assert.equal(r[0].targetBoard,7);assert.ok(r[0].snapshotSupplement);assert.equal(relay.audit(r[0],report).status,'insufficient');assert.equal(report.candidates,undefined);
 assert.equal(relay.snapshotCandidates({...snap,date:'2026-10-09'},report).length,0);
});
test('新规则导出计划被私人账本核验，放大仓位或改失效条件拒绝',()=>{
 const p={id:'new-plan',code:candidate.code,mode:'三板分歧回封',version:relay.VERSION,createdAt:draft.observedAt,tradeDate:draft.tradeDate,equity:draft.equity,entry:draft.entry,stop:draft.stop,riskFraction:.005,maxPositionFraction:.03,costReserve:20,exitRules:{invalidation:draft.invalidation,nextDay:draft.nextDayExit,timeExit:draft.timeExit},relayEvidence:{draft,candidate,report,settings:relay.defaults}};
 assert.equal(ledger.validatePlan(p).shares,300);assert.throws(()=>ledger.validatePlan({...p,maxPositionFraction:.1}),/金额上限/);assert.throws(()=>ledger.validatePlan({...p,relayEvidence:null}),/缺少/);
 assert.equal(ledger.validateLedger({plans:[p],fills:[]}).plans.length,1);
 const p2={...p,id:'new-plan-2',code:'600004',relayEvidence:{...p.relayEvidence,candidate:{...candidate,code:'600004'}}};
 const fill={id:'fill-1',planId:p.id,side:'buy',date:draft.tradeDate,at:'2026-10-13T10:06:00+08:00',shares:100,price:10,fees:5};
 assert.throws(()=>ledger.validateLedger({plans:[p,p2],fills:[fill,{...fill,id:'fill-2',planId:p2.id}]}),/新增持仓/);
 assert.equal(ledger.validateLedger({plans:[p],fills:[fill,{...fill,id:'fill-2',shares:100}]}).fills.length,2);
 assert.throws(()=>ledger.validateLedger({plans:[p],fills:[{...fill,price:9.99}]}),/回封成交价/);
 assert.throws(()=>ledger.validateLedger({plans:[p,{...p,id:'same-stock'}],fills:[{...fill,shares:200},{...fill,id:'fill-2',planId:'same-stock',shares:200}]}),/累计买入金额/);
});

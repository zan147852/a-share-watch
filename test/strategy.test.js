const test=require('node:test'),assert=require('node:assert/strict');
const s=require('../lib/strategy'),t=require('../lib/time');
const settings={breakoutDays:10,stopDays:5,maxPriceRisk:.05,maxEntryOverBreakout:.02,allowedCodePrefixes:['300','301','600']};
function history(close=10.1){return [...Array.from({length:10},(_,i)=>({date:'2026-09-'+String(i+1).padStart(2,'0'),high:10,low:9.65,close:9.9})),{date:'2026-10-08',high:10.3,low:9.9,close}];}
test('突破结构不使用当日最高最低，未来K线不参与',()=>{const rows=history();rows.push({date:'2026-10-09',high:999,low:1,close:100});const r=s.evaluate(rows,'2026-10-08',settings);assert.equal(r.B,10);assert.equal(r.S,9.65);assert.equal(r.outcome,'candidate');});
test('风险按实际观察价计算，B到S合格不代表当前价合格',()=>{const r=s.evaluate(history(10.19),'2026-10-08',settings);assert.equal(r.outcome,'risk');});
test('超过最高价不能改止损迁就',()=>{assert.equal(s.evaluate(history(10.21),'2026-10-08',settings).outcome,'overprice');});
test('缺目标日和没有突破是不同结果',()=>{assert.equal(s.evaluate(history(),'2026-10-07',settings).outcome,'missing');assert.equal(s.evaluate(history(9.95),'2026-10-08',settings).outcome,'below');});
test('创业板301开头包括，科创ST排除',()=>{assert.ok(s.isAllowed({code:'301205',name:'联特科技'},settings));assert.ok(!s.isAllowed({code:'688001',name:'示例'},settings));assert.ok(!s.isAllowed({code:'300001',name:'ST示例'},settings));});
test('盘中当日日线不能冒充收盘结果',()=>{assert.equal(t.closedEnough('2026-10-09',new Date('2026-10-09T02:38:00Z')),false);assert.equal(t.closedEnough('2026-10-09',new Date('2026-10-09T07:21:00Z')),true);assert.equal(t.validDate('2026-02-30'),false);});
test('30分钟必须完整，单根和未结束K线均不能通过收盘确认',()=>{const times=['10:00','10:30','11:00','11:30','13:30','14:00','14:30','15:00'];const bars=times.map(x=>({date:'2026-10-09',timestamp:'2026-10-09 '+x,close:10.1}));assert.equal(s.checkMinutes(bars,'2026-10-09',10,new Date('2026-10-09T02:15:00Z')).passed,false);assert.equal(s.checkMinutes(bars,'2026-10-09',10,new Date('2026-10-09T07:21:00Z')).passed,true);});
test('历史复权价换算到目标日实际价，风险比例保持一致',()=>{const r=s.evaluate(history(),'2026-10-08',settings),a=s.convertToActual(r,20.2,settings);assert.equal(a.B,20);assert.equal(a.S,19.3);assert.equal(a.ceiling,20.4);assert.equal(a.risk,r.risk);});

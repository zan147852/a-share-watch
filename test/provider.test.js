const test=require('node:test'),assert=require('node:assert/strict');
const https=require('https'),{EventEmitter}=require('events'),fs=require('fs'),os=require('os'),path=require('path');
const provider=require('../lib/provider'),mainline=require('../lib/mainline'),config=require('../config.json');
const date='2026-10-09';
function staleTencentFallback(t){
 const requests=[];
 t.mock.method(https,'get',(url,options,callback)=>{
  requests.push(String(url));const req=new EventEmitter();req.destroy=error=>req.emit('error',error);
  queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=200;res.complete=true;callback(res);
   let body;
   if(String(url).includes('fqkline/get'))body=JSON.stringify({code:0,data:{sh600642:{qfqday:[['2026-10-08','8.78','9.09','9.14','8.78','303283']]}}});
   else if(String(url).endsWith('/qfq.js'))body='var factors = '+JSON.stringify({data:[{d:'2020-01-01',f:'2'}]})+';';
   else body=JSON.stringify([{day:'2026-10-08',open:'8.78',close:'9.09',high:'9.14',low:'8.78',volume:'30328311'},{day:date,open:'9.14',close:'9.08',high:'9.20',low:'9.07',volume:'25244355'}]);
   res.emit('data',Buffer.from(body));res.emit('end');});return req;
 });return requests;
}
test('腾讯响应成功但缺目标日时切换新浪复权日线',async t=>{
 const requests=staleTencentFallback(t),rows=await provider.kline('1.600642',101,date,{timeoutMs:1000},1);
 assert.equal(rows.at(-1).date,date);assert.equal(rows.at(-1).source,'sina');assert.equal(rows.at(-1).close,4.54);
 assert.ok(requests.some(url=>url.includes('quotes.sina.cn')));
});
test('缺目标日的缓存不能阻止重新获取和覆盖',async t=>{
 staleTencentFallback(t);const dir=fs.mkdtempSync(path.join(os.tmpdir(),'a-share-provider-'));
 try{const file=path.join(dir,'1.600642-'+date+'-f1.json');fs.writeFileSync(file,JSON.stringify([{date:'2026-10-08',close:9.09}]));
  const rows=await provider.cachedDaily(dir,'1.600642',date,{timeoutMs:1000},1);
  assert.equal(rows.at(-1).date,date);assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).at(-1).date,date);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('严重缺数据的冻结报告允许补跑，完整报告继续保持冻结',()=>{
 assert.equal(mainline.reusableSnapshot({marketCoverage:.0075,themes:[{coverage:1}]},config),false);
 assert.equal(mainline.reusableSnapshot({marketCoverage:.99,themes:[]},config),true);
 assert.equal(mainline.reusableSnapshot({themes:[{coverage:.01},{coverage:0}]},config),false);
 assert.equal(mainline.reusableSnapshot({themes:[{coverage:1}]},config),true);
});

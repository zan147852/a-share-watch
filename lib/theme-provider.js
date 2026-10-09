const path=require('path'),provider=require('./provider'),store=require('./store'),time=require('./time');
const NODE_API='https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.';
function parseSinaConcepts(body){
 const start=body.indexOf('{'),end=body.lastIndexOf('}');
 if(start<0||end<start)throw Error('新浪概念列表格式变化');
 const values=Object.values(JSON.parse(body.slice(start,end+1)));
 return values.map(value=>{const p=String(value).split(',');return {id:p[0],name:p[1],expected:Number(p[2])};}).filter(x=>/^gn_[a-zA-Z0-9_]+$/.test(x.id)&&x.name&&x.expected>0);
}
async function membership(node,settings){
 const count=Number(await provider.json(NODE_API+'getHQNodeStockCount?node='+node.id,settings));
 if(!Number.isInteger(count)||count<1||count>2000)throw Error('概念成分数量无效');
 const members=new Map();
 let ended=false;
 for(let page=1;page<=Math.ceil(count/100)+1;page++){
  const data=await provider.json(NODE_API+'getHQNodeData?page='+page+'&num=100&sort=symbol&asc=1&node='+node.id+'&symbol=',settings);
  if(!Array.isArray(data))throw Error('概念成分页格式无效');
  if(!data.length){ended=true;break;}
  const before=members.size;
  for(const x of data)if(/^\d{6}$/.test(x.code))members.set(x.code,{code:x.code,name:x.name,market:String(x.symbol).startsWith('sh')?1:0});
  if(members.size===before)throw Error('概念成分页重复');
  if(data.length<100){ended=true;break;}
 }
 if(!ended||Math.abs(members.size-count)>Math.max(2,Math.ceil(count*.01)))throw Error('概念成分覆盖不完整：'+members.size+'/'+count);
 return [...members.values()];
}
async function concepts(root,settings,now=new Date()){
 const date=time.dateToday(now),file=path.join(root,'.cache','themes-sina-'+date+'.json'),cached=store.read(file);
 if(cached?.complete&&cached.schema===2)return cached;
 const nodes=parseSinaConcepts(await provider.get('https://money.finance.sina.com.cn/q/view/newFLJK.php?param=class',{...settings,encoding:'gb18030'}));
 if(nodes.length<20)throw Error('概念列表覆盖异常');
 const results=await provider.pool(nodes,settings.themeConcurrency||4,async node=>({...node,members:await membership(node,settings)}));
 const result={schema:2,date,capturedAt:new Date().toISOString(),source:'新浪概念分类',complete:results.every(r=>r.ok),total:nodes.length,items:results.filter(r=>r.ok).map(r=>r.value),errors:results.filter(r=>!r.ok).map(r=>({name:r.item.name,error:r.error}))};
 store.write(file,result);return result;
}
function normalizeLimitPool(payload,date){
 const data=payload.data;if(!data||!Array.isArray(data.pool))throw Error('涨停池缺失');
 const actual=String(data.qdate);if(actual!==date.replaceAll('-',''))throw Error('拒绝日期错配：请求 '+date+'，涨停池返回 '+actual);
 const map=new Map();
 for(const x of data.pool){
  if(!/^\d{6}$/.test(x.c)||!Number.isFinite(+x.p)||+x.p<=0||!Number.isInteger(+x.lbc)||+x.lbc<1)throw Error('涨停池字段无效');
  map.set(x.c,{code:x.c,name:x.n,market:+x.m,close:+x.p/1000,pct:+x.zdp,cap:+x.tshare,amount:+x.amount,streak:+x.lbc,firstTime:formatClock(x.fbt),lastTime:formatClock(x.lbt),breaks:+x.zbc,source:'东方财富涨停池'});
 }
 if(Number.isFinite(+data.tc)&&map.size!==+data.tc)throw Error('涨停池数量不完整');
 return [...map.values()];
}
function formatClock(value){const text=String(value).padStart(6,'0');return /^\d{6}$/.test(text)&&+text.slice(0,2)<24&&+text.slice(2,4)<60&&+text.slice(4)<60?text.slice(0,2)+':'+text.slice(2,4)+':'+text.slice(4):null;}
async function limitPool(root,date,settings,now=new Date()){
 const file=path.join(root,'.cache','limits-'+date+'.json'),cached=store.read(file);
 if(cached?.complete&&cached.schema===1)return cached;
 if(!time.closedEnough(date,now))return {status:'pending',items:[],error:'等待收盘后冻结涨停池'};
 try{
  const payload=await provider.json('https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=10000&sort=fbt:asc&date='+date.replaceAll('-',''),settings);
  const items=normalizeLimitPool(payload,date),result={schema:1,date,status:'complete',complete:true,source:'东方财富涨停池',capturedAt:new Date().toISOString(),items};
  store.write(file,result);return result;
 }catch(e){return {date,status:'failed',complete:false,items:[],error:e.message};}
}
module.exports={concepts,limitPool,parseSinaConcepts,normalizeLimitPool,formatClock};

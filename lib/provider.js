const https=require('https');
const fs=require('fs');
const path=require('path');
const {parseKlines}=require('./strategy');
const {addDays}=require('./time');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function get(url,options={}) {
 const timeout=options.timeoutMs||12000;
 return new Promise((resolve,reject)=>{let settled=false,timer;const finish=(error,body)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(body);};const req=https.get(url,{agent:false},res=>{let text='';res.setEncoding('utf8');res.on('data',s=>{text+=s;if(text.length>12000000)req.destroy(new Error('响应过大'));});res.on('error',e=>finish(e));res.on('aborted',()=>finish(new Error('响应中断')));res.on('close',()=>{if(!res.complete)finish(new Error('响应未完整结束'));});res.on('end',()=>{if(res.statusCode!==200)return finish(new Error('HTTP '+res.statusCode));finish(null,text);});});timer=setTimeout(()=>req.destroy(new Error('请求超时')),timeout);req.on('error',e=>finish(e));});
}
async function json(url,options={}) {let last;for(let n=0;n<=(options.retries??2);n++){try {const body=JSON.parse(await get(url,options));if(body.rc!==undefined&&body.rc!==0)throw new Error('行情源错误 '+body.rc);return body;}catch(e){last=e;if(n<(options.retries??2))await wait(700*(n+1));}}throw last;}
function listUrl(fsValue,page=1) {return 'https://push2.eastmoney.com/api/qt/clist/get?pn='+page+'&pz=100&po=0&np=1&ut=bd1d9ddb04089700cf9c27f6f7426281&fltt=2&invt=2&fid=f12&fs='+fsValue+'&fields=f12,f14,f13,f2,f3,f6,f20,f124';}
async function listAll(fsValue,options={}) {const all=new Map();let total=0;const key=require('crypto').createHash('sha256').update(fsValue).digest('hex').slice(0,12);for(let page=1;page<=100;page++){const file=options.listCache?path.join(options.listCache,key+'-'+page+'.json'):null;let payload=null;if(file&&fs.existsSync(file)){try{payload=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}}if(!payload){try{payload=await json(listUrl(fsValue,page),{...options,retries:4});}catch(e){throw new Error('列表第'+page+'页：'+e.message);}if(file){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(payload));}}if(!payload.data||!Array.isArray(payload.data.diff))throw new Error('列表返回空数据');total=payload.data.total;const before=all.size;for(const r of payload.data.diff)all.set(r.f12,{code:String(r.f12),name:String(r.f14),market:r.f13,price:+r.f2,pct:+r.f3,amount:+r.f6,cap:+r.f20,quoteTime:r.f124});if(all.size>=total)break;if(all.size===before)throw new Error('分页重复，无法确认全市场覆盖');}if(all.size<total)throw new Error('列表分页不完整');return {total,items:[...all.values()]};}
async function tencentDaily(secid,date,options,adjust) {const [market,code]=secid.split('.');const symbol=(market==='1'?'sh':'sz')+code;const suffix=adjust===1?'qfq':'',query='?param='+symbol+',day,'+addDays(date,-180)+','+date+',320,'+suffix;
 let data;try{data=await json('https://proxy.finance.qq.com/ifzqgtimg/appstock/app/fqkline/get'+query,{...options,retries:0});}catch{data=await json('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get'+query,{...options,retries:0});}
 if(data.code!==0)throw new Error('腾讯行情错误');const info=data.data?.[symbol],lines=adjust===1?info?.qfqday:info?.day;if(!Array.isArray(lines)||!lines.length)throw new Error('腾讯日线缺失');return lines.map(p=>({date:p[0],timestamp:p[0],open:+p[1],close:+p[2],high:+p[3],low:+p[4],volume:+p[5],amount:null,source:'tencent'})).filter(r=>r.date<=date);}
async function sinaKline(secid,type,date,options={}) {
 const [market,code]=secid.split('.');if(!['0','1'].includes(market)||!/^\d{6}$/.test(code))throw new Error('新浪不支持该市场');
 const symbol=(market==='1'?'sh':'sz')+code,scale=type===101?240:30;
 const data=await json('https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol='+symbol+'&scale='+scale+'&ma=no&datalen=1023',options);
 if(!Array.isArray(data))throw new Error('新浪K线响应无效');
 const rows=data.map(p=>({date:String(p.day).slice(0,10),timestamp:String(p.day),open:+p.open,close:+p.close,high:+p.high,low:+p.low,volume:+p.volume,amount:p.amount===undefined?null:+p.amount,source:'sina',adjustment:0})).filter(r=>r.date<=date&&[r.open,r.close,r.high,r.low].every(n=>Number.isFinite(n)&&n>0)).sort((a,b)=>a.timestamp.localeCompare(b.timestamp));
 if(!rows.some(r=>r.date===date))throw new Error('新浪缺目标日K线或超出历史保留范围');
 return rows;
}
function adjustSinaDaily(rows,factors) {
 const sorted=factors.map(p=>({date:String(p.d),factor:+p.f})).filter(p=>/^\d{4}-\d{2}-\d{2}$/.test(p.date)&&Number.isFinite(p.factor)&&p.factor>0).sort((a,b)=>a.date.localeCompare(b.date));
 if(!sorted.length)throw new Error('新浪复权因子无效');
 return rows.map(row=>{const factor=sorted.filter(p=>p.date<=row.date).at(-1)?.factor;if(!factor)throw new Error('复权因子未覆盖历史');const result={...row,adjustment:1};for(const key of ['open','high','low','close'])result[key]=row[key]/factor;return result;});
}
async function sinaAdjustedDaily(secid,date,options={}) {
 const rows=await sinaKline(secid,101,date,options),[market,code]=secid.split('.'),symbol=(market==='1'?'sh':'sz')+code;
 const body=await get('https://finance.sina.com.cn/realstock/company/'+symbol+'/qfq.js',options),line=body.split('\n')[0];
 const payload=JSON.parse(line.slice(line.indexOf('{')).replace(/;\s*$/,''));
 if(!Array.isArray(payload.data))throw new Error('新浪复权响应无效');
 return adjustSinaDaily(rows,payload.data).filter(row=>row.date>=addDays(date,-180));
}
async function kline(secid,type,date,options={},adjust=1) {
 if(type===30&&!secid.startsWith('90.')&&adjust===0){try{return await sinaKline(secid,type,date,options);}catch{}}
 if(type===101&&!secid.startsWith('90.')){try{return await tencentDaily(secid,date,adjust===0?{...options,retries:0}:options,adjust);}catch{}
   if(adjust===0){try{return await sinaKline(secid,type,date,options);}catch{}}
   if(adjust===1){try{return await sinaAdjustedDaily(secid,date,options);}catch{}}
 }
 const u=new URL('https://push2his.eastmoney.com/api/qt/stock/kline/get');Object.entries({secid,klt:type,fqt:adjust,beg:(type===101?addDays(date,-180):date).replaceAll('-',''),end:date.replaceAll('-',''),fields1:'f1,f2,f3,f4,f5,f6',fields2:'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61'}).forEach(([k,v])=>u.searchParams.set(k,v));
 if(type===30)u.searchParams.set('end',addDays(date,1).replaceAll('-',''));
 const data=await json(u.toString().replaceAll('%2C',','),options);if(!data.data||!Array.isArray(data.data.klines))throw new Error('缺少K线数据');return parseKlines(data.data.klines).filter(r=>r.date<=date).map(r=>({...r,source:'eastmoney'}));
}
function cachedDaily(cacheDir,secid,date,options={},adjust=1) {const file=path.join(cacheDir,secid+'-'+date+'-f'+adjust+'.json');if(fs.existsSync(file)){try{return Promise.resolve(JSON.parse(fs.readFileSync(file,'utf8')));}catch{}}
 return kline(secid,101,date,options,adjust).then(rows=>{if(rows.some(r=>r.date===date)){fs.mkdirSync(cacheDir,{recursive:true});fs.writeFileSync(file,JSON.stringify(rows));}return rows;});}
async function pool(items,limit,worker) {const out=new Array(items.length);let cursor=0;await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(cursor<items.length){const i=cursor++;try{out[i]={ok:true,value:await worker(items[i],i)};}catch(e){out[i]={ok:false,error:e.message,item:items[i]};}}}));return out;}
async function sinaUniverse(options={}){
 const endpoint='https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.';
 const total=Number(await json(endpoint+'getHQNodeStockCount?node=hs_a',options));
 if(!Number.isFinite(total)||total<1000)throw new Error('备用股票总数无效');
 const pages=Array.from({length:Math.ceil(total/100)},(_,i)=>({page:i+1}));
 const results=await pool(pages,3,async({page})=>{
   const file=options.listCache?path.join(options.listCache,'sina-'+page+'.json'):null;
   let items;
   if(file&&fs.existsSync(file)){try{items=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}}
   if(!Array.isArray(items)||!items.length){
     for(let attempt=0;attempt<3;attempt++){
       items=await json(endpoint+'getHQNodeData?page='+page+'&num=100&sort=symbol&asc=1&node=hs_a&symbol=&_s_r_a=page',options);
       if(Array.isArray(items)&&items.length)break;
       await wait(700);
     }
     if(!Array.isArray(items)||!items.length)throw new Error('备用股票列表第'+page+'页无效');
     if(file){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(items));}
   }
   return items;
 });
 if(results.some(r=>!r.ok))throw new Error('备用列表分页失败：'+results.filter(r=>!r.ok).map(r=>r.error).join('；'));
 const map=new Map();
 for(const r of results)for(const i of r.value)map.set(i.code,{code:i.code,name:i.name,market:i.symbol.startsWith('sh')?1:0,price:+i.trade,pct:+i.changepercent,amount:+i.amount,cap:+i.mktcap*10000,source:'sina'});
 if(map.size<total*.99)throw new Error('备用股票列表覆盖不足');
 return {total,items:[...map.values()],source:'sina'};
}
module.exports={get,json,listAll,kline,cachedDaily,pool,sinaUniverse,sinaKline,adjustSinaDaily};

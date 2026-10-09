const provider=require('./provider'),store=require('./store'),path=require('path'),time=require('./time');
function publicFeedUrl(cursor){
 const params={app:'CailianpressWeb',os:'web',sv:'8.7.9',refresh_type:1,rn:100,last_time:cursor};
 const query=Object.keys(params).sort().map(k=>k+'='+params[k]).join('&'),crypto=require('crypto');
 params.sign=crypto.createHash('md5').update(crypto.createHash('sha1').update(query).digest('hex')).digest('hex');
 return 'https://www.cls.cn/v1/roll/get_roll_list?'+new URLSearchParams(params);
}
async function capture(root,date,opts={}) {
 const file=path.join(root,'.cache','news-'+date+'.json'),existing=store.read(file);
 const windowStart=Date.parse(time.addDays(date,-3)+'T15:00:00+08:00')/1000,windowEnd=Date.parse(date+'T15:00:00+08:00')/1000;
 if(existing?.complete&&existing.schema===3&&Date.parse(existing.capturedAt)>=windowEnd*1000)return existing;
 const items=new Map();let cursor=windowEnd+1,complete=false,error=null,pages=0;
 for(let i=0;i<(opts.maxPages||80);i++){
   try{
     let payload=await provider.json(publicFeedUrl(cursor),opts);
     if(!payload.data?.roll_data?.length)payload=await provider.json('https://www.cls.cn/api/cache?rn=20&lastTime='+cursor+'&name=telegraph',opts);
     if(!payload.data?.roll_data?.length&&i===0&&date===time.dateToday())payload=await provider.json('https://www.cls.cn/api/cache?name=telegraphList',opts);
     if(Number(payload.errno)!==0)throw new Error('资讯接口拒绝访问');
     const rows=payload.data?.roll_data;
     if(!Array.isArray(rows)||!rows.length){error='消息分页为空';break;}
     const next=Math.min(...rows.map(n=>n.ctime));
     if(cursor&&next>=cursor){error='消息分页重复';break;}
     cursor=next;pages++;
     for(const n of rows)if(n.ctime>=windowStart&&n.ctime<=windowEnd){
       const content=String(n.content||n.brief||'').replace(/<[^>]*>/g,'').slice(0,5000),publicText=Boolean(content);
       items.set(n.id,{id:n.id,title:n.title||content.slice(0,90),content,publishedAt:new Date(n.ctime*1000).toISOString(),source:'财联社公开电报',url:'https://www.cls.cn/detail/'+n.id,publicText,
       stockCodes:(n.stock_list||[]).map(s=>String(s.StockID||s.stock_id||'').replace(/^(sh|sz)/,'')).filter(s=>/^\d{6}$/.test(s)),subjects:(n.subjects||[]).map(s=>s.subject_name),level:n.level});
     }
     if(next<windowStart){complete=true;break;}
   }catch(e){error=e.message;break;}
 }
 let backup=null;
 if(!complete){
  backup=await captureEastmoney(date,opts);
  for(const n of backup.items)items.set(n.id,n);
  if(backup.complete){complete=true;error=null;}else error=[error,backup.error].filter(Boolean).join('；');
 }
 const result={schema:3,status:complete?'complete':items.size?'partial':'failed',date,capturedAt:new Date().toISOString(),pages:pages+(backup?.pages||0),window:'目标收盘前最近3个自然日',items:[...items.values()].sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)),complete,error,sources:backup?['财联社公开电报','东方财富公开快讯']:['财联社公开电报'],note:'媒体时间不保证事件首次公开时间；规则分级和关键词匹配需要原文与业务受益复核。完整仅指至少一个源覆盖采集窗口，不是全网消息覆盖。'};
 store.write(file,result);return result;
}
async function captureEastmoney(date,opts={}){
 const begin=Date.parse(time.addDays(date,-3)+'T15:00:00+08:00'),end=Date.parse(date+'T15:00:00+08:00'),items=new Map();let cursor='0',complete=false,error=null,pages=0;
 for(let page=0;page<(opts.maxPages||60);page++){
  try{
   const params=new URLSearchParams({client:'web',biz:'web_724',fastColumn:'102',sortEnd:cursor,pageSize:'100',req_trace:require('crypto').randomUUID()});
   const payload=await provider.json('https://np-listapi.eastmoney.com/comm/web/getFastNewsList?'+params,opts),data=payload.data,rows=data?.fastNewsList;
   if(String(payload.code)!=='1'||!Array.isArray(rows)||!rows.length)throw Error('东方财富快讯分页为空或访问失败');
   let earliest=Infinity;
   for(const n of rows){
    const timestamp=Date.parse(String(n.showTime).replace(' ','T')+'+08:00');if(!Number.isFinite(timestamp))continue;earliest=Math.min(earliest,timestamp);
    if(timestamp<begin||timestamp>end)continue;
    const content=String(n.summary||n.title||'').replace(/<[^>]*>/g,'').slice(0,5000);
    items.set('em-'+n.code,{id:'em-'+n.code,title:n.title||content.slice(0,90),content,publishedAt:new Date(timestamp).toISOString(),source:'东方财富公开快讯',url:'https://finance.eastmoney.com/a/'+n.code+'.html',publicText:Boolean(content),stockCodes:(n.stockList||[]).filter(s=>/^[01]\.\d{6}$/.test(s)).map(s=>s.split('.')[1]),subjects:[]});
   }
   pages++;if(earliest<begin){complete=true;break;}
   const next=String(data.sortEnd);if(!/^\d+$/.test(next)||next===cursor||(cursor!=='0'&&BigInt(next)>=BigInt(cursor)))throw Error('东方财富快讯分页未向过去推进');cursor=next;
  }catch(e){error=e.message;break;}
 }
 if(!complete&&!error)error='消息达到分页上限，窗口尚未完整覆盖';
 return {complete,error,pages,items:[...items.values()]};
}
function attach(candidates,news){for(const c of candidates)c.news=(news.items||[]).filter(n=>n.stockCodes.includes(c.code)).map(n=>({title:n.title,url:n.url,publishedAt:n.publishedAt,publicText:n.publicText}));}
module.exports={capture,attach,publicFeedUrl,captureEastmoney};

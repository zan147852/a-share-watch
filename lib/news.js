const provider=require('./provider'),store=require('./store'),path=require('path'),time=require('./time');
async function capture(root,date,opts={}) {
 const file=path.join(root,'.cache','news-'+date+'.json'),existing=store.read(file);
 if(existing?.complete)return existing;
 const windowStart=Date.parse(date+'T00:00:00+08:00')/1000,windowEnd=Date.parse(date+'T15:00:00+08:00')/1000;
 const items=new Map();let cursor=0,complete=false,error=null,pages=0;
 for(let i=0;i<(opts.maxPages||40);i++){
   try{
     const url=cursor?'https://www.cls.cn/api/cache?rn=20&lastTime='+cursor+'&name=telegraph':'https://www.cls.cn/api/cache?name=telegraphList';
     const payload=await provider.json(url,opts);
     if(Number(payload.errno)!==0)throw new Error('资讯接口拒绝访问');
     const rows=payload.data?.roll_data;
     if(!Array.isArray(rows)||!rows.length){error='消息分页为空';break;}
     const next=Math.min(...rows.map(n=>n.ctime));
     if(cursor&&next>=cursor){error='消息分页重复';break;}
     cursor=next;pages++;
     for(const n of rows)if(n.ctime>=windowStart&&n.ctime<=windowEnd){
       const publicText=Boolean(n.content||n.brief);
       items.set(n.id,{id:n.id,title:n.title||'',publishedAt:new Date(n.ctime*1000).toISOString(),source:'财联社公开电报',url:'https://www.cls.cn/detail/'+n.id,publicText,
       stockCodes:(n.stock_list||[]).map(s=>String(s.StockID||'').replace(/^(sh|sz)/,'')),level:n.level});
     }
     if(next<windowStart){complete=true;break;}
   }catch(e){error=e.message;break;}
 }
 const result={status:complete?'complete':items.size?'partial':'failed',date,capturedAt:new Date().toISOString(),pages,window:'目标日00:00至15:00',items:[...items.values()].sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)),complete,error,note:'媒体时间是该条电报时间，不保证事件首次公开时间；标题和关联代码只提供线索，不自动核实公司受益'};
 store.write(file,result);return result;
}
function attach(candidates,news){for(const c of candidates)c.news=(news.items||[]).filter(n=>n.stockCodes.includes(c.code)).map(n=>({title:n.title,url:n.url,publishedAt:n.publishedAt,publicText:n.publicText}));}
module.exports={capture,attach};

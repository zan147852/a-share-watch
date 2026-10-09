const http=require('http'),fs=require('fs'),path=require('path'),{scan}=require('./lib/scanner'),store=require('./lib/store'),time=require('./lib/time');
const root=__dirname,web=path.join(root,'public'),data=path.join(web,'data'),config=store.read(path.join(root,'config.json'));
let active=null;
function json(res,code,payload){res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(payload));}
function launch(date){if(active)return active;active=scan({date}).finally(()=>active=null);return active;}
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1'),date=url.searchParams.get('date')||time.dateToday();
 if(url.pathname==='/api/scan'&&req.method==='POST'){if(!time.validDate(date))return json(res,400,{error:'日期无效'});if(req.headers.origin && req.headers.origin!=='http://'+req.headers.host)return json(res,403,{error:'跨站操作已拒绝'});launch(date);return json(res,202,{started:true,date});}
 if(url.pathname==='/api/status')return json(res,200,store.read(path.join(data,'status.json'),{status:'idle',phase:'尚未运行'}));
 const target=path.resolve(web,decodeURIComponent(url.pathname==='/'?'index.html':url.pathname.slice(1)));
 if(target!==web&&!target.startsWith(web+path.sep))return json(res,403,{error:'禁止访问'});
 fs.readFile(target,(err,body)=>{if(err)return json(res,404,{error:'文件尚未生成'});const type={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'}[path.extname(target)]||'application/octet-stream';res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(body);});
});
let scheduledDate='';
setInterval(()=>{const local=time.chinaNow(),today=local.slice(0,10),day=new Date(today+'T12:00:00Z').getUTCDay();if(day>=1&&day<=5&&local.slice(11,16)>=config.server.scanAt&&scheduledDate!==today&&!active){scheduledDate=today;launch(today);}},30000);
server.listen(config.server.port,config.server.host,()=>console.log('手机网页预览 http://'+config.server.host+':'+config.server.port));

const $=s=>document.querySelector(s);
const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
const labels={complete:'价格扫描完成',partial:'部分数据未完成',failed:'运行失败',awaiting_close:'等待收盘',no_target_bar:'目标日期数据未更新',running:'正在运行',idle:'尚未运行'};
let report=null,manifest={dates:[]},local=false,busy=false;
const num=(n,d=2)=>Number.isFinite(n)?n.toFixed(d):'—';
const pct=(n)=>Number.isFinite(n)?(n*100).toFixed(2)+'%':'—';
for(const [selector,icon] of [['#refresh','refresh-cw'],['#scan','scan-line']]){const node=document.createElement('img');node.src='icons/'+icon+'.svg';node.alt='';node.className='icon';$(selector).prepend(node);}
function el(tag,text,cls){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
async function get(file,options){const r=await fetch(file,options);if(!r.ok)throw new Error('数据尚未生成');return r.json();}
function status(text,kind=''){ $('#statusText').textContent=text;$('#status').className='status '+kind;}
function row(parent,left,right,note){const n=el('div',undefined,'item'),a=el('div',left);if(note)a.append(el('br'),el('small',note));n.append(a,el('span',right));parent.append(n);}
function render(data){
 report=data;const acceptable=['complete','partial'].includes(data.status);
 $('#reportDate').textContent=(data.date||today)+' / 收盘观察 v0.2';
 $('#runBadge').textContent=labels[data.status]||'暂无结果';
 $('#coverage').textContent=acceptable?pct(data.coverage):'—';
 $('#scanned').textContent=acceptable?'有效 '+Math.round(data.coverage*data.scanned)+' / '+data.totalUniverse+' 只':'尚未完成';
 $('#count').textContent=acceptable?String(data.candidates?.length||0):'—';
 $('#updated').textContent=data.generatedAt?new Date(new Date(data.generatedAt).getTime()+8*3600000).toISOString().slice(11,16):'—';
 status(data.message||labels[data.status]||'尚未运行',data.status==='failed'?'bad':data.status!=='complete'?'warn':'');
 $('#dateNote').textContent=data.retrospective?'历史重扫：采用当前名单，不计作事前选股成绩':'规则：v0.2 收盘观察';
 const container=$('#cards');container.replaceChildren();
 const filter=$('#filter').value;
 const candidates=(data.candidates||[]).filter(c=>filter==='all'||(filter==='main'&&c.segment==='主板')||(filter==='growth'&&c.segment==='创业板')||(filter==='minute'&&c.minutes?.passed));
 $('#empty').hidden=candidates.length>0;
 $('#empty').textContent=acceptable?(candidates.length?'':'本次范围没有符合价格条件的候选。'+(data.status==='partial'?'缺失数据仍需重跑。':'')):(data.message||'这个日期尚未生成结果。云端每天自动更新，手机可刷新查看。');
 for(const c of candidates){const card=el('article',undefined,'card'),head=el('div',undefined,'card-head'),title=el('div');title.append(el('div',c.name,'stock-name'),el('div',c.code+' / '+(c.segment||''),'stock-meta'));head.append(title,el('div',num(c.pct)+'%','change'+(c.pct<0?' negative':'')));card.append(head);
 const values=el('div',undefined,'values');for(const [label,value] of [['收盘',num(c.close)],['突破位 B',num(c.B)],['失效位 S',num(c.S)],['风险距离',pct(c.risk)]]){const v=el('div');v.append(el('label',label),el('strong',value));values.append(v);}card.append(values,el('span',c.status,'tag'));
 const details=el('details');details.append(el('summary','查看规则与缺失条件'));const checks=el('div',undefined,'checks');for(const check of c.checks||[]){checks.append(el('span',(check.pass===true?'已核对 · ':check.pass===false?'未通过 · ':'待核验 · ')+check.label,'tag'+(check.pass===true?' ok':'')));}details.append(checks,el('p','最高观察价 '+num(c.ceiling)+'；次日实际价格需重新核对。'),el('p','分钟记录：'+(c.minutes?.lastBar||'未取得')+'，完整根数 '+(c.minutes?.barCount||0)));
 for(const b of c.boards||[])details.append(el('p','板块 '+b.name+' / 成分日期 '+b.membershipDate+(b.retrospective?'（事后成分）':'')));
 for(const n of c.news||[]){const link=el('a',n.title);link.href=n.url;link.target='_blank';link.rel='noopener';details.append(el('p','媒体关联消息，业务受益尚未核验'),link);}for(const e of c.evidence||[])details.append(el('p',e));if(c.sources)details.append(el('p','日线来源 '+c.sources.daily+'；分钟来源 '+c.sources.minutes));card.append(details);container.append(card);}
 const boards=$('#boards');boards.replaceChildren();if(!data.boards?.items?.length)boards.append(el('p',data.boards?.status==='failed'?'板块数据获取失败，不能判断共振。':'暂未取得符合观察条件的板块证据。','note'));for(const b of data.boards?.items||[])row(boards,b.name,num(b.pct)+'%',b.minute?.passed?'指数30分钟已核对；事前题材名单仍待核验':'分钟确认尚未完成');
 const exclusions=$('#exclusions');exclusions.replaceChildren();for(const x of data.exclusions||[])row(exclusions,x.label,String(x.count));
 const errors=$('#errors');errors.replaceChildren();const list=[...(data.errors||[]),...(data.boards?.errors||[])];$('#errorsLabel').textContent='查看数据异常（'+list.length+'）';for(const e of list)errors.append(el('p',typeof e==='string'?e:(e.code||e.name||'')+' '+e.error));
 const follow=$('#followups');follow.replaceChildren();if(!data.followups?.length)follow.append(el('p','连续观察后将显示上一观察日候选的变化。','note'));for(const f of data.followups||[])row(follow,f.code+' '+f.name,pct(f.observationReturn),f.label);
 const limits=$('#limitations');limits.replaceChildren();for(const line of data.limitations||[])limits.append(el('p',line));
 const news=$('#news');news.replaceChildren();$('#newsStatus').textContent=data.news?.note||'仅采集公开媒体线索；不保证事件首次公开时间，不能自动认定公司受益。';for(const n of (data.news?.items||[]).slice(0,20)){const line=el('div',undefined,'item'),a=el('a',n.title);a.href=n.url;a.target='_blank';a.rel='noopener';line.append(a,el('small',new Date(new Date(n.publishedAt).getTime()+8*3600000).toISOString().slice(11,16)));news.append(line);}if(!data.news?.items?.length)news.append(el('p',data.news?.error||'没有取得目标日期的消息线索，不代表当天没有催化。','note'));
}
async function loadDate(date){try{render(await get('data/results-'+date+'.json?v='+Date.now()));}catch{render({date,status:'idle',message:'该日期尚未生成结果，请等待自动扫描或运行一次。'});}}
async function refresh(){manifest=await get('data/manifest.json?v='+Date.now()).catch(()=>({dates:[]}));const selected=$('#dateSelect').value;$('#dateSelect').replaceChildren();const dates=[...new Set([today,...manifest.dates.map(x=>x.date)])].sort().reverse();for(const date of dates){const o=el('option',date+(date===today?' · 今天':''));o.value=date;$('#dateSelect').append(o);}$('#dateSelect').value=dates.includes(selected)?selected:(manifest.dates[0]?.date||today);await loadDate($('#dateSelect').value);
 const site=await get('data/site.json').catch(()=>null);if(site?.repository){$('#actionsLink').href='https://github.com/'+site.repository+'/actions/workflows/screen.yml';$('#actionsLink').hidden=false;$('#schedule').textContent='GitHub云端定时；可能延迟';}
}
async function poll(){if(!local)return;const state=await get('/api/status').catch(()=>null);if(state?.status==='running'){busy=true;$('#scan').disabled=true;$('#progress').hidden=false;$('#progress').max=state.total||1;$('#progress').value=state.done||0;status(state.phase+' '+state.done+'/'+state.total);$('#runBadge').textContent='正在运行';}else if(busy){busy=false;$('#scan').disabled=false;$('#progress').hidden=true;await refresh();}}
$('#filter').addEventListener('change',()=>report&&render(report));$('#dateSelect').addEventListener('change',()=>loadDate($('#dateSelect').value));$('#refresh').addEventListener('click',refresh);
$('#scan').addEventListener('click',async()=>{try{const r=await fetch('/api/scan?date='+$('#dateSelect').value,{method:'POST'});const body=await r.json();if(!r.ok)throw new Error(body.error);busy=true;$('#scan').disabled=true;await poll();}catch(e){status(e.message,'bad');}});
(async()=>{await refresh();local=await get('/api/status').then(()=>true).catch(()=>false);if(local){$('#scan').hidden=false;$('#schedule').textContent='本地服务运行时自动扫描';setInterval(poll,3000);await poll();}})();setInterval(()=>{if(!busy)refresh();},60000);

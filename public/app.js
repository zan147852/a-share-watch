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
const stepLabels={pass:'规则通过',review:'待事实复核',fail:'条件不符',unknown:'证据不足',pending:'等待验证'};
function publicLink(url,title){const a=el('a',title);try{const u=new URL(url);if(u.protocol!=='https:')return el('span',title);a.href=u.href;}catch{return el('span',title);}a.target='_blank';a.rel='noopener';return a;}
function stockList(parent,stocks,kind){for(const x of stocks||[]){let detail='';if(kind==='first')detail='首次封板 '+(x.firstTime||'未取得')+' / '+x.streak+'连板';if(kind==='capacity')detail='总市值 '+num(x.cap/1e8,1)+'亿元 / 涨幅 '+pct(x.pct)+' / 量比 '+num(x.volumeRatio)+' / '+(x.participating?'参与':'未达门槛');if(kind==='old')detail='历史涨停 '+x.pastBoards+'次 / 最高 '+x.maxChain+'连板 / 前日 '+pct(x.previousPct)+' / 当日 '+pct(x.pct);if(kind==='next')detail='开盘溢价 '+pct(x.openingPremium)+' / 收盘变化 '+pct(x.closeReturn);row(parent,x.code+' '+x.name,'',detail);}}
function renderMainline(m){
 const overview=$('#mainlineOverview'),list=$('#mainlineThemes'),rules=$('#mainlineRules'),errors=$('#mainlineErrors'),validation=$('#mainlineValidation');for(const n of [overview,list,rules,errors,validation])n.replaceChildren();
 $('#mainlineNote').textContent=m?((m.date||'')+' · '+(m.status==='failed'?'主线计算失败':m.retrospective?'历史重扫，不能用于事前成绩':m.frozenAt?'当日名单已冻结':'等待冻结')+'。'+(m.note||'五步规则证据，事实与业务受益仍需复核。')):'该日期尚未生成五步主线数据。旧报告只包含价格筛选。';
 if(!m){list.append(el('p','下一次云端扫描将生成题材五步卡片。','note'));$('#mainlineErrorsLabel').textContent='查看主线数据异常';return;}
 row(overview,'概念成分有效覆盖',String(m.catalog?.valid??0)+' / '+String(m.catalog?.total??0));row(overview,'消息线索',String(m.news?.count??0)+' 条',m.news?.status==='complete'?'至少一个源覆盖采集窗口':'覆盖未完整，缺消息不能视为无催化');row(overview,'涨停时间来源',m.pool?.status==='complete'?'日期已核对':'待补数据',m.pool?.error||'首次封板时间仅作收盘回看');
 const items=m.themes||[],filter=$('#themeFilter').value,visible=items.filter(t=>filter==='all'||filter==='focus'&&/候选|共振/.test(t.state)||filter==='missing'&&t.state==='证据不足'||filter==='negative'&&t.state==='条件不符');
 row(overview,'本轮题材结论','观察 '+items.filter(t=>/候选|共振/.test(t.state)).length+' / 不符 '+items.filter(t=>t.state==='条件不符').length+' / 不足 '+items.filter(t=>t.state==='证据不足').length);
 if(!visible.length)list.append(el('p',items.length?'当前筛选范围没有题材。':'未取得可计算的题材成分。请查看数据异常。','note'));
 for(const t of visible){const card=el('article',undefined,'theme-card'),head=el('div',undefined,'card-head'),title=el('div');title.append(el('h3',t.name),el('p',t.memberCount+'只成分 / 日线覆盖 '+pct(t.coverage)+(t.retrospective?' / 事后成分':''),'note'));head.append(title,el('span',t.state,'tag'+(/共振/.test(t.state)?' ok':'')));card.append(head);
  const summary=el('div',undefined,'step-strip');for(const [i,s]of (t.steps||[]).entries()){const item=el('div',undefined,'step-mini '+s.status);item.append(el('small',(i+1)+' '+s.name),el('strong',stepLabels[s.status]||'待核验'));summary.append(item);}card.append(summary);
  const details=el('details');details.append(el('summary','展开五步依据与核心名单'));
  for(const [i,s]of (t.steps||[]).entries()){const block=el('section',undefined,'step-detail');block.append(el('h4',(i+1)+' · '+s.name+' — '+(stepLabels[s.status]||'')),el('p',s.summary));
   if(s.key==='news')for(const n of s.items||[]){const entry=el('div',undefined,'news-evidence');entry.append(el('span',n.classification?.tier||'资讯','tag'),publicLink(n.url,n.title),el('p','媒体时间 '+new Date(new Date(n.publishedAt).getTime()+8*3600000).toISOString().slice(0,16).replace('T',' ')+' / '+n.source));block.append(entry);}
   if(s.key==='tide'){block.append(el('p','收盘首板 '+(s.firstBoards?.length||0)+' 家 / 早盘首板 '+(s.earlyCount||0)+' 家 / 全部涨停 '+(s.limitCount||0)+' 家'),el('p','上涨比例 '+pct(s.upBreadth)+' / 20日突破比例 '+pct(s.breakoutBreadth)+' / 成分平均量比 '+num(s.volumeRatio)),el('p',s.index?'官方指数：'+(s.index.passed?'通过':'未通过'):'官方板块指数尚未核验；成分广度仅为代理证据'));stockList(block,s.firstBoards,'first');}
   if(s.key==='capacity')stockList(block,s.stocks,'capacity');if(s.key==='oldLeader')stockList(block,s.stocks,'old');
   if(s.key==='nextDay'){if(s.baseDate)block.append(el('p','冻结日期 '+s.baseDate+' / 首板留存 '+pct(s.retention)+' / 领涨开盘溢价 '+pct(s.leaderPremium)+' / 中军最低反馈 '+pct(s.capacityFloor)));stockList(block,s.leaders,'next');stockList(block,s.capacity,'next');}
   if(s.definition)block.append(el('p',s.definition,'note'));details.append(block);
  }card.append(details);list.append(card);
 }
 for(const line of ['1 消息：国家、部委、地方/产业、公司事件、传闻五类规则分级；关键词关联须核实公司受益。','2 首板潮：收盘首板≥'+(m.settings?.minimumFirstBoards??3)+'家；09:25—10:30首板≥3家；官方板块20日新高与量比≥1.2需核对。成分代理：上涨比例≥60%、20日突破比例≥20%、平均量比≥1.2。','3 中军：总市值≥100亿元，成交额前3只；至少1只上涨≥2%且量比≥1.2。市值须为目标日数据。','4 老龙代理：此前60交易日（排除最近5日）≥3次涨停且曾2连板；前日涨≥3%，当日涨≥3%且量比≥1.2。','5 次日：昨日冻结领涨候选平均开盘溢价≥2%；首板收盘留存≥50%；冻结中军开盘及收盘均不低于昨日收盘2%以上。缺数据保持待核验。','次日验证使用实际上一交易日，不按日历隔天；历史重扫不进入事前验证。阈值是研究起点，未经过盈利验证。'])rules.append(el('p',line));
 $('#mainlineErrorsLabel').textContent='查看主线数据异常（'+(m.errors?.length||0)+'）';for(const e of m.errors||[])errors.append(el('p',typeof e==='string'?e:(e.name||'')+' '+e.error));
 if(!m.validations?.length)validation.append(el('p','还没有上一交易日冻结的题材记录，连续运行后自动验证。','note'));
 for(const v of m.validations||[])row(validation,v.name,stepLabels[v.status]||'待核验',v.summary+(v.baseDate?' / 首板留存 '+pct(v.retention)+' / 开盘溢价 '+pct(v.leaderPremium):''));
}
function render(data){
 report=data;const acceptable=['complete','partial'].includes(data.status);
 renderMainline(data.mainline);
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
 for(const t of c.mainline||[])details.append(el('p','题材 '+t.name+' / '+t.state+' / 五步规则通过 '+t.passedCount+'项'));
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
$('#themeFilter').addEventListener('change',()=>report&&renderMainline(report.mainline));
$('#scan').addEventListener('click',async()=>{try{const r=await fetch('/api/scan?date='+$('#dateSelect').value,{method:'POST'});const body=await r.json();if(!r.ok)throw new Error(body.error);busy=true;$('#scan').disabled=true;await poll();}catch(e){status(e.message,'bad');}});
(async()=>{await refresh();local=await get('/api/status').then(()=>true).catch(()=>false);if(local){$('#scan').hidden=false;$('#schedule').textContent='本地服务运行时自动扫描';setInterval(poll,3000);await poll();}})();setInterval(()=>{if(!busy)refresh();},60000);

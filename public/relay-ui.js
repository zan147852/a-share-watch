function relayAuditView(candidate,report){
 const settings=report.settings?.sequential||{},audit=RelayRules.audit(candidate,report,settings);
 const block=el('div',undefined,'relay-audit');
 block.append(el('p',audit.summary+(audit.firstBlock?' · 首个待处理：'+audit.firstBlock:''),'relay-result'));
 const labels={pass:'通过',fail:'排除',unknown:'缺证据',pending:'待人工'};
 const strip=el('div',undefined,'step-strip relay-strip');
 for(const [i,g]of audit.stages.entries()){const item=el('div',undefined,'step-mini '+g.status);item.append(el('small',`${i+1} ${g.name}`),el('strong',labels[g.status]));strip.append(item);}block.append(strip);
 const detail=el('details');detail.append(el('summary','展开每一关的条件与实际值'));
 for(const [i,g]of audit.stages.entries()){const section=el('section',undefined,'step-detail');section.append(el('h4',`${i+1} ${g.name} · ${labels[g.status]}`));for(const check of g.checks)section.append(el('p',`${labels[check.status]} · ${check.label}：${check.detail}`));detail.append(section);}block.append(detail);
 return block;
}
function relayManualCard(candidate,report){
 const details=el('details',undefined,'relay-manual');details.append(el('summary','填写盘中回封记录与私人计划'));
 details.append(el('p','此卡由你填写实时依据。自动刷新会恢复本机草稿；草稿和导出文件不上传。请先在行情软件核实当日涨停价和交易日，实际损失可能超过计划。','note'));
 const settings={...RelayRules.defaults,...report.settings?.sequential},form=el('form',undefined,'relay-form'),grid=el('div',undefined,'relay-fields');
 const fields={};
 const add=(key,label,type='text',value='')=>{const wrap=el('label',label),input=el(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;input.name=key;input.value=value;input.id=`relay-${report.date}-${candidate.code}-${key}`;wrap.htmlFor=input.id;if(type==='number'){input.step='any';input.min='0';}if(type==='time')input.step='1';fields[key]=input;wrap.append(input);grid.append(wrap);return input;};
 add('tradeDate','实际目标交易日','date',today>report.date?today:'');
 add('equity','当前账户本金（元）','number');
 add('limitPrice','当日实际涨停价（元）','number');
 add('entry','计划限价（须等于涨停价）','number');
 add('stop','事前结构失效价（元）','number');
 add('newPositions','今日已新增几只持仓','number','0');
 add('touchedAt','首次触板时间','time');add('openedAt','板下成交时间','time');add('resealedAt','重新封板时间','time');
 for(let i=1;i<=2;i++){add(`peer${i}Code`,`同题材同伴${i}代码`);add(`peer${i}Price`,`同伴${i}当前价格`,'number');add(`peer${i}Close`,`同伴${i}昨收`,'number');}
 add('peerEvidence','同伴题材归属依据','textarea');add('businessEvidence','公司业务、催化原文链接及新增事实','textarea');
 add('invalidation','理由失效条件','textarea');add('nextDayExit','次日退出条件','textarea');add('timeExit','时间退出条件','textarea');
 const checks=el('div',undefined,'relay-checkboxes');
 for(const [key,label]of [['catalystValid','已核对业务与催化仍有效，没有否定交易依据的新公告'],['marketStable','盘中核心连板未明显走弱，市场排除条件未新增'],['newSeal','已看到回到涨停价后出现新封单']]){const wrap=el('label'),input=el('input');input.type='checkbox';input.name=key;fields[key]=input;wrap.append(input,el('span',label));checks.append(wrap);}
 const note=el('p',`金额上限 ${settings.positionCap} 元；每天最多新买 ${settings.maxNewPositions} 只；计划账户风险 ${(settings.riskFraction*100).toFixed(2)}%，费用预留 ${settings.costReserve} 元。`,'note');
 const actions=el('div',undefined,'relay-actions'),verify=el('button','核对记录与股数'),download=el('button','导出私人计划'),clear=el('button','清除本机草稿');verify.type='submit';download.type=clear.type='button';download.disabled=true;actions.append(verify,download,clear);
 const output=el('div',undefined,'relay-output');output.setAttribute('aria-live','polite');
 form.append(grid,checks,note,actions,output);details.append(form);
 const key=`relay-draft:${RelayRules.VERSION}:${report.date}:${candidate.code}`;
 const values=()=>Object.fromEntries(Object.entries(fields).map(([k,input])=>[k,input.type==='checkbox'?input.checked:input.value]));
 try{const saved=JSON.parse(localStorage.getItem(key)||'null');if(saved)for(const [k,v]of Object.entries(saved))if(fields[k])fields[k].type==='checkbox'?fields[k].checked=v===true:fields[k].value=v;}catch{details.append(el('p','浏览器未允许保存草稿，请使用私人文件保留记录。','note'));}
 const numeric=key=>fields[key].value.trim()===''?null:Number(fields[key].value);
 const draft=()=>({...values(),equity:numeric('equity'),entry:numeric('entry'),stop:numeric('stop'),limitPrice:numeric('limitPrice'),newPositions:numeric('newPositions'),observedAt:new Date().toISOString(),peers:[1,2].map(i=>({code:fields[`peer${i}Code`].value.trim(),price:numeric(`peer${i}Price`),previousClose:numeric(`peer${i}Close`)}))});
 const validate=()=>{
  const d=draft(),result=RelayRules.validateManual(d,candidate,report,settings);output.replaceChildren(el('strong',result.label));
  for(const reason of result.reasons)output.append(el('p',reason));
  if(result.sizing){const p=result.sizing;output.append(el('p',`计划 ${p.shares} 股 / 金额 ${num(p.positionAmount)} 元 / 计划损失含费用 ${num(p.plannedRisk)} 元 / 跌20%压力估算 ${num(p.stressLoss20)} 元（损失可能更大）`));}
  output.append(el('p',result.note));download.disabled=result.status!=='manual_review';return {d,result};
 };
 form.addEventListener('input',()=>{download.disabled=true;output.replaceChildren();try{localStorage.setItem(key,JSON.stringify(values()));}catch{output.append(el('p','草稿保存失败，请勿依赖刷新恢复。'));}});
 form.addEventListener('submit',event=>{event.preventDefault();validate();});
 clear.addEventListener('click',()=>{try{localStorage.removeItem(key);}catch{}for(const input of Object.values(fields))input.type==='checkbox'?input.checked=false:input.value='';download.disabled=true;output.replaceChildren(el('p','本机草稿已清除。'));});
 download.addEventListener('click',()=>{
  const {d,result}=validate();if(result.status!=='manual_review')return;
  const createdAt=d.observedAt,id=`relay-${d.tradeDate}-${candidate.code}-${Date.now()}`;
  const plan={id,code:candidate.code,mode:candidate.targetBoard===2?'二板分歧回封':candidate.targetBoard===3?'三板分歧回封':'高板分歧回封',version:RelayRules.VERSION,createdAt,tradeDate:d.tradeDate,equity:d.equity,entry:d.entry,stop:d.stop,riskFraction:settings.riskFraction,maxPositionFraction:Math.min(1,settings.positionCap/d.equity),costReserve:settings.costReserve,exitRules:{invalidation:d.invalidation,nextDay:d.nextDayExit,timeExit:d.timeExit},relayEvidence:{draft:d,candidate,report:{date:report.date,version:report.version,metrics:report.metrics,coverage:report.coverage},settings}};
  const payload={schema:1,plans:[plan],fills:[],misses:[]},url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'})),a=el('a');a.href=url;a.download=id+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  output.append(el('p','已导出私人计划（未下单、未成交）。导入现有账本前请合并文件中的计划；不要用单笔文件替换已有完整账本。'));
 });
 return details;
}

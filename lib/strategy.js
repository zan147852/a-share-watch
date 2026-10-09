const {completeBars}=require('./time');
function parseKlines(lines=[]) {return lines.map(line=>{const p=String(line).split(',');return {date:p[0].slice(0,10),timestamp:p[0],open:+p[1],close:+p[2],high:+p[3],low:+p[4],volume:+p[5],amount:+p[6]};}).filter(r=>[r.open,r.close,r.high,r.low].every(n=>Number.isFinite(n)&&n>0)).sort((a,b)=>a.timestamp.localeCompare(b.timestamp));}
function evaluate(rows,date,settings) {
 const target=rows.find(r=>r.date===date),prev=rows.filter(r=>r.date<date);
 if(!target)return {outcome:'missing',reason:'缺少目标日期日线'};
 if(prev.length<Math.max(settings.breakoutDays,settings.stopDays))return {outcome:'insufficient',reason:'历史K线不足'};
 const B=Math.max(...prev.slice(-settings.breakoutDays).map(r=>r.high));
 const S=Math.min(...prev.slice(-settings.stopDays).map(r=>r.low));
 const risk=1-S/target.close;
 const details={B,S,close:target.close,risk,ceiling:Math.floor((B*(1+settings.maxEntryOverBreakout)+1e-9)*100)/100,pct:(target.close/prev.at(-1).close-1)*100,previousDate:prev.at(-1).date};
 if(target.close<=B)return {outcome:'below',reason:'收盘未突破10日高点',...details};
 if(target.close>details.ceiling+1e-8)return {outcome:'overprice',reason:'收盘已超最高观察价',...details};
 if(risk>settings.maxPriceRisk+1e-10 || risk<=0)return {outcome:'risk',reason:'以收盘价计算的风险距离超限',...details};
 return {outcome:'candidate',...details};
}
function checkMinutes(bars,date,B,now=new Date()) {const complete=completeBars(bars,date,now);const last=complete.at(-1);return {available:complete.length>0,barCount:complete.length,lastBar:last?.timestamp||null,completeDay:complete.length===8 && last?.timestamp.endsWith('15:00'),passed:Boolean(complete.length===8 && last?.timestamp.endsWith('15:00') && last.close>B)};}
function convertToActual(details,rawClose,settings) {const factor=rawClose/details.close;if(!Number.isFinite(factor)||factor<=0)throw new Error('无法统一复权价格');return {...details,B:details.B*factor,S:details.S*factor,close:rawClose,ceiling:Math.floor((details.B*factor*(1+settings.maxEntryOverBreakout)+1e-9)*100)/100,adjustmentFactor:factor};}
function isAllowed(item,settings) {return /^\d{6}$/.test(item.code) && settings.allowedCodePrefixes.some(p=>item.code.startsWith(p)) && !/ST|退/i.test(item.name);}
module.exports={parseKlines,evaluate,checkMinutes,convertToActual,isAllowed};

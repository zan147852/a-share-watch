const OFFSET=8*60*60*1000;
function chinaNow(date=new Date()) {return new Date(date.getTime()+OFFSET).toISOString().slice(0,19);}
function dateToday(date=new Date()) {return chinaNow(date).slice(0,10);}
function validDate(text) {return typeof text==='string' && /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(text+'T12:00:00Z')) && new Date(text+'T12:00:00Z').toISOString().slice(0,10)===text;}
function addDays(text,n) {const d=new Date(text+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
function closedEnough(text,now=new Date()) {return validDate(text) && (text<dateToday(now) || (text===dateToday(now) && chinaNow(now).slice(11,16)>='15:20'));}
function completeBars(bars,date,now=new Date()) {const times=new Set(['10:00','10:30','11:00','11:30','13:30','14:00','14:30','15:00']);return bars.filter(b=>b.date===date && times.has(b.timestamp.slice(11,16)) && b.timestamp.slice(0,16).replace(' ','T')<=chinaNow(now).slice(0,16));}
module.exports={chinaNow,dateToday,validDate,addDays,closedEnough,completeBars};

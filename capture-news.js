const {capture}=require('./lib/news'),store=require('./lib/store'),path=require('path');
const date=process.argv[2]||require('./lib/time').dateToday();
capture(__dirname,date).then(news=>{const file=path.join(__dirname,'public','data','results-'+date+'.json');const report=store.read(file);if(report){report.news={...news,message:news.note};require('./lib/news').attach(report.candidates||[],news);store.write(file,report);}console.log(JSON.stringify({date,status:news.status,count:news.items.length,pages:news.pages,error:news.error}));});

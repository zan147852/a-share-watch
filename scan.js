const {scan}=require('./lib/scanner');
const args=process.argv.slice(2),dateArg=args.indexOf('--date'),limitArg=args.indexOf('--limit');
scan({date:dateArg>=0?args[dateArg+1]:undefined,limit:limitArg>=0?Number(args[limitArg+1]):undefined,progress:s=>console.log(s.phase+' '+s.done+'/'+s.total)})
.then(r=>{console.log(JSON.stringify({date:r.date,status:r.status,scanned:r.scanned,candidates:r.candidates.length,message:r.message}));process.exitCode=['failed','partial','no_target_bar'].includes(r.status)?1:0;}).catch(e=>{console.error(e.message);process.exitCode=1;});

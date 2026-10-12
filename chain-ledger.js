// 私人账本不放入 public/data，不上传 GitHub。
const fs=require('fs'),path=require('path'),store=require('./lib/store'),ledger=require('./lib/chain-ledger');
const [command,input]=process.argv.slice(2),dir=path.join(__dirname,'.private'),file=path.join(dir,'chain-ledger.json');
try{
 if(command==='import'&&input){
  const candidate=ledger.validateLedger(JSON.parse(fs.readFileSync(path.resolve(input),'utf8')));
  // 导入整份账本；覆盖前留存可恢复副本。
  if(fs.existsSync(file))fs.copyFileSync(file,file+'.backup-'+Date.now());
  store.write(file,candidate);store.write(path.join(dir,'chain-review.json'),ledger.summarize(candidate));
  console.log('账本已核验并保存于 .private；未上传。');
 }else if(command==='review'){
  const candidate=ledger.validateLedger(store.read(file,{plans:[],fills:[],misses:[]}));
  const report=ledger.summarize(candidate);store.write(path.join(dir,'chain-review.json'),report);
  console.log(JSON.stringify({closedRounds:report.closedRounds,netClosed:report.netClosed,winRate:report.winRate}));
 }else throw Error('用法：node chain-ledger.js import 文件.json 或 node chain-ledger.js review');
}catch(e){console.error(e.message);process.exitCode=1;}

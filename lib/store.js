const fs=require('fs'),path=require('path');
function read(file,fallback=null){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}}
function write(file,value){fs.mkdirSync(path.dirname(file),{recursive:true});const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2));fs.renameSync(temp,file);}
function manifest(dir){const results=fs.existsSync(dir)?fs.readdirSync(dir).filter(s=>/^results-\d{4}-\d{2}-\d{2}\.json$/.test(s)).sort().reverse().map(s=>read(path.join(dir,s))).filter(Boolean):[];write(path.join(dir,'manifest.json'),{updatedAt:new Date().toISOString(),dates:results.map(r=>({date:r.date,status:r.status,candidateCount:r.candidates?.length??0,generatedAt:r.generatedAt,coverage:r.coverage}))});}
module.exports={read,write,manifest};

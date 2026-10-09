const fs=require('fs'),path=require('path');
const files={};
function visit(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(['.cache','.git','node_modules','qa','vendor'].includes(entry.name))continue;const full=path.join(dir,entry.name),relative=path.relative(__dirname,full).replaceAll('\\','/');if(entry.isDirectory())visit(full);else if(!['project-bundle.json','cls-sample.html','cls-script-sample.js','build-icons.js'].includes(relative)&&!relative.startsWith('public/data/')&&!relative.endsWith('.log'))files[relative]=fs.readFileSync(full).toString('base64');}}
visit(__dirname);
const archive=require('zlib').gzipSync(Buffer.from(JSON.stringify(files))).toString('base64');
fs.writeFileSync(path.join(__dirname,'project-bundle.json'),JSON.stringify({format:2,archive}));
console.log('Bundled '+Object.keys(files).length+' files');

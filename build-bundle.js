const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const zlib = require('zlib');

function buildBundle(root = __dirname) {
  // Respect .gitignore, including local credentials, and use a stable path order.
  const names = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const files = {};
  for (const name of [...new Set(names)].sort()) {
    if (name === 'project-bundle.json' || /^(public\/data|douyin-monitor\/(data|reports)|\.cache|qa|vendor|node_modules)\//.test(name)) continue;
    // Exclude secrets even if accidentally tracked; release checks also reject them.
    if (/(^|\/)(\.env(?:\..*)?|config\.local\.json)$|\.(pem|key|p12|pfx|log|zip)$/i.test(name)) continue;
    if (['cls-sample.html', 'cls-script-sample.js', 'build-icons.js'].includes(name)) continue;
    const full = path.join(root, name);
    if (!fs.existsSync(full) || !fs.lstatSync(full).isFile()) continue;
    let data = fs.readFileSync(full);
    if (/\.(js|json|md|css|html|yml|yaml|ps1|txt|svg)$|(^|\/)\.(gitignore|gitattributes|nojekyll)$/.test(name)) {
      data = Buffer.from(data.toString('utf8').replace(/\r\n/g, '\n'));
    }
    files[name] = data.toString('base64');
  }
  // Uncompressed DEFLATE avoids zlib-version differences in the checked-in bundle.
  const archive = zlib.gzipSync(Buffer.from(JSON.stringify(files)), { level: 0 });
  archive[9] = 255; // Platform-independent gzip OS header.
  const bundle = { format: 2, archive: archive.toString('base64') };
  fs.writeFileSync(path.join(root, 'project-bundle.json'), JSON.stringify(bundle));
  return files;
}

if (require.main === module) console.log(`Bundled ${Object.keys(buildBundle()).length} files`);
module.exports = { buildBundle };

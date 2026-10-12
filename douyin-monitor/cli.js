const fs = require('fs');
const path = require('path');
const { run, dateToday } = require('./lib/pipeline');
const store = require('./lib/store');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const command = args[0] || 'run';
const valueAfter = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

async function main() {
  if (command === 'check') {
    const config = require('./lib/config').load(root);
    const result = await require('./lib/douyin').search({
      token: config.douyinAccessToken, clientKey: config.douyinClientKey,
      clientSecret: config.douyinClientSecret, deviceId: config.douyinDeviceId,
      keywords: [config.keywords[0] || 'A股'], pageSize: 1, maxPages: 1,
      publishTime: 7, sortType: 2
    });
    console.log(JSON.stringify({ status: result.status, count: result.records.length, errors: result.errors }, null, 2));
    if (result.status !== 'complete') process.exitCode = 1;
    return;
  }
  if (command === 'import') {
    const file = valueAfter('--file');
    if (!file) throw new Error('用法：node douyin-monitor/cli.js import --file data/share.json');
    const items = JSON.parse(fs.readFileSync(path.resolve(root, file), 'utf8'));
    const rows = Array.isArray(items) ? items : [items];
    const config = require('./lib/config').load(root);
    const result = store.upsert(path.join(root, config.storageFile || 'data/douyin-records.json'), rows.map(item => ({ ...item, source: item.source || 'manual-share-link' })));
    console.log(JSON.stringify({ imported: rows.length, total: result.records.length }, null, 2));
    return;
  }
  if (command === 'run' || command === 'report') {
    const result = await run({ root, date: valueAfter('--date') || dateToday(), skipCollect: command === 'report' || args.includes('--skip-collect') });
    console.log(JSON.stringify({ date: result.date, status: result.status, collection: result.collection.status, analyzed: result.summary.analyzed, watchlist: result.summary.watchlist, push: result.push, files: result.files }, null, 2));
    return;
  }
  if (command === 'help') {
    console.log('node douyin-monitor/cli.js check\nnode douyin-monitor/cli.js run [--date YYYY-MM-DD]\nnode douyin-monitor/cli.js import --file data/share.json\nnode douyin-monitor/cli.js report --date YYYY-MM-DD');
    return;
  }
  throw new Error(`未知命令：${command}`);
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });

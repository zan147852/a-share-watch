const path = require('path');
const configLoader = require('./config');
const store = require('./store');
const douyin = require('./douyin');
const analysis = require('./analyze');
const reportWriter = require('./report');
const pushClient = require('./push');

function dateToday() { return new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10); }

async function run({ root, date = dateToday(), skipCollect = false } = {}) {
  root = root || path.resolve(__dirname, '..', '..');
  const config = configLoader.load(root);
  const storageFile = path.join(root, config.storageFile || 'data/douyin-records.json');
  let collection = { status: 'skipped', records: [], errors: ['本轮跳过网络采集'] };
  if (!skipCollect) collection = await douyin.search({ token: config.douyinAccessToken, creators: config.creators, keywords: config.keywords, publishTime: config.publishTime, sortType: config.sortType, pageSize: config.pageSize, maxPages: config.maxPages });
  const saved = store.upsert(storageFile, collection.records);
  const records = analysis.analyze(saved.records);
  const written = reportWriter.writeReport({ root, date, records, collection, newRecords: saved.addedRecords || [], config });
  let push = { status: 'disabled', message: '未配置微信推送' };
  try { push = await pushClient.push(written.report, config); } catch (error) { push = { status: 'failed', message: error.message }; }
  written.report.push = push;
  store.write(written.jsonFile, written.report);
  return { ...written.report, files: { json: written.jsonFile, markdown: written.mdFile }, push };
}

module.exports = { run, dateToday };

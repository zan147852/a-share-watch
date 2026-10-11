const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze } = require('../douyin-monitor/lib/analyze');
const { buildMarkdown } = require('../douyin-monitor/lib/report');

test('观点分析识别方向、题材和股票代码', () => {
  const rows = analyze([
    { id: '1', author: '舵手k神', matchedCreator: '舵手k神', title: '人工智能放量突破，明日关注600000，跌破支撑止损', text: '', publishedAt: new Date().toISOString() },
    { id: '2', author: '全能野人', matchedCreator: '全能野人', title: '人工智能短线继续看多', text: '', publishedAt: new Date().toISOString() }
  ]);
  assert.equal(rows[0].analysis.direction, '偏多');
  assert.deepEqual(rows[0].analysis.codes, ['600000']);
  assert.ok(rows[0].analysis.sectors.includes('人工智能'));
  assert.ok(rows[0].analysis.crossSourceCount >= 1);
});

test('日报可在无候选时生成 Markdown', () => {
  const markdown = buildMarkdown({ date: '2026-10-11', status: 'complete', summary: { newRecords: 0, analyzed: 0, watchlist: 0, pending: 0 }, collection: { status: 'missing_token', errors: [] }, items: [] });
  assert.match(markdown, /抖音股票观点日报/);
  assert.match(markdown, /没有取得|暂无/);
});

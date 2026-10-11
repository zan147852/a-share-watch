const fs = require('fs');
const path = require('path');
const store = require('./store');

function dateOnly(value) { return String(value || '').slice(0, 10); }
function cnTime(value) { return value ? new Date(new Date(value).getTime() + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ') : '未取得'; }
function mdEscape(value) { return String(value ?? '').replaceAll('|', '\\|').replaceAll('\n', ' '); }

function buildMarkdown(report) {
  const lines = [`# 抖音股票观点日报`, '', `日期：${report.date}`, `状态：${report.status}`, '', `> 本日报只整理公开内容，观点不是买卖指令。候选股票需经过行情、公告和风险条件核验。`, '', `## 今日概况`, '', `- 新增作品：${report.summary.newRecords}`, `- 纳入分析：${report.summary.analyzed}`, `- 观察候选：${report.summary.watchlist}`, `- 待核实：${report.summary.pending}`, `- 数据状态：${report.collection.status}`, ''];
  if (report.collection.errors?.length) lines.push('## 采集异常', '', ...report.collection.errors.map(error => `- ${mdEscape(error)}`), '');
  lines.push('## 观点候选', '', '|作者|时间|方向|题材|股票代码|周期|评分|链接|', '|---|---|---|---|---|---|---:|---|');
  for (const item of report.items.slice(0, 50)) {
    const a = item.analysis || {};
    const link = item.url ? `[打开](${item.url})` : '无链接';
    lines.push(`|${mdEscape(item.author)}|${cnTime(item.publishedAt)}|${a.direction || '—'}|${mdEscape((a.sectors || []).join('、') || '未识别')}|${mdEscape((a.codes || []).join('、') || '未识别')}|${a.horizon || '—'}|${a.score ?? '—'}|${link}|`);
    lines.push(`|摘要|${mdEscape(a.summary || item.title || '')}||||||`);
  }
  if (!report.items.length) lines.push('|—|—|—|暂无|—|—|—|—|');
  lines.push('', '## 使用规则', '', '1. 只有同时具备明确方向、题材或股票、时间周期和触发/失效条件的内容，才进入观察候选。', '2. 多位作者一致只能增加研究优先级，不能替代行情和公告核验。', '3. 报告不会自动下单，也不会修改现有交易系统仓位。', '', '## 边界', '', '- 抖音官方搜索接口需要开发者权限；没有令牌时可用分享链接导入。', '- 平台搜索结果不是指定作者的完整作品列表。', '- 评分是资料整理优先级，尚未证明具有盈利能力。');
  return lines.join('\n') + '\n';
}

function writeReport({ root, date, records, collection, newRecords, config }) {
  const cutoff = new Date(`${date}T00:00:00+08:00`).getTime() - (Number(config.reportDays || 3) - 1) * 86400000;
  const items = records.filter(item => {
    const time = new Date(item.publishedAt || 0).getTime();
    return !Number.isFinite(time) || time >= cutoff;
  }).sort((a, b) => (b.analysis?.score || 0) - (a.analysis?.score || 0));
  const report = {
    date, generatedAt: new Date().toISOString(), status: collection.status === 'complete' ? 'complete' : 'partial',
    collection, summary: {
      newRecords: newRecords.length, analyzed: items.length,
      watchlist: items.filter(item => item.analysis?.status === '观察候选').length,
      pending: items.filter(item => item.analysis?.status === '待核实').length
    }, items,
    limitations: ['抖音搜索结果不保证覆盖指定作者全部作品', '观点仅用于研究观察，不自动买卖', '评分规则尚未经过盈利验证']
  };
  const dataDir = path.join(root, config.publicDataDir || 'public/data');
  const reportDir = path.join(root, config.reportDir || 'reports');
  const jsonFile = path.join(dataDir, `douyin-report-${date}.json`);
  const mdFile = path.join(dataDir, `douyin-report-${date}.md`);
  fs.mkdirSync(reportDir, { recursive: true });
  store.write(jsonFile, report);
  fs.writeFileSync(mdFile, buildMarkdown(report));
  fs.writeFileSync(path.join(reportDir, `douyin-${date}.md`), buildMarkdown(report));
  const existing = store.read(path.join(dataDir, 'douyin-manifest.json'), { dates: [] });
  const dates = [...new Set([date, ...(existing.dates || []).map(item => typeof item === 'string' ? item : item.date)])].filter(Boolean).sort().reverse().slice(0, 90);
  store.write(path.join(dataDir, 'douyin-manifest.json'), { updatedAt: new Date().toISOString(), dates: dates.map(item => ({ date: item, report: `douyin-report-${item}.json` })) });
  return { report, jsonFile, mdFile };
}

module.exports = { writeReport, buildMarkdown };

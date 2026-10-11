const sectorTerms = {
  半导体: ['半导体', '芯片', '光刻机', '晶圆', '存储'],
  人工智能: ['人工智能', 'AI', '算力', '机器人', '大模型', '智能体'],
  新能源: ['新能源', '锂电', '光伏', '储能', '电池', '充电桩'],
  军工: ['军工', '航天', '卫星', '低空经济', '商业航天'],
  券商金融: ['券商', '证券', '银行', '保险', '金融'],
  消费: ['消费', '白酒', '医药', '旅游', '零售'],
  有色资源: ['有色', '黄金', '铜', '铝', '稀土', '资源'],
  数字经济: ['数字经济', '数据要素', '信创', '通信', '互联网']
};
const positive = ['看多', '上涨', '突破', '强势', '买入', '低吸', '机会', '主升', '反弹', '预期'];
const negative = ['看空', '下跌', '风险', '回避', '卖出', '减仓', '破位', '见顶', '谨慎'];
const conditions = ['如果', '站上', '突破', '放量', '回踩', '不破', '条件', '止损', '失效', '确认', '量比', '成交量'];

function termsFound(text, words) { return words.filter(word => text.toLowerCase().includes(word.toLowerCase())); }
function horizon(text) {
  if (/盘中|今日|明日|明天|次日/.test(text)) return '日内/次日';
  if (/短线|几天|一周|本周/.test(text)) return '短线';
  if (/中线|数周|几个月|季度/.test(text)) return '中线';
  return '未说明';
}

function baseAnalysis(record) {
  const text = `${record.title || ''} ${record.text || ''}`;
  const sectors = Object.entries(sectorTerms).filter(([, words]) => words.some(word => text.toLowerCase().includes(word.toLowerCase()))).map(([name]) => name);
  const codes = [...new Set((text.match(/(?<!\d)\d{6}(?!\d)/g) || []))];
  const pos = termsFound(text, positive).length;
  const neg = termsFound(text, negative).length;
  return { direction: pos > neg ? '偏多' : neg > pos ? '偏空' : '中性/不明', sectors, codes };
}

function analyzeRecord(record, all) {
  const text = `${record.title || ''} ${record.text || ''}`;
  const base = record.analysis?.sectors?.length || record.analysis?.codes?.length ? record.analysis : baseAnalysis(record);
  const sectors = base.sectors;
  const codes = base.codes;
  const pos = termsFound(text, positive).length;
  const neg = termsFound(text, negative).length;
  const direction = pos > neg ? '偏多' : neg > pos ? '偏空' : '中性/不明';
  const evidence = termsFound(text, conditions);
  const specificity = Math.min(30, (codes.length ? 15 : 0) + (sectors.length ? 8 : 0) + (evidence.length ? 7 : 0));
  const freshness = record.publishedAt && (Date.now() - new Date(record.publishedAt).getTime()) < 3 * 86400000 ? 20 : 8;
  const evidenceScore = Math.min(20, evidence.length * 4 + (text.length > 120 ? 4 : 0));
  const matched = all.filter(other => other.id !== record.id && other.analysis?.direction === direction && (record.matchedCreator && other.matchedCreator && other.matchedCreator !== record.matchedCreator) && sectors.some(s => other.analysis?.sectors?.includes(s))).length;
  const crossSource = Math.min(20, matched * 5);
  const sourceScore = record.matchedCreator ? 10 : 5;
  const score = Math.min(100, specificity + freshness + evidenceScore + crossSource + sourceScore);
  const summary = `${direction}；题材 ${(sectors.join('、') || '未识别')}；股票 ${(codes.join('、') || '未识别')}；周期 ${horizon(text)}；条件 ${(evidence.join('、') || '未识别')}`;
  return {
    direction, sectors, codes, horizon: horizon(text), evidenceTerms: evidence, summary,
    score, status: score >= 70 ? '观察候选' : score >= 50 ? '待核实' : '仅作线索',
    scoreBreakdown: { specificity, freshness, evidence: evidenceScore, crossSource, source: sourceScore },
    crossSourceCount: matched
  };
}

function analyze(records) {
  const firstPass = records.map(record => ({ ...record, analysis: baseAnalysis(record) }));
  return firstPass.map(record => ({ ...record, analysis: analyzeRecord(record, firstPass) }));
}

module.exports = { analyze, analyzeRecord, sectorTerms };

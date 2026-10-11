const https = require('https');

function post(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const target = new URL(url);
    const req = https.request({ hostname: target.hostname, path: `${target.pathname}${target.search}`, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => { if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`推送 HTTP ${res.statusCode}`)); resolve(Buffer.concat(chunks).toString('utf8')); });
    });
    req.setTimeout(15000, () => req.destroy(new Error('推送超时')));
    req.on('error', reject);
    req.write(body); req.end();
  });
}

async function push(report, config) {
  const pushConfig = config.push || {};
  const provider = pushConfig.provider || 'none';
  if (provider === 'none') return { status: 'disabled', message: '未配置微信推送' };
  const title = `抖音观点日报 ${report.date} · 候选 ${report.summary.watchlist}`;
  const content = require('./report').buildMarkdown(report).slice(0, 9500);
  if (provider === 'pushplus') {
    if (!pushConfig.token) return { status: 'skipped', message: 'PushPlus 未配置 token' };
    await post('https://www.pushplus.plus/send', { token: pushConfig.token, title, content, template: 'markdown', topic: pushConfig.topic || undefined });
    return { status: 'sent', provider };
  }
  if (provider === 'wechat-robot') {
    if (!pushConfig.webhook) return { status: 'skipped', message: '企业微信机器人未配置 webhook' };
    await post(pushConfig.webhook, { msgtype: 'markdown', markdown: { content: `### ${title}\n${content.replaceAll('#', '')}` } });
    return { status: 'sent', provider };
  }
  return { status: 'skipped', message: `未知推送方式：${provider}` };
}

module.exports = { push };

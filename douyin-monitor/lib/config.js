const fs = require('fs');
const path = require('path');

function readJson(file, fallback = {}) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function merge(base, extra) {
  const out = { ...base, ...extra };
  for (const key of ['push']) {
    if (base[key] || extra[key]) out[key] = { ...(base[key] || {}), ...(extra[key] || {}) };
  }
  return out;
}

function load(root) {
  const dir = path.join(root, 'douyin-monitor');
  let config = readJson(path.join(dir, 'config.json'), {});
  config = merge(config, readJson(path.join(dir, 'config.local.json'), {}));
  const env = process.env;
  config.push = { ...(config.push || {}) };
  if (env.PUSHPLUS_TOKEN) config.push = { ...config.push, provider: 'pushplus', token: env.PUSHPLUS_TOKEN };
  if (env.PUSHPLUS_TOPIC) config.push.topic = env.PUSHPLUS_TOPIC;
  if (env.WECHAT_ROBOT_WEBHOOK) config.push = { ...config.push, provider: 'wechat-robot', webhook: env.WECHAT_ROBOT_WEBHOOK };
  if (env.DOUYIN_ACCESS_TOKEN) config.douyinAccessToken = env.DOUYIN_ACCESS_TOKEN;
  config.creators = Array.isArray(config.creators) ? config.creators : [];
  config.keywords = Array.isArray(config.keywords) ? config.keywords : [];
  return config;
}

module.exports = { load, readJson };

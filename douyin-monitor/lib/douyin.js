const https = require('https');

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'douyin-stock-observer/1.0',
        Accept: 'application/json',
        ...(options.headers || {})
      }
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`抖音接口 HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(body)); } catch { reject(new Error('抖音接口返回不是 JSON')); }
      });
    });
    req.setTimeout(options.timeoutMs || 15000, () => req.destroy(new Error('抖音接口超时')));
    req.on('error', reject);
    if (options.body) req.write(JSON.stringify(options.body));
    req.end();
  });
}

function first(...values) { return values.find(value => value !== undefined && value !== null && value !== ''); }

function pageFrom(payload) {
  return payload?.data?.data || payload?.data || payload;
}

function listFrom(payload) {
  const page = pageFrom(payload);
  const list = Array.isArray(page) ? page : page?.video_list || page?.aweme_list || page?.list || page?.videos;
  if (!Array.isArray(list)) throw new Error('抖音响应缺少视频列表，不能视为零条结果');
  return list;
}

const errorHints = {
  28001003: '应用令牌无效', 28001008: '应用令牌已过期',
  28001014: '应用尚未授权能力', 28001018: '应用未开通视频搜索权限',
  28003017: '接口额度已用完', 28001019: '该能力已被封禁',
  28001016: '应用被封禁或下线', 28001007: '接口参数不合法，请检查 device_id 等参数',
  10002: '令牌请求参数错误', 10003: 'client_key 不存在',
  10013: 'client_key 或 client_secret 不正确'
};

function checkErrors(body) {
  for (const section of [body, body?.data, body?.data?.data]) {
    for (const key of ['err_no', 'error_code']) {
      const code = section?.[key];
      if (code !== undefined && Number(code) !== 0) {
        // Do not persist API error bodies: they may echo request credentials.
        const safeCode = /^\d+$/.test(String(code)) ? String(code) : 'unknown';
        throw new Error(`抖音接口错误 ${safeCode}：${errorHints[safeCode] || '请在开放平台检查应用状态与请求参数'}`);
      }
    }
  }
}

async function getClientToken({ clientKey, clientSecret }, requestFn = request) {
  const body = await requestFn(new URL('https://open.douyin.com/oauth/client_token/'), {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: { client_key: clientKey, client_secret: clientSecret, grant_type: 'client_credential' }
  });
  checkErrors(body);
  const token = body?.data?.access_token;
  if (typeof token !== 'string' || !token.trim()) throw new Error('抖音没有返回有效的 client_token');
  return token;
}

function normalize(item, query, creators) {
  if (!item || typeof item !== 'object') return null;
  const author = String(first(item.author?.nickname, item.author?.unique_id, item.nickname, item.author_name, '未知作者'));
  const title = String(first(item.desc, item.title, item.text) || '').trim();
  const rawId = first(item.item_id, item.aweme_id, item.awemeId, item.id, item.video_id) ?? '';
  if (typeof rawId === 'number' && !Number.isSafeInteger(rawId)) return null;
  const id = String(rawId);
  if (!id || !title) return null;
  const seconds = Number(first(item.create_time, item.createTime, 0));
  const time = seconds > 1000000000 ? new Date(seconds > 1e12 ? seconds : seconds * 1000) : new Date(first(item.create_time, item.createTime, ''));
  const publishedAt = Number.isFinite(time.getTime()) ? time.toISOString() : null;
  const url = first(item.link, item.share_url, item.shareUrl, item.item_url, item.url, '');
  const matchedCreator = creators.find(name => author.trim() === name.trim()) || null;
  const content = first(item.high_quality_text, item.content, item.caption, '');
  return {
    id,
    awemeId: id,
    author,
    matchedCreator,
    title,
    text: content || title,
    textSource: content ? 'platform-text' : 'title-only',
    publishedAt,
    url,
    diggCount: Number(first(item.statistics?.digg_count, item.statistics?.diggCount, item.digg_count, 0)) || 0,
    commentCount: Number(first(item.statistics?.comment_count, item.statistics?.commentCount, 0)) || 0,
    query,
    source: 'douyin-official-api'
  };
}

async function search({ token, clientKey, clientSecret, deviceId, creators = [], keywords = [], publishTime = 1, sortType = 2, pageSize = 20, maxPages = 3 }, { requestFn = request } = {}) {
  const failure = (status, message) => ({ status, records: [], errors: [message] });
  if ((clientKey || clientSecret) && !(clientKey && clientSecret)) return failure('missing_credentials', 'DOUYIN_CLIENT_KEY 与 DOUYIN_CLIENT_SECRET 必须同时配置');
  if (!token && !clientKey) return failure('missing_token', '尚未配置抖音应用凭证；请配置 DOUYIN_CLIENT_KEY 与 DOUYIN_CLIENT_SECRET');
  if (typeof deviceId !== 'string' || !/^[1-9]\d{0,18}$/.test(deviceId) || BigInt(deviceId) > 9223372036854775807n) {
    return failure('missing_device_id', '请按平台接入要求配置 DOUYIN_DEVICE_ID（必填 Int64，以字符串保存）');
  }
  const knownSecrets = [token, clientKey, clientSecret].filter(Boolean);
  const safeMessage = error => knownSecrets.reduce((message, secret) => message.split(secret).join('[redacted]'), String(error.message || '请求失败'));
  if (clientKey && clientSecret) {
    try {
      token = await getClientToken({ clientKey, clientSecret }, requestFn);
      knownSecrets.push(token);
    } catch (error) { return failure('failed', `获取应用令牌失败：${safeMessage(error)}`); }
  }
  const terms = [...new Set([...creators, ...keywords].filter(Boolean))];
  const records = new Map();
  const errors = [];
  if (!terms.length) return failure('missing_queries', '尚未配置作者或关键词');
  for (const keyword of terms) {
    let cursor = 0;
    let searchId = '';
    for (let page = 0; page < maxPages; page++) {
      const url = new URL('https://open.douyin.com/dy_open_api/v1/search/video/');
      url.searchParams.set('keyword', keyword);
      url.searchParams.set('device_id', deviceId);
      url.searchParams.set('count', String(pageSize));
      url.searchParams.set('cursor', String(cursor));
      url.searchParams.set('publish_time', String(publishTime));
      url.searchParams.set('sort_type', String(sortType));
      if (searchId) url.searchParams.set('search_id', searchId);
      try {
        const body = await requestFn(url, { headers: { 'access-token': token, 'content-type': 'application/json' } });
        checkErrors(body);
        for (const item of listFrom(body)) {
          const normalized = normalize(item, keyword, creators);
          if (normalized) records.set(normalized.id, normalized);
          else errors.push(`${keyword}：跳过一条缺少有效作品 ID 或标题的记录`);
        }
        const data = pageFrom(body);
        cursor = String(first(data?.cursor, data?.next_cursor, data?.nextCursor, 0));
        searchId = String(first(data?.search_id, data?.searchId, searchId));
        if (![true, 1, '1'].includes(first(data?.has_more, data?.hasMore, false))) break;
      } catch (error) {
        errors.push(`${keyword}：${safeMessage(error)}`);
        break;
      }
    }
  }
  return { status: errors.length && !records.size ? 'failed' : errors.length ? 'partial' : 'complete', records: [...records.values()], errors };
}

module.exports = { search, normalize, listFrom, getClientToken };

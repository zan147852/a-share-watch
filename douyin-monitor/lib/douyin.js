const https = require('https');

function request(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
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
  });
}

function first(...values) { return values.find(value => value !== undefined && value !== null && value !== ''); }

function listFrom(payload) {
  return Array.isArray(payload?.data) ? payload.data : payload?.data?.aweme_list || payload?.data?.list || payload?.data?.videos || payload?.aweme_list || payload?.list || [];
}

function normalize(item, query, creators) {
  const author = first(item.author?.nickname, item.author?.unique_id, item.nickname, item.author_name, '未知作者');
  const title = first(item.desc, item.title, item.text, '').trim();
  const id = String(first(item.aweme_id, item.awemeId, item.id, item.video_id, ''));
  if (!id || !title) return null;
  const seconds = Number(first(item.create_time, item.createTime, 0));
  const publishedAt = seconds > 1000000000 ? new Date(seconds * 1000).toISOString() : first(item.create_time, item.createTime, null);
  const url = first(item.share_url, item.shareUrl, item.item_url, item.url, item.video?.play_addr?.url_list?.[0], '');
  const matchedCreator = creators.find(name => author.includes(name) || name.includes(author)) || null;
  return {
    id,
    awemeId: id,
    author,
    matchedCreator,
    title,
    text: first(item.content, item.caption, item.desc, title),
    publishedAt,
    url,
    diggCount: Number(first(item.statistics?.digg_count, item.statistics?.diggCount, item.digg_count, 0)) || 0,
    commentCount: Number(first(item.statistics?.comment_count, item.statistics?.commentCount, 0)) || 0,
    query,
    source: 'douyin-official-api'
  };
}

async function search({ token, creators = [], keywords = [], publishTime = 1, sortType = 1, pageSize = 20, maxPages = 3 }) {
  if (!token) return { status: 'missing_token', records: [], errors: ['未配置 DOUYIN_ACCESS_TOKEN；可先使用 import 导入分享链接信息。'] };
  const terms = [...new Set([...creators, ...keywords].filter(Boolean))];
  const records = new Map();
  const errors = [];
  for (const keyword of terms) {
    let cursor = 0;
    let searchId = '';
    for (let page = 0; page < maxPages; page++) {
      const url = new URL('https://open.douyin.com/dy_open_api/v1/search/video/');
      url.searchParams.set('keyword', keyword);
      url.searchParams.set('count', String(pageSize));
      url.searchParams.set('cursor', String(cursor));
      url.searchParams.set('publish_time', String(publishTime));
      url.searchParams.set('sort_type', String(sortType));
      if (searchId) url.searchParams.set('search_id', searchId);
      url.searchParams.set('access-token', token);
      try {
        const body = await request(url, { headers: { Authorization: `Bearer ${token}` } });
        const code = body?.data?.error_code ?? body?.error_code;
        if (code !== undefined && Number(code) !== 0) throw new Error(body?.data?.description || body?.description || `error_code=${code}`);
        for (const item of listFrom(body)) {
          const normalized = normalize(item, keyword, creators);
          if (normalized) records.set(normalized.id, normalized);
        }
        const data = body?.data || body;
        cursor = Number(first(data?.cursor, data?.next_cursor, data?.nextCursor, 0));
        searchId = String(first(data?.search_id, data?.searchId, searchId));
        if (!data?.has_more && !data?.hasMore) break;
      } catch (error) {
        errors.push(`${keyword}：${error.message}`);
        break;
      }
    }
  }
  return { status: errors.length && !records.size ? 'failed' : errors.length ? 'partial' : 'complete', records: [...records.values()], errors };
}

module.exports = { search, normalize, listFrom };

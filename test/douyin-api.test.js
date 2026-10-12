const test = require('node:test');
const assert = require('node:assert/strict');
const { search, normalize } = require('../douyin-monitor/lib/douyin');

const item = { item_id: '7471252140422401337', title: '今日复盘', create_time: 1739536450, nickname: '舵手k神', link: 'https://www.douyin.com/video/7471252140422401337', high_quality_text: '明日观察半导体，放量才确认', statistics: { digg_count: 12 } };
const page = (items, more = false) => ({ err_no: 0, data: { data: { video_list: items, cursor: 2, has_more: more, search_id: 'search-1' } } });
const config = { token: 'test-token', deviceId: '8241677744935186821', creators: ['舵手k神'], maxPages: 2 };

test('官方嵌套响应保留作品 ID、正文和链接，翻页沿用 search_id', async () => {
  const calls = [];
  const result = await search(config, { requestFn: async (url, options) => {
    calls.push({ url, options });
    assert.equal(url.searchParams.get('device_id'), config.deviceId);
    assert.equal(url.searchParams.get('sort_type'), '2');
    assert.equal(url.searchParams.has('access-token'), false);
    assert.equal(options.headers['access-token'], 'test-token');
    assert.equal(options.headers['content-type'], 'application/json');
    return page([item], calls.length === 1);
  } });
  assert.equal(result.status, 'complete');
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].id, item.item_id);
  assert.equal(result.records[0].text, item.high_quality_text);
  assert.equal(result.records[0].url, item.link);
  assert.equal(result.records[0].textSource, 'platform-text');
  assert.equal(calls[1].url.searchParams.get('search_id'), 'search-1');
  assert.equal(calls[1].url.searchParams.get('cursor'), '2');
});

test('每轮用应用密钥获取一次 client_token，不将凭证写进结果', async () => {
  let calls = 0;
  const result = await search({ ...config, clientKey: 'test-client-key', clientSecret: 'test-client-secret' }, { requestFn: async (url, options) => {
    calls++;
    if (url.pathname === '/oauth/client_token/') {
      assert.equal(options.method, 'POST');
      assert.deepEqual(options.body, { client_key: 'test-client-key', client_secret: 'test-client-secret', grant_type: 'client_credential' });
      return { data: { error_code: 0, access_token: 'new-test-token', expires_in: 7200 } };
    }
    assert.equal(options.headers['access-token'], 'new-test-token');
    return page([]);
  } });
  assert.equal(calls, 2);
  assert.equal(result.status, 'complete');
  assert.doesNotMatch(JSON.stringify(result), /test-client|new-test-token/);
});

test('权限错误、未知响应与部分失败不能报告采集完成', async () => {
  for (const body of [{ err_no: 28001018, err_msg: 'test-token', data: {} }, { data: {} }]) {
    const result = await search(config, { requestFn: async () => body });
    assert.equal(result.status, 'failed');
    assert.equal(result.records.length, 0);
    assert.doesNotMatch(JSON.stringify(result), /test-token/);
  }
  let calls = 0;
  const result = await search(config, { requestFn: async () => ++calls === 1 ? page([item], true) : { err_no: 28003017 } });
  assert.equal(result.status, 'partial');
  assert.equal(result.records.length, 1);
  assert.match(result.errors[0], /额度/);
});

test('缺凭证或无效 device_id 时不发送请求', async () => {
  const requestFn = async () => { throw new Error('不应发起网络调用'); };
  const cases = [
    [{}, 'missing_token'],
    [{ ...config, clientKey: 'test-key' }, 'missing_credentials'],
    [{ ...config, deviceId: undefined }, 'missing_device_id'],
    [{ ...config, deviceId: 8241677744935186821 }, 'missing_device_id'],
    [{ ...config, deviceId: '9223372036854775808' }, 'missing_device_id']
  ];
  for (const [input, status] of cases) assert.equal((await search(input, { requestFn })).status, status);
});

test('标题不冒充正文，不凭昵称子串确认作者，不保留失真数字 ID', () => {
  const normalized = normalize({ ...item, high_quality_text: '', nickname: '舵手k神粉丝' }, '关键词', config.creators);
  assert.equal(normalized.textSource, 'title-only');
  assert.equal(normalized.matchedCreator, null);
  assert.equal(normalize({ ...item, item_id: 7471252140422401337 }, '关键词', []), null);
  assert.equal(normalize({ title: 'missing id' }, '关键词', []), null);
  assert.equal(normalize({ item_id: '1' }, '关键词', []), null);
  assert.equal(normalize(null, '关键词', []), null);
});

test('令牌获取失败不执行搜索，异常中回显的密钥会被隐藏', async () => {
  let calls = 0;
  const result = await search({ ...config, clientKey: 'test-key', clientSecret: 'private-test-value' }, { requestFn: async () => {
    calls++;
    throw new Error('private-test-value');
  } });
  assert.equal(calls, 1);
  assert.equal(result.status, 'failed');
  assert.doesNotMatch(JSON.stringify(result), /private-test-value/);
});

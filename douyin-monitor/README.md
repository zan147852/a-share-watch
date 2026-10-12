# 抖音股票观点模块

这个模块运行在 GitHub Actions 或本地 Node.js 22 中。它只做抖音公开视频搜索、去重、观点整理、候选评分和日报生成，不下单，也不改变现有 A 股筛选规则。`data/douyin-records.json` 会随日报提交到仓库，用于跨次运行去重；其中只保存公开作品信息。

## GitHub 云端运行

在仓库 `Settings → Secrets and variables → Actions` 中添加：

- `DOUYIN_CLIENT_KEY` 和 `DOUYIN_CLIENT_SECRET`：获批应用的密钥，每轮自动获取两小时有效的应用令牌；
- `DOUYIN_DEVICE_ID`：官方搜索接口必填设备 ID，按平台指导提供，以字符串保存；
- `DOUYIN_ACCESS_TOKEN`：可选，仅临时调试，填写 `client_token` 接口返回的令牌；
- `PUSHPLUS_TOKEN`：可选，用于把日报推到个人微信；
- `PUSHPLUS_TOPIC`：可选，用于 PushPlus 多人或多设备转发。

未配置应用凭证或必填设备 ID 时，工作流仍会生成状态报告，但没有真实采集结果。详情见 [个人申请限制、申请材料和接入说明](../docs/douyin-application.md)。个人目前支持的小程序不等同于获得移动/网站应用的视频搜索能力，免费资格、额度和使用场景需要平台确认。

先在 Actions 运行“抖音接口接入检查（手动）”，检查只查询一次，不推微信、不保存日报。视频搜索使用 `sort_type=2`（最新发布），请求头传令牌，正文取平台的 `high_quality_text`；缺正文会保留 `title-only` 标记，不表示已经看完整个视频。

## 本地运行

```powershell
node douyin-monitor/cli.js check
node douyin-monitor/cli.js run
node douyin-monitor/cli.js report --skip-collect
node douyin-monitor/cli.js import --file data/share.json
```

手动导入文件格式是 JSON 数组，例如：

```json
[{"author":"舵手k神","title":"...","text":"...","url":"https://v.douyin.com/...","publishedAt":"2026-10-11T12:00:00+08:00"}]
```

## 微信说明

Codex 不能直接绑定个人微信。免费可行路径是先在 PushPlus 完成微信绑定，再把 token 放入 GitHub Actions Secret；日报由 GitHub 云端发送到 PushPlus，再到你的微信。企业微信机器人支持群聊推送，配置方式不同。

## 评分口径

分数用于安排人工核验顺序：明确股票或题材、方向、周期、触发/失效条件、近期性和多作者交叉会增加分数。70 分以上进入观察候选，50—69 分待核实。分数不是收益概率，不产生买入指令。

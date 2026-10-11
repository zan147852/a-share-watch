# 抖音股票观点模块

这个模块运行在 GitHub Actions 或本地 Node.js 22 中。它只做抖音公开视频搜索、去重、观点整理、候选评分和日报生成，不下单，也不改变现有 A 股筛选规则。`data/douyin-records.json` 会随日报提交到仓库，用于跨次运行去重；其中只保存公开作品信息。

## GitHub 云端运行

在仓库 `Settings → Secrets and variables → Actions` 中添加：

- `DOUYIN_ACCESS_TOKEN`：抖音官方视频搜索接口令牌；
- `PUSHPLUS_TOKEN`：可选，用于把日报推到个人微信；
- `PUSHPLUS_TOPIC`：可选，用于 PushPlus 多人或多设备转发。

没有 `DOUYIN_ACCESS_TOKEN` 时，工作流仍会生成日报，但只会报告“未配置令牌”，不会伪造采集结果。

## 本地运行

```powershell
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

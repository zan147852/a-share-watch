# 抖音接口申请材料与接入步骤

核对日期：2026-10-12（北京时间）。用户主体：个人，尚未完成开发者认证。

## 目前的申请结论

**尚未提交申请，也没有获得接口权限。个人身份不能被直接当作可申请网站应用的资格。**

官方《入驻开发者平台》写明“当前个人身份主体支持创建小程序”，其入驻类型表给个人列出的应用是“小玩法/小游戏/小程序”；企业一栏包含移动应用和网站应用。本项目所用《抖音视频搜索》文档在“移动/网站应用”目录。由此只能确认当前网站应用路径存在主体限制，不能推断个人小程序也有这个搜索权限。

先在控制台确认个人可申请的能力，或通过官方咨询入口确认下述问题。不要为了申请把个人填写为企业，也不要先付费认证、购买接口或注册企业。公开文档没有承诺这项能力向个人免费开放。

## 可复制的资格咨询材料

> 我是尚未认证的个人开发者，项目名称为“A股收盘观察”。项目按用户配置的作者昵称及 A 股研究关键词查询抖音公开视频，记录标题、作者昵称、发布时间、链接和平台返回的文本，生成供本人复盘使用的研究日报，并计划经 PushPlus 推送到本人微信。现有项目代码、采集记录和日报保存于公开 GitHub 仓库，日报也发布到 GitHub Pages；如能力条款限制存储、公开展示或第三方转发，将按要求调整。观点仅作为待核验的研究线索，系统不下单。
>
> 希望使用 `GET /dy_open_api/v1/search/video/`，Scope 为 `aweme.dy.video_search`，权限名称为“抖音视频垂搜（对外）”。初期配置 6 位作者昵称和 5 个关键词，每个最多 3 页，即每个运行日最多 33 次搜索，另获取一次应用令牌；个人手动检查会额外查询一次。
>
> 请确认：①个人主体是否可申请此能力，若可以应选择哪类应用；②是否支持个人研究日报的定时查询，是否要求用户实时输入关键词；③是否有免费额度、具体频控和存储期限；④`device_id` 在 GitHub Actions 后台任务场景应如何合法取得和填写；⑤是否允许保存平台返回文本、公开日报及个人微信转发；⑥GitHub Pages 项目页能否满足网站、域名或其他审核要求，是否需要其他资质。

资格咨询材料已经准备好，尚未发送给平台。

## 平台确认符合资格后使用的应用信息草稿

| 字段 | 拟填写内容 |
| --- | --- |
| 应用名称 | A股收盘观察（以平台名称审核为准） |
| 主体类型 | 个人；不填企业或他人主体 |
| 应用类型 | 由平台确认；当前不能假设可创建网站应用 |
| 项目页面 | https://zan147852.github.io/a-share-watch/ |
| 项目代码 | https://github.com/zan147852/a-share-watch |
| 简介 | 整理用户指定的抖音公开市场观点，保留来源与发布时间，用于个人复盘和研究线索核验。 |
| 申请能力 | 抖音视频垂搜（对外）：`aweme.dy.video_search` |
| 更新频率 | 工作日收盘后每日一次；首次只做一次查询验收 |
| 数据用途 | 公开作品资料与平台返回文本的去重、规则提取、研究日报和个人微信推送；存储与展示服从平台授权范围 |
| 费用要求 | 仅免费能力和免费额度；如不支持则停止此申请路径 |

## 用户本人需要完成的步骤

1. 打开 [开放平台控制台](https://developer.open-douyin.com/console)，本人扫码或使用平台提供的登录方式。身份证、银行卡、验证码和密钥不要发进聊天。
2. 先确认个人路径和搜索能力资格；平台明确允许后，再在“账号中心 → 身份与角色”等当前页面入口据实填写认证资料。认证本身不等于获得搜索权限。
3. 根据平台确认的应用类型创建应用，提交真实场景，申请相应能力。即使有 Client Key，也必须确认该应用获批 `aweme.dy.video_search`。
4. 把获批应用的密钥直接存到 [仓库 Secrets](https://github.com/zan147852/a-share-watch/settings/secrets/actions)，不要提交到代码。设备 ID 依平台指导配置，不照抄文档示例或随意生成。

## GitHub Secrets

| 名称 | 用途 |
| --- | --- |
| `DOUYIN_CLIENT_KEY` | 获批应用的 Client Key |
| `DOUYIN_CLIENT_SECRET` | 同一应用的 Client Secret |
| `DOUYIN_DEVICE_ID` | 搜索接口必填设备 ID，按平台接入要求提供，保存为十进制字符串 |
| `DOUYIN_ACCESS_TOKEN` | 可选，仅临时调试；实际应为 `client_token` 接口返回的 `access_token`，不是抖音登录 Cookie |
| `PUSHPLUS_TOKEN` | 微信推送可选，需在 PushPlus 本人绑定 |

应用密钥优先于临时令牌：每轮从 `POST /oauth/client_token/` 获取令牌，只用于这一轮查询。官方说明有效期为两小时，重复获取会使旧令牌失效，因此不应把临时令牌当作长期配置；测试和正式任务也不要共用同一应用密钥并发取令牌。仓库中的手动检查与日报使用同一并发组。

## 首次验收

配置完成后，在 Actions 运行 [抖音接口接入检查（手动）](https://github.com/zan147852/a-share-watch/actions/workflows/douyin-check.yml)。它只获取令牌和查询一页一条，不写日报、不推微信、不改变仓库内容。失败会标红并给出缺少配置、权限或额度等错误。

`status=complete` 只说明该次查询成功；`count=0` 不能证明已获取新观点。取得真实样本后还需核对作者身份、发布时间和 `high_quality_text` 是否包含所需内容。关键词搜索不保证六位作者的完整作品覆盖；仅有标题时不能当作完整视频总结。

本地等效命令：`node douyin-monitor/cli.js check`。凭证齐全且权限审核通过后，才有条件验证真实采集。自动化代码测试使用模拟响应，不代表平台授权成功。

如果个人无法取得权限，当前零接口费用的可用方式是导入本人整理的标题/摘录/分享链接，再生成日报；仅导入链接不会自动转写视频。全自动免费采集在取得可用数据源之前仍未打通。

## 官方依据

- [入驻开发者平台：主体和可创建应用](https://developer.open-douyin.com/docs/resource/zh-CN/developer/join/join-into-developer-platform)
- [创建移动应用和网站应用](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/app-mgmt/create-mobile-and-web-app)
- [抖音视频搜索：权限、设备 ID、请求头与字段](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/douyin-search-capability/aweme-dy-video-search)
- [生成 client_token：密钥、两小时有效期和更新限制](https://developer.open-douyin.com/docs/resource/zh-CN/dop/develop/openapi/account-permission/client-token)

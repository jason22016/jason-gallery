# 紧凑读取修复：真实 Free 验收记录

**进行中，尚未通过 Free 验收。** 旧失败基线见 `ADMIN_LIVE_ACCEPTANCE_2026-09-11.md`；本记录不替换该证据。

## 固定环境

- Workers 控制台 `Free → Current plan` 已再次确认；未修改套餐或 Access。
- 原 Worker version：`db3d67de-d21d-4586-800a-c98439dcf7a4`，100% 流量。
- 实现提交：`72c4a8cb12ffd279314043a271f97fb1f9d25e82`；测试环境隔离修复：`379e348cabc50b0734a991162deca71abe32efe8`。
- 已校验待部署 bundle SHA-256：`a1fe208320beae7e806f3cfa8cf4f4dbab05666e19b1e433112dadcb5314088c`。
- GitHub Actions 仓库与 environment 变量页面没有自动发布变量；工作流默认 false。Worker `PUBLISH_ENABLED=false`。
- 包清单 `sourceDirty=true` 包含用户原有的未跟踪失败报告，不能据此声称全部工作树文件都属于修复提交；代码改动已提交。

## 迁移

- [第一次 sync #11](https://github.com/jason22016/jason-gallery/actions/runs/34514065647) 在自动化回归阶段失败，未进入照片处理或上传。测试子进程继承手动运行的 `EXPECTED_WEBSITE_COMMIT`，干扰其自建快照的错误断言。
- 测试现明确设置自己的 expected head、photo inputs 和输出路径，并断言旧 HEAD 仍被拒绝。在注入真实 dispatch 参数的本地环境中，21 项自动化测试通过。
- [重试 sync #12](https://github.com/jason22016/jason-gallery/actions/runs/34514770308) 使用修复提交，完整回归、真实照片处理和 STORE 上传验证均已成功。
- 已部署受控验收版本 `55499f66-4428-458a-ae26-8a96f74c3ca3`。真实 STORE 上传验证通过；同期另有已完成任务，state 实际选中 `34514781400`，后续性能记录以实际 run 为准。

## 验收记录边界

`.cache/admin-compact-live/environment.json` 固定版本和迁移身份。`tail-sanitized.jsonl` 仅保留平台 CPU、wall、状态、路由、版本、异常名称和白名单应用计数，不保存请求头、Cookie、凭据或签名下载 URL。平台终止而未完成应用日志时，应用计数缺失，不能视为零。

40 个临时 draft 已由准备提交写入仓库，每个引用 DSC 0129 和 DSC 0160 对应的 canonical ID。此准备提交不计入实际 `/api/save` 成功次数；测试内容仍待完整验收结束后清理。

正式目标：154 张照片＋40 个 Project，至少 100 次业务有效 state、全部缩略图、20 次受控成功保存，覆盖 12/40 并发预览；CPU 每个样本 ≤10 ms、逐路由 P95 ≤8 ms，无 exceededCpu/1102，子请求 ≤50。任何一项缺失或失败都不能记为通过。

## 第一次新版边缘测量：仍未达到 Free

40 个受控 draft 已由准备提交 `5b34359c8bb69979eb68cc0c58f98db8250be9b2` 写入。最初独立探针落在旧版本（CPU 166 ms），不计入新版结果。新版本随后五次 state 的业务断言通过，平台 CPU 为 53/31/35/29/27 ms；上游请求均为 12、Cache 操作均为 0。第六次服务端请求为 23 ms，但页面已在读取阶段关闭，其业务断言没有捕获。没有进行实际保存。

此版本明确未达标，已停止后续负载，继续缩减实际响应处理。五次已捕获业务读取的浏览器 fetch 完成时间为 11.630/15.258/11.461/11.163/10.496 秒，不称为首屏渲染延迟。对应记录见 `.cache/admin-compact-live/first-attempt.json` 与脱敏 tail。

## 第二次短测：合并流分片仍未达标

版本 `e5261e30-c9ad-4e2f-ab2b-bcaa3c6be953` 缩小最新 completed run 的 API 响应，并使用 workerd 原生 `readAtLeast` 合并分片。真实 state CPU 为 47/25/31 ms，三次业务校验均为 154 张照片、40 个受控 Project、HEAD `5b34359c8bb69979eb68cc0c58f98db8250be9b2`、run `34514781400`。对应请求 ID 为 `2a7d57cb-c19d-42df-be2b-369bed042621`、`1983127e-8a10-46d4-aad3-a7de2d75efc0`、`f1462e16-f7f6-4a50-8707-a890380a35ee`。第四次在页面关闭后完成，平台 CPU 27 ms，没有业务断言。仍为 12 次上游请求、0 次 Cache 操作。尚未进入实际保存阶段。

下一轮将使用 CI 在完整上传验证后封存的目录及绝对预览范围，减少请求链长度；本地真实规模 workerd 已通过，state 上游请求从 12 降至 8。该本地结果不是 Free CPU 验收通过证明。

## 第三次短测：封存目录与原子保存版本仍未通过

- [sync #14](https://github.com/jason22016/jason-gallery/actions/runs/34518459620) 在 `144eaeca047bcb703a5b4220bade9ecc12101120` 复用 #12 的相同照片快照，完整回归、照片验证、STORE 上传和封存验证均成功；未发布公共网站。
- 新产物：execution-summary `10168810449`（85,727 字节）；admin-read `10168809103`（34,549,246 字节）；photos `10168807124`。执行摘要 SHA-256 为 `8db6a5598c38cab6993694d57676842edc29d55b3754a124ceef49d99176f98e`。
- Worker version `4261fd30-1e98-446d-9918-ff4cff5fc983`，内容 HEAD `26a76f8818ff1fc94b2a4e0b5e499ff7c1ddd7e2`。九次业务有效 state 均读取全部 154 张照片及 40 个 Project，CPU 为 **34/20/22/19/17/16/16/16/17 ms**，每次 8 个上游请求、0 次 Cache 操作。浏览器 fetch 完成时间 3.704–4.217 秒。
- 第十次在页面关闭后完成，CPU 15 ms，没有捕获业务断言。只读阶段停止，没有真实 `/api/save`。
- 一次独立单图探针返回 HTTP 200、CPU 10 ms、7 个上游请求。尚无完整 JPEG 字节/尺寸断言和并发覆盖，不能计为预览验收通过。

逐请求脱敏记录：`.cache/admin-compact-live/third-attempt.json`。此版本仍为 **Free 验收不通过**。

## 待部署的进一步内容读取优化

固定 commit 的 GraphQL 内容读取已完成 34 项后台回归和真实规模 workerd 检查，保持全部 Project blob SHA-1、文件大小、普通文件模式、处理器嵌套目录和缺失响应校验。正式包本地 state 为 7 个上游请求、Project 保存为 8 个，Cache 操作仍为 0。此改动尚未部署，没有该版本的真实 Free CPU 数据。


## 缩略图稳定性修复：本地通过，待部署授权

新缩略图使用 state 签发的逐图读取证明，Access 验证后只查当前产物元数据、下载单图范围并核对 SHA-256；避免每图重复读取目录/摘要。页面下载最多 4 个并发，同 URL 共享，暂时网络及 502/503/504 错误只自动重试一次，401 和完整性错误可见且不自动重试。诊断增加错误阶段及上游状态；不倒推原有 502/401 的具体原因。

本地证据：
- `pnpm test:admin`：38/38 通过，日志 `.cache/admin-compact-live/thumbnail-all-regression.log`。
- `pnpm check` 和 `pnpm admin:verify-package` 通过。
- 正式 workerd bundle 对全部 154 张真实 JPEG 分别以 12/40 并发完成精确字节与 Content-Type 校验，共 308 次；每图 4 个上游请求。另有逐路由新 isolate 功能验证和 Cache API 零调用检查。结果 `.cache/admin-compact-thumbnail/results.json`，日志 `.cache/admin-compact-live/profile-thumbnail-all154.log`。
- 浏览器回归把 154 张图片同时放入可视范围，最大下载并发 4；一次临时 502 自动重试成功，401 与非图片 200 各只尝试一次，手动恢复后 154 张均解码成功；40 个相同封面共用一次请求。

上述结果均为本地测试，不能替代真实 Free CPU。修复尚未推送/部署，生产版本仍为 `4261fd30-1e98-446d-9918-ff4cff5fc983`，其 state CPU 不通过的记录保持有效。生产部署明确授权待回复，因此新版线上 154 张预览、计费 CPU 与真实保存验收尚未执行。40 个先前创建的受控 draft 仍在仓库中，待后续验收及清理。


## 保存路径进一步修复：本地通过，真实样本仍待取得

新保存复用签名绑定确切 HEAD 的编辑快照，仍校验全部 Project 引用与当前产物有效性，以 GitHub 原子 expectedHeadOid 防止并发覆盖。最新 43 项后台、46 项 Project 回归通过；154 张真实照片 / 40 Project 的正式 workerd 本地重放中，DSC 0129/0160 的 20 次连续保存及精确回读全部通过，每次 4 个上游请求，0 次 Cache API。客户端还拒绝没有新 HEAD 的 HTTP 200 保存响应。

详见 [保存修复记录](ADMIN_SAVE_FIX_2026-09-11.md)。这些不是线上保存成功样本；新版仍待生产部署授权和真实 CPU 验收，Free 状态没有改为通过。待部署包已去掉临时验收页面；当前线上部署尚未因此更新。

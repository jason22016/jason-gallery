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
- [重试 sync #12](https://github.com/jason22016/jason-gallery/actions/runs/34514770308) 使用修复提交，远端完整回归已通过（4m24s）；正在进行真实照片处理及 STORE 上传验证。
- 已部署受控验收版本 `55499f66-4428-458a-ae26-8a96f74c3ca3`。真实 STORE 上传验证通过；同期另有已完成任务，state 实际选中 `34514781400`，后续性能记录以实际 run 为准。

## 验收记录边界

`.cache/admin-compact-live/environment.json` 固定版本和迁移身份。`tail-sanitized.jsonl` 仅保留平台 CPU、wall、状态、路由、版本、异常名称和白名单应用计数，不保存请求头、Cookie、凭据或签名下载 URL。平台终止而未完成应用日志时，应用计数缺失，不能视为零。

已在本地准备 40 个临时 draft，每个引用 DSC 0129 和 DSC 0160 对应的 canonical ID。尚未写入仓库；正式验收将区分夹具准备提交与实际 `/api/save` 成功提交。测试结束后删除全部临时文件。

正式目标：154 张照片＋40 个 Project，至少 100 次业务有效 state、全部缩略图、20 次受控成功保存，覆盖 12/40 并发预览；CPU 每个样本 ≤10 ms、逐路由 P95 ≤8 ms，无 exceededCpu/1102，子请求 ≤50。任何一项缺失或失败都不能记为通过。

## 第一次新版边缘测量：仍未达到 Free

40 个受控 draft 已由准备提交 `5b34359c8bb69979eb68cc0c58f98db8250be9b2` 写入。最初独立探针落在旧版本（CPU 166 ms），不计入新版结果。新版本随后五次 state 的业务断言通过，平台 CPU 为 53/31/35/29/27 ms；上游请求均为 12、Cache 操作均为 0。第六次服务端请求为 23 ms，但页面已在读取阶段关闭，其业务断言没有捕获。没有进行实际保存。

此版本明确未达标，已停止后续负载，继续缩减实际响应处理。五次已捕获业务读取的浏览器 fetch 完成时间为 11.630/15.258/11.461/11.163/10.496 秒，不称为首屏渲染延迟。对应记录见 `.cache/admin-compact-live/first-attempt.json` 与脱敏 tail。

## 第二次短测：合并流分片仍未达标

版本 `e5261e30-c9ad-4e2f-ab2b-bcaa3c6be953` 缩小最新 completed run 的 API 响应，并使用 workerd 原生 `readAtLeast` 合并分片。真实 state CPU 为 47/25/31 ms，三次业务校验均为 154 张照片、40 个受控 Project、HEAD `5b34359c8bb69979eb68cc0c58f98db8250be9b2`、run `34514781400`。对应请求 ID 为 `2a7d57cb-c19d-42df-be2b-369bed042621`、`1983127e-8a10-46d4-aad3-a7de2d75efc0`、`f1462e16-f7f6-4a50-8707-a890380a35ee`。第四次在页面关闭后完成，平台 CPU 27 ms，没有业务断言。仍为 12 次上游请求、0 次 Cache 操作。尚未进入实际保存阶段。

下一轮将使用 CI 在完整上传验证后封存的目录及绝对预览范围，减少请求链长度；本地真实规模 workerd 已通过，state 上游请求从 12 降至 8。该本地结果不是 Free CPU 验收通过证明。

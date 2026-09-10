# 后台紧凑读取产物与 Free 修复进度

2026-09-11。**实现及本地验证进行中；尚未完成新版 CI 迁移、Worker 部署和真实 Free 验收。** 旧部署的 1102 / exceededCpu 失败基线仍然有效，不能用本地结果覆盖。验收目标是 154 张照片＋40 个 Project，另有双源同原生 ID 的隔离回归；500 个 Project 是安全上限，不是 Free 性能承诺。

## 产物与信任链

`Gallery automation` 完整 `verifyCollection` 成功、原 `photos` artifact 上传后，执行 `scripts/admin/read-artifact.ts generate`。生成目录和预览只从共享 verifier 的完整结果构造，逐张验证 JPEG 原字节，保留所有 canonical ID、legacy aliases、来源、标题、尺寸及顺序。

`admin-read` 仅含 `catalog.json` 和 `previews.bin`。后者按目录顺序拼接已验证的 JPEG，不重新编码；目录记录每张的 offset/length/SHA-256。目录自身绑定仓库、run/attempt、当前网站 commit、原照片 artifact ID/version、原 producer commit、来源 snapshot 和处理器输入摘要。当前真实数据的目录约 79 KB，预览原字节约 34.5 MB。

上传使用锁定的 upload-artifact Action 和 `compression-level: 0`。随后 `verify-upload` 读取真实远端元数据，验证 STORE 结构和目录摘要；完整下载后的 ZIP 摘要必须等于 GitHub artifact digest，两个文件须与本地已验证输出逐字节相同，且各预览摘要再次通过。只有此阶段成功，执行摘要中的 `adminRead.status` 才成为 `success`，并封存新 artifact ID/digest 和目录摘要。

Worker 从受信任的本站 main automation run 读取执行摘要，先用 GitHub 元数据验证整个小摘要包的 digest，再检查 run/attempt/head。目录必须与摘要封存的身份及 hash 相符；原照片和新读取 artifact 都必须仍存在且未过期。自带 checksum 的任意清单不构成真实性证明。完整照片 artifact 仍用于 CI 构建和发布，Worker 不下载它来恢复缓存。

## 请求路径和边界

- state：当前 HEAD/tree → 配置与 Project blobs → 执行摘要 → 紧凑目录；返回全部照片。处理器摘要与当前 tree 比较，不读取 producer tree。
- Project 保存/publish：沿用上述轻量目录，检查全部 draft/published 的引用、canonical 重复及封面归属。保留 expectedHead、单父提交、非强制 ref 更新和 workflow 最终新鲜度检查。
- 缩略图：指定 run → 摘要和目录 → 单张 JPEG 范围及 SHA-256；不调用 `content()`，不读取原 collection 或 EXIF。当前配置/处理器变化由 state、保存与发布检查；预览按其指定的仍有效快照读取。
- 来源保存：复用已验证内容及原字节大小；最多 50 个 Git blob 一次 GraphQL 查询，逐项检查 OID、SHA-1、字节数、普通文件模式和完整返回。
- 请求内去重可用；生产路径不调用 Cache API，也不重新序列化派生缓存。正式 bundle 的回归断言排除 zip.js、`readCollection` 和 `projectUnifiedIndex`。
- STORE reader 只接受约定文件名和目录项数量，核对本地头、中央目录、offset、length、206/Content-Range 和实际字节数；拒绝压缩、ZIP64、加密及越界。摘要包最多 512 KB，单项读取最多 8 MiB，新包单次传输最多 16 MiB，ZIP 最多 1 GiB。容量限制不等于 Free 支持规模。
- 旧压缩摘要明确提示兼容性，并保留 Actions 链接。缺少新版后台产物需要首次迁移同步；缓存失效不需要同步。

## 错误反馈与观测

客户端将 1102 HTML、其他非 JSON 响应和连接中断转换为明确错误。保存响应未确认时保留草稿/选择，不自动重试，不断言远端未写入。暂时读取失败不会伪装成来源或处理器过期；对应页面提供“重试读取”。

`admin-request` 结构化日志记录规范化路由、请求 ID、HTTP 状态、外部请求数、静态资源 binding 调用数和 wall time，不记录身份、凭据、原始 URL 或负载。CPU 和 invocation outcome 来自 Cloudflare；应用 wall time 不是 CPU。被平台终止而没有应用完成日志的请求，其操作计数为缺失，不能记为零。Cache API 零调用另由正式 bundle 运行时包装计数验证。Wrangler 开启 invocation 观测，供受控验收关联。

## 已有本地证据及限制

- 后台完整回归首轮 27 项通过：`.cache/admin-compact-regression.log`，包括正式浏览器错误反馈、编辑保护和 workerd 并发预览。随后补充的 STORE 结构与排序兼容回归见 `.cache/admin-compact-contract.log`。
- 正式观测 bundle 的 154 照片重放：`.cache/admin-compact-final-real/results.json`。所有请求均无 Cache API；包含 12/40 并发预览，业务断言通过。state、Project 保存、publish 的外部请求分别为 12/17/13，40 Project 使用同样请求数。缩略图为 11。
- 这组为本地 V8 采样，不能宣称 Free 达标。state 首个样本 24.838 ms，重复样本 7.656–10.927 ms；40 Project 保存为 10.886–22.368 ms。所有 12 种操作另通过独立新实例功能检查，不能把这些功能检查称为 CPU 证据。观测版之后仅修正预算拒绝时不计入未发出的第 49 次请求。
- 先前 `.cache/admin-compact-real/` 夹具每次重算大包摘要、重新生成带时间戳的 ZIP，影响采样并导致并发摘要不一致，不能作为优化结论。修正版对不可变字节和摘要提前生成并固定；未删除旧失败证据。
- 仓库完整回归日志：`.cache/admin-compact-full-regression.log`；进程退出码 0。其后 Azure 显式 Range 变更通过针对性契约/后台回归和正式 bundle 重放。

## 迁移与真实验收待办

先验证完整代码、构建和部署包，再在现有配置下运行一次新版 sync。确认 `adminRead.status=success` 和 STORE 包验证成功后切换管理 Worker，保留发布开关。使用受控 draft 测试内容，结束后清理。

真实 Free 需固定并记录 Worker version、Git HEAD、照片 artifact 和数据规模，覆盖至少 100 次 state、全部 154 张缩略图和 20 次受控成功保存，以及 12/40 并发预览。回读 GitHub 确认保存，并核对完整搜索、跨源选择、冲突和过期处理。平台 CPU 每个样本须不超过 10 ms，逐路由 P95 目标不超过 8 ms，无 exceededCpu/1102，所有业务断言通过，子请求总量不超过 50。还需记录首屏和保存延迟。

新浏览器页面不证明新 isolate；本地新实例检查和真实新版本首批请求分别记录。任何门槛未通过，状态保持 Free 验收不通过，继续定位剩余开销。

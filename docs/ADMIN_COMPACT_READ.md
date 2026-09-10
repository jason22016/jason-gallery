# 后台紧凑读取产物与 Free 修复进度

2026-09-11。**新版 CI 迁移及前几轮部署已完成，但真实 Free 验收仍不通过；最新缩略图修复尚未部署。** 旧部署的 1102 / exceededCpu 失败基线仍然有效，不能用本地结果覆盖。验收目标是 154 张照片＋40 个 Project，另有双源同原生 ID 的隔离回归；500 个 Project 是安全上限，不是 Free 性能承诺。

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

### CI 封存目录与预览位置

真实 Free 短测中，第一版紧凑读取仍超过 CPU 门槛。因此上传验证现在把原样 `catalog.json` 字符串、实际 ZIP 大小及 `previews.bin` 的绝对字节位置一并写入执行摘要（`sealedCatalogVersion: 1`）。该位置来自完整下载、GitHub SHA-256 验证及 STORE 结构校验后的实际字节；不能由上传前猜测偏移替代。

Worker 先验证执行摘要的 GitHub artifact 摘要，再核对封存记录与当前产物元数据、原照片产物及任务身份。state 无需再次下载预览包；缩略图只下载封存位置对应的一段，验证 Content-Range、长度和单图 SHA-256。来源配置、处理器摘要与 Project 引用检查不变。旧紧凑产物仍按原有有界 STORE 读取路径验证，无 ZIP 解压回退。封存后的摘要受 512 KB 上限约束；CI 超限即失败。

保存使用 GitHub `createCommitOnBranch`，将 `expectedHeadOid`、目标 main 和允许路径的文件内容提交为一次原子变更。它保留旧 HEAD 检查和提交竞态保护，省去额外的 Git tree、commit、ref 往返。GraphQL 只返回部分结果、异常或未确认的新 OID 时，不报告成功、不重试写入；明确的 stale-head 错误显示冲突。参见 [GitHub 提交 API](https://docs.github.com/en/graphql/reference/commits) 与 [文件变更格式](https://docs.github.com/en/graphql/reference/git)。


### 缩略图稳定性修复（待线上验收）

state 完成可信目录校验后，为每张照片生成 HMAC-SHA256 读取证明，绑定管理站点、仓库、run、照片 ID、两个 artifact ID、读取包 digest/大小、绝对范围、单图 hash 和产物到期时间。使用现有服务端密钥并加专用域标识，不引入存储；证明不包含该密钥或 GitHub 签名下载 URL。每个缩略图请求仍先验证 Access 和管理员身份；随后验证证明、重新读取 GitHub 产物元数据确认仍有效，再下载指定范围并核对 SHA-256。无需重复读取全部照片目录、摘要或 Project。旧无证明 URL 保留原校验路径。证明是指定快照的读取授权，不代替 state/保存/发布的新鲜度检查。

客户端只为可视范围附近的图片排队，下载并发上限 4；同 URL 的在途下载和已挂载图片共享结果，最后一个使用者卸载后释放 Blob URL。无 Cache API 或持久缓存依赖。网络错误及 502/503/504 最多自动重试一次，带随机短延迟；401/403/410/422 和非 JPEG 响应不自动重试。失败可见并提供手动重试，401 提示重新登录；失败响应 HTML 不作为图片或页面内容展示。

错误日志和响应增加 `errorCode`、`errorStage`、`upstreamStatus`，结合 `X-Admin-Request-Id` 区分 GitHub、下载、Range、截断和 hash 失败。日志不记录证明参数或上游签名 URL；原有 502 和单次 401 仍没有足够证据可追溯定因。

38 项后台回归通过，覆盖 154 图片排队、重试、认证失败、错误响应、40 个重复封面共享、证明篡改与跨照片/run/origin 重放、产物删除/过期以及错误阶段。正式 bundle 新 isolate 功能验证通过：state 7 次、缩略图 4 次上游请求，Cache API 0 次。真实照片重放和平台 CPU 必须分别记录；这些本地结果不代表已消除线上 1102。


### 保存复用已验证的编辑快照

新版 state 还签发绑定确切 HEAD 的 `saveProof`，在浏览器内随下一次 Project 保存提交。保存仍检查全部 draft/published 引用、最新完成任务和产物有效性；GitHub 的原子 expectedHeadOid 检查确保配置、处理器或其他内容的任何修改都会造成冲突。这样可省去保存请求内的内容和摘要/目录重读。每次成功返回新 HEAD 的证明，失败不推进客户端版本；无证明请求保留完整校验路径。具体信任边界、测试与尚缺的真实成功保存证据见 [保存修复记录](ADMIN_SAVE_FIX_2026-09-11.md)。

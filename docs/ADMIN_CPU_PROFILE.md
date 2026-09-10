# Phase 7 后台免费方案优化评估（2026-09-10）

> 2026-09-11 更新：原部署已实际复现 Free CPU 超限。新版改为 CI 封存紧凑产物、Worker 无 Cache API 读取；实现与本地回归正在验证，迁移及真实 Free 验收尚未完成。当前状态和新版契约见 [ADMIN_COMPACT_READ.md](ADMIN_COMPACT_READ.md)。下文旧路径与旧测量保留为历史基线。

**完成本轮优化与本地回归，仍未通过 Cloudflare Free 上线验收。** 154 照片 / 40 Project 的读取、保存、发布触发在本地冷重放中，外部请求加 Cache API 调用分别为 41 / 45 / 40；原来的 71 次外部调用问题已消除。热 CPU 明显降低，但冷照片相关操作仍约 46–75 ms（本地 V8 采样）。即使双源 2 照片 fixture，冷请求也明显高于 10 ms 参考线，不能推荐直接以 Free 上线。

**2026-09-11 部署准备补充**：[Cloudflare Cache API 文档](https://developers.cloudflare.com/workers/runtime-apis/cache/) 明确注明 Access 前置 Worker 目前不能使用 Cache API。本报告的本地 warm 命中由 workerd 模拟，不能视为 Access 线上可用路径；实际部署必须按持续 miss / no-op 重新验证，而不只是首次冷请求。用户选择默认 workers.dev 域名，服务端 Access 验证保持不变；改为自定义域名也不能据此推断此限制消失。最小调整建议中的紧凑 CI 产物必须使无持久缓存的每次请求足够轻，而非依赖 cache 才达到 Free。后续真实测量仍未进行。

没有购买套餐、生产部署、正式摄影 Project、数据库、另一套认证或常驻服务器。本轮仅优化 Phase 7 后台，不进入 Phase 8。

## 方法、基线与证据

- Node 24.19.0，锁定 Wrangler 4.130.0 / Miniflare 5.20260908.0-alpha / workerd；`wrangler deploy --dry-run` 生成正式 bundle。本地 workerd 运行正式 RS256 JWT 签名、issuer/AUD/邮箱/时效校验以及所有 API 校验。仅 Access/GitHub/下载存储由 fixture 接管，保存与 dispatch 不访问真实写接口。
- CPU 比较基线是本轮开始的 `7c812b4`，包含此前编辑保护和 workerd 修复。基线与优化版在同一机器、相同输入下串行重放，每路由清空 Cache API 后 1 次冷请求，再执行 5 次热请求。热值取中位数；这不是 P95 或统计容量承诺。认证拒绝探针在采样前运行，因此冷指数据缓存全空，并非每条请求都新建 isolate。
- 输入 A：现有 154 张照片的完整本地产物，经共享 verifier 校验后原字节重放（一个真实来源）。输入 B：双来源、同原生 ID 的隔离 fixture（2 照片）。两组均另加 40 个不同 Project，覆盖读取、保存与发布；不把这两组宣称为“154 照片且 50 来源”测试。
- Inspector Profiler 的采样间隔为 100 μs，累计非 `(idle)` 样本的 timeDeltas；墙钟单独记录。原生 crypto/压缩、调度和调试器归因存在误差，**不是 Cloudflare 计费 CPU**。CPU 与 UI 采样在完整回归结束后独立运行。
- 外部调用由隔离上游计数。另一次独立重放在测试包装层用请求内 AsyncLocalStorage 统计原生 Cache `match/put/delete`，仅包装同一 bundle 的默认入口；生产代码与 CPU 采样不带计数器。包含 Cache API 的总数是本地操作预算，不是线上计费遥测。
- [官方限制](https://developers.cloudflare.com/workers/platform/limits/)：Free 每请求 10 ms CPU、50 次子请求、每天 100,000 次请求；Cache API 操作共享子请求额度。上一轮仅报 fetch 次数不足以判断 Free，本轮补齐此项。

完整脱敏样本、bundle SHA-256、墙钟、逐请求 CPU 与预算见 [admin-cpu-profile-results.json](admin-cpu-profile-results.json)。本地原始 profile 位于 `.cache/admin-free-{before,final}-{small,real}/`。全回归日志 `.cache/phase7-free-regression-final.log`。真实 GitHub GraphQL 仅只读验证了当前 main 配置 blob 的 OID/字节数/SHA-1；没有据此认定正式 Worker Secret 或其 fine-grained PAT 已配置。

## 定位与实现

原有热 profile 包含 `readCollection`、`projectUnifiedIndex`、hash、`structuredClone`、`freezeDeep` 与 GC；40 Project 的成本还包含逐 blob 的 JSON/网络读取。冷 profile 主要仍是 ZIP 目录、解压流、完整 metadata/index 校验和初始化。

1. **完整轻量目录缓存**：完整共享 verifier 通过后，缓存来源/snapshot、producer/version、canonical/legacy 引用、UI 必要字段和缩略图摘要。热操作不再读取、解析、投影全部原生 EXIF 数据，照片到来源的映射也改为线性 Map，去掉逐张 `find`。仍一次返回完整照片库，搜索和跨来源选择范围不变。
2. **不可变内容批次**：先读当前 main HEAD/tree，再以固定 Git blob OID 每批 25 个进行 GraphQL 查询。逐项检查普通文件模式、OID、字节数、Git blob SHA-1、schema 与总量；拒绝 errors、null、binary、truncated、漏项及内容不匹配。缓存键包含全部路径/OID，Project 新增、删除或改变任意文件都会换键。使用同一个网站 PAT。[GitHub Blob 字段](https://docs.github.com/en/graphql/reference/git)、[GraphQL 认证](https://docs.github.com/en/graphql/guides/forming-calls-with-graphql)。
3. **只做所需的引用校验**：共享 `validateProjectReferences` 验证全部 draft/published 的唯一性、引用存在、canonical 重复和封面归属；调用前仍严格 schema 校验。保存/发布不构造页面用的完整 Project/photo 副本，也不重复写入预览凭据。
4. **减少冷 ZIP 小请求和缓存操作**：按 64 KiB 窗口在请求内合并 header/data 读取，跨请求只保留 ZIP 尾部目录和解压文件。正文窗口不与解压文件重复缓存。范围、总读取量、解压量、CRC 和取出文件的 sealed hash 限制保留。
5. **并发预览兼容性**：真实浏览器 fan-out 发现旧版 zip.js inline codec 的全局队列在 workerd 中跨请求解析 Promise，出现警告及未完成预览。禁用该 inline 等待队列（不创建 Web Workers），让各解压任务留在所属请求；没有串行加载、减少展示或关闭 workerd 保护。增加全冷 12 个并发缩略图及生产 UI → 正式 workerd 回归。

缓存只是认证之后的可丢弃优化。派生记录校验和绑定仓库、键、到期时间和内容，TTL 不超过 1 小时/产物期限。丢失、过期、损坏的派生记录或缓存服务不可用，自动回源重建，不要求用户反复 sync。当前任务/产物存续、摘要、来源配置、processor tree 每次仍检查；HEAD 和所有写请求不缓存。原产物过期、配置/处理器变化或完整性失败不能用旧缓存接受数据。expected head、单父提交、非强制 ref 更新以及 workflow 最终网站/照片 HEAD 新鲜度检查保持不变。

## 154 张照片的 CPU 对比

单位 ms，均为本地 V8 采样；“前 → 后”，热值为五次中位数。冷值每场景只有一次，不据此承诺稳定改善。

| 请求 | 冷 CPU 前 → 后 | 热 CPU 前 → 后 |
| --- | ---: | ---: |
| 认证静态资源 | 4.6 → 4.8 | 1.9 → 2.4 |
| 照片库 | 93.6 → 75.4 | 18.0 → 9.7 |
| 单张缩略图 | 85.5 → 57.0 | 3.5 → 3.0 |
| 来源影响 | 4.9 → 5.6 | 3.7 → 3.5 |
| 来源保存 | 6.5 → 11.3 | 6.1 → 6.5 |
| Project 保存 | 88.5 → 55.2 | 21.3 → 8.7 |
| sync 触发 | 4.5 → 5.8 | 3.8 → 4.0 |
| publish 触发 | 76.2 → 57.7 | 17.2 → 6.2 |
| 任务列表 | 15.3 → 11.4 | 3.3 → 2.6 |
| 照片库，40 Project | 87.7 → 46.1 | 35.0 → 9.2 |
| 保存，40 Project | 99.8 → 55.5 | 30.5 → 9.3 |
| publish，40 Project | 110.0 → 52.3 | 33.1 → 6.7 |

双源小 fixture 的热照片库 / Project 保存 / publish 为 5.9 / 8.5 / 4.9 ms，冷为 50.3 / 30.8 / 22.6 ms。新增内容缓存对小来源保存增加一次冷读写，不能声称所有场景 CPU 都下降；近 10 ms 的热路径也缺少可靠余量。

## 请求预算

以下每格均为“冷 / 热”。总数包含 fetch 与 Cache API，不包含浏览器自身向 Worker 发出的独立请求；每个缩略图单独经过认证。

| 请求（154 照片） | 外部调用：前 | 外部调用：后 | fetch + Cache：前 | fetch + Cache：后 |
| --- | ---: | ---: | ---: | ---: |
| 照片库 | 31 / 8 | 17 / 7 | 84 / 14 | 40 / 11 |
| 缩略图 | 35 / 1 | 18 / 1 | 101 / 3 | 44 / 3 |
| Project 保存 | 36 / 13 | 22 / 12 | 89 / 19 | 44 / 15 |
| publish | 31 / 8 | 17 / 7 | 84 / 14 | 39 / 10 |
| 照片库，40 Project | 71 / 48 | 18 / 7 | 124 / 54 | 41 / 11 |
| 保存，40 Project | 76 / 53 | 23 / 12 | 129 / 59 | 45 / 15 |
| publish，40 Project | 71 / 48 | 18 / 7 | 124 / 54 | 40 / 10 |

双源 40 Project 的三条主要操作总预算也为冷 41 / 45 / 40。这里没有真实网络重试、更多来源、更大 ZIP 目录或更大 Project 文件；50 来源 / 500 Project 是安全/schema 容量上限，不能据此外推为 Free 支持规模。

## 用户体验

生产管理 JS/CSS 未改变。浏览器使用完整状态响应，经正式 Worker 读取真实 154 照片、40 Project；测量页面进入到可交互、视口内预览解码、真实鼠标 click 到下一帧，以及点击保存到成功提示。测试还断言搜索可达末尾照片、来源切换保留选择、排序和标题在保存后保留。原有未保存保护浏览器回归继续通过。

旧 bundle 在并发预览下无法完整完成首屏验收。为得到可比较的 UI 耗时，**UI 基线只补相同的 inline codec 队列兼容性修复后重新正式打包**，没有照片/Project/缓存优化；CPU 表仍用原始可顺序运行的 `7c812b4` bundle。UI 原始样本与基线说明在结果 JSON，不能把修复后的基线假称为旧版正常运行结果。

每组一次冷页面和三次热页面，单位 ms；热值为中位数。保存是在照片库已加载后进行，冷列不等于“直接冷调用保存 API”。

| 154 照片 / 40 Project | 冷页面：前 → 后 | 热页面：前 → 后 |
| --- | ---: | ---: |
| 首屏可交互 | 239.4 → 235.7 | 135.6 → 101.2 |
| 视口预览完成解码 | 1373.0 → 1179.1 | 288.1 → 281.9 |
| 真实点击 → 下一帧 | 36.4 → 29.6 | 43.7 → 42.2 |
| 保存 → 可见成功提示 | 104.4 → 114.0 | 125.7 → 69.8 |

双源小 fixture 的热首屏为 86.8 → 71.4 ms，热选图 34.2 → 32.0 ms，热保存 123.8 → 111.7 ms。不过本轮有一次优化版首个点击 → 帧采样达到 583.6 ms（该组旧版冷样本 33.0 ms）；前端 bundle 未改且响应字段集合一致，尚不能据此归因或排除冷浏览器调度/绘制异常。保留所有样本，不声称每个冷操作都更快；真实设备首个交互仍需复测。

这些是本机软件渲染浏览器和 fixture 上游的少量样本，GitHub/网络延迟未模拟，保存计时包含 Playwright 操作与可见确认；不能当作线上延迟或所有设备帧率保证。没有通过分页、减少搜索范围、清空选择或降级验证交换性能。

## 当前适用规模与下一步最小调整

- **已验证的功能规模**：154 张真实来源照片 + 40 Project，以及双源同名/同原生 ID fixture + 40 Project；冷热路径、缓存自动重建、保存与发布触发可正确运行。该范围的采样中，fetch + Cache 预算不超过 45。
- **可以保证的 Free 正式运行规模：目前没有。** 冷 ZIP/完整 metadata 校验即使在 2 张照片下也明显偏重；154 张热读取/保存接近 10 ms 且有样本波动。减少 Project 请求数解决了一个硬限制，没有解决冷 CPU 的全部问题。继续购买 Paid 不是本报告默认方案。
- **下一步最小架构调整建议（尚未实施）**：由现有完整 CI verifier 生成一个独立、紧凑的后台读取产物，包含完整搜索/引用目录、预览 ZIP 索引及与原 collection/config/producer 绑定的摘要证据。Worker 冷请求读取这个小产物并验证来源与证据，具体取出的文件仍核对摘要，保存仍检查所有 draft/published。这样能移出冷请求中的大 ZIP 目录/全部 EXIF 解析，保留 GitHub + Access、自动缓存恢复和完整交互。必须先设计并回归“派生目录恰好等于完整 verifier 结果”的封存契约，不能仅信任一份手写清单；也不能预先保证此调整足以达到 Free。
- 若上述调整或进一步拆分仍必须延后全库搜索、清空编辑状态、明显等待或手动同步，需先向用户说明取舍；本轮未实施这些体验降级。

获得上线授权后，仍需在真实 **Free** 管理域名验证 Access OTP、未登录/非管理员拒绝、真实 PAT 的 GraphQL/REST 权限、GitHub 保存冲突和 sync/publish、产物删除/保留期、冷新实例/缓存淘汰、并发缩略图及网络错误。记录 Cloudflare 实际 `cpuTime`、1102/exceededCpu、子请求/Cache 调用、P50/P95 首屏与保存耗时、请求量。使用受控测试内容，不能创建正式摄影 Project 替代验收。此次没有部署、购买或生产操作，`PUBLISH_ENABLED=false` 保持不变。

## 复现

```sh
pnpm admin:build
pnpm exec wrangler deploy --dry-run --config admin/wrangler.jsonc --outdir .cache/admin-profile-worker
node --import tsx tests/admin/profile.ts
# 已有 154 照片完整本地产物时，只读重放
node --import tsx tests/admin/profile.ts admin/.cache/admin-profile-worker/worker.js .cache/admin-profile-real .cache/photo-engine/output
node --import tsx tests/admin/ui-profile.ts admin/.cache/admin-profile-worker/worker.js .cache/admin-ui-profile-real.json .cache/photo-engine/output
pnpm test
```

`pnpm test:admin` 中的 workerd smoke 同时执行 12 个全冷并发预览与真实管理 UI 流程，CI 不以毫秒数作为性能通过条件。双源 fixture 还对 fetch + Cache 的 50 次预算设置回归断言。真实 Free 验收仍是独立的未完成步骤。

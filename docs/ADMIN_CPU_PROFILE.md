# 后台免费额度评估（2026-09-10）

**优先尝试 Workers Free；当前未通过免费部署验收，且本地结果显示仍有明显超额风险。** 已移除 `cpu_ms: 30000` 的 Paid 假设，默认服从账户套餐限额；这不会把代码自动优化到 10 ms。没有购买套餐、部署测试 Worker 或启用生产发布。继续沿用独立 Worker + Access 邮箱 OTP，不引入另一套认证、数据库、图片代理或常驻服务器。

[官方限制](https://developers.cloudflare.com/workers/platform/limits/)为 Free 每请求 10 ms CPU、50 次外部子请求、每天 100,000 次请求。网络等待不计 CPU；本地响应耗时不能用作 CPU。原有 50 来源 / 500 Project 是 schema/安全容量上限，**不是 Free 可运行容量保证**。

## 测量方法与范围

使用锁文件内 Wrangler 4.130.0 / workerd（Miniflare 5.20260908.0-alpha），Node 24.19.0、当前 macOS 本机。`wrangler deploy --dry-run` 编译正式 Worker，Miniflare 接管全部出站请求为隔离 fixture。每次请求经过正式 RS256 JWT 验签、管理员名单、GitHub/产物/schema/引用校验；不会访问真实 GitHub 或写入正式 Project，publish 仅断言返回 pending。

使用 [官方本地 CPU 调试方法](https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/)的 V8 Inspector Profiler，采样间隔 100 μs。累计非 `(idle)` 样本的 `timeDeltas`，同时独立记录墙钟耗时和出站请求次数。**这是本地 V8 采样，不是 Cloudflare 计费 CPU**：原生 crypto/压缩可能未被完整归因，调试器/调度也带来误差，不能把单次小于 10 ms 当作 Free 通过。

两组输入：可重复生成的双源 2 照片 fixture；已有、经共享 verifier 校验的 154 照片真实本地产物字节重放（仅输入来自真实产物，Access/GitHub/保存/dispatch 仍是 fixture）。另加 40 个隔离 Project 测试扩展成本。每个路由清空 Cache API 后 1 次冷请求，再保留缓存执行 5 次热请求；第一条静态请求还包含首次执行开销。少量样本用于定位瓶颈，不代表线上 P95 或容量承诺。CI 只检查功能，不以这些时间值设性能断言。

完整脱敏样本：[admin-cpu-profile-results.json](admin-cpu-profile-results.json)。本地原始 `.cpuprofile` 位于 `.cache/admin-profile-{baseline,after}-{small,real}/`，未进入公开网站或 Git 产物。原始 main 在 workerd 中不能完成认证后的读取；比较基线先补上 `fetch` 接收者和 `redirect: manual` 两项兼容性修复，再测缓存优化前后。

## 结果与优化

154 照片输入；CPU 列为本地 V8 采样毫秒，热值为 5 次中位数。冷样本波动明显，不能声称冷请求得到稳定改善。

| 请求 | 热缓存：优化前 → 后 | 优化后冷请求 | 优化后外部调用：冷 / 热 |
| --- | ---: | ---: | ---: |
| authenticated-assets | 2.1 → 2.1 | 10.2 | 1 / 1 |
| state | 44.2 → 18.1 | 103.3 | 31 / 8 |
| thumbnail | 12.2 → 2.5 | 85.4 | 35 / 1 |
| source-impact | 4.2 → 4.1 | 5.2 | 4 / 4 |
| source-save | 5.6 → 4.2 | 8.4 | 9 / 9 |
| project-save | 43.1 → 22.1 | 90.3 | 36 / 13 |
| sync-dispatch | 4.1 → 3.3 | 3.5 | 5 / 5 |
| publish-dispatch | 35.7 → 18.2 | 74.0 | 31 / 8 |
| tasks | 2.1 → 3.0 | 17.8 | 12 / 2 |
| state-40-projects | 52.5 → 35.4 | 97.0 | 71 / 48 |

- 缓存按不可变 artifact ID/文件名组织的解压字节，热请求无需重新读取 ZIP 目录、下载链接或解压。仍验证当前来源、运行摘要、producer、metadata 与每张缩略图的 sealed hash；缓存损坏测试必须拒绝。缓存最多 1 小时且不超过产物期限，凭据/签名 URL/登录决策不缓存，缓存丢失回到完整验证路径。
- 同一请求内合并重复 run/artifacts/不可变 Git tree/blob 读取。`main` HEAD 与所有写入不缓存，保留保存前检查和 ref 非强制更新两个冲突窗口。
- 修复 workerd 原生 `fetch` 的接收者绑定，以及不支持 `redirect: error` 的兼容性问题；改为 manual 后继续检查 HEAD 成功/精确 206，拒绝跟随额外重定向。

双源小 fixture 的热照片库 21.0 → 7.6 ms，热 Project 保存 24.1 → 12.3 ms；154 照片的热照片库与保存仍超过 10 ms 的参考线，冷请求更重。40 Project 的冷请求仍有 71 次外部调用，超过 Free 的 50 次硬限制。**因此当前不能推荐直接以 Free 正式上线；也没有据此默认改用 Paid。**

## 复现与后续验收

```sh
pnpm admin:profile
# 已有真实本地产物时，额外重放（只读，不重新生成或上传原图）
node --import tsx tests/admin/profile.ts \
  admin/.cache/admin-profile-worker/worker.js \
  .cache/admin-profile-real .cache/photo-engine/output
pnpm test:admin
```

下一步若继续落实免费上线，需要继续拆分冷请求与 Project 读取（例如按需分页，并保持保存时的全引用校验），降低单次解析/验证成本；不能只依赖缓存命中、删掉认证/校验或把 500 Project 限额解释为 Free 支持。相关改造需要再次重放测量。

获得上线授权并配置 Cloudflare 后，在实际 **Free** 账户的受控管理域名验证真实 Access OTP、无登录与非管理员拒绝，以及照片库、缩略图、来源/Project 保存、冲突、sync/publish 状态。记录 Cloudflare 实际 `cpuTime`/超限错误（1102）、冷缓存/新实例/热缓存、代表性最大来源与 Project 数量、请求量；使用受控 fixture 内容，不替用户建立正式摄影 Project。真实 Secret/登录/部署与 CPU 数据均尚未验收，`PUBLISH_ENABLED` 继续为 false。

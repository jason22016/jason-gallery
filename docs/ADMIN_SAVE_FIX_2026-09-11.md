# Project 保存失败修复

状态：已获授权推送并部署；已取得 1 个真实保存成功样本（HTTP 200 / CPU 10 ms），但整体 Free CPU 验收仍未通过。部署后结果见 [部署记录](ADMIN_DEPLOYED_2026-09-11.md)。以下保留部署前实现与测试过程。

## 判断

用户提供的 3 次 CPU 超限 / 503 和 1 次旧 HEAD / 409 是两类失败。最新 HEAD 仍出现 CPU 超限，不能把问题归结为版本冲突；终止时的 10 ms 也不能推算完整保存只需 10 ms。Free 每请求 CPU 基准仍为 10 ms，必须用真实平台日志验收。[Cloudflare CPU 限制](https://developers.cloudflare.com/workers/platform/limits/#cpu-time)

旧保存路径重复读取配置、全部 Project、照片执行摘要及目录，再校验引用。此前优化的紧凑目录和原子提交仍未取得真实成功保存样本，因此不视为已修复。

## 当前实现

state 在验证确切 Git HEAD 的配置、处理器、全部 Project 内容和可信照片目录后，签发 `saveProof`。它仅携带保存所需的照片 ID/别名、全部 Project 引用及大小、产物身份和到期时间，使用 HMAC-SHA256 绑定站点、仓库、版本及内容。不会包含密钥、认证决定或下载 URL，不使用 Cache API 或新持久存储。

保存请求先经过 Access、管理员和同源 JSON 检查，再验证证明与 expectedHead，校验新 Project 的 schema、全部保留 Project 的引用、别名重复、封面归属、ID/slug 唯一性、不可改 slug、数量与大小上限。每次向 GitHub 确认最新已完成任务及产物身份、有效期；不重复下载和解析摘要/目录。配置和处理器在签发时已经验证，任何之后的仓库变更都会改变 HEAD。

最后使用 GitHub `createCommitOnBranch(expectedHeadOid)` 原子提交：证明绑定的 HEAD 必须仍为 main，任何内容、配置或处理器变更以及并发写入都会冲突，不能覆盖。成功后返回新 HEAD 和绑定新内容的证明，支持连续保存。旧无证明请求及超过 256 KB 的证明仍采用完整校验路径，未承诺其 Free CPU 达标。[GitHub 原子提交](https://docs.github.com/en/graphql/reference/commits)

网络中断、非成功 HTTP、无法完整解析或仅部分成功的 mutation 响应都显示 `save_unconfirmed`，不自动重试。被 Cloudflare 终止的响应由客户端显示资源超限及保存结果尚未确认；草稿、照片顺序和选择保持。收到 GitHub 明确成功响应之前不签发新 HEAD 的证明。

## 验收范围

隔离回归已覆盖 20 次连续保存并逐次回读实际夹具内容、40 个 draft/published Project、两写竞争、旧 HEAD、变化的处理器 HEAD、任务替换/重试、产物删除/过期/替换、证明篡改与跨站重放、失效引用和别名重复。还注入“GitHub 已完成写入，连接随后断开”，确认服务端报告未确认且只提交一次。此处的成功均为本地夹具，不能记作真实保存成功。

真实验证仅使用用户明确批准的 `[TEST] 后台验收 2026-09-11`，slug `admin-acceptance-20260911`，保持 draft，引用 DSC 0129 和 DSC 0160。部署后通过真实后台保存，回读 GitHub 的新 HEAD 与文件内容，并用请求 ID 关联 Cloudflare CPU/outcome。没有线上回读和 CPU 证据时，结论保持“尚未完成线上验收”。


## 最终本地验证结果

- `pnpm check` 通过；`pnpm test:projects` 46/46 通过；`pnpm test:admin` 43/43 通过，日志 `.cache/admin-compact-live/save-all-regression.log`。
- 正式部署包完整性验证通过；临时验收页面已从待部署源码移除。当前线上旧版本未因此改变。
- `.cache/admin-compact-save/results.json`：154 张已验证真实照片、40 个 Project，保存照片固定为 DSC 0129/0160。正式 workerd 中 20 次连续保存均返回新的 HEAD，逐次回读精确匹配，Project 数量一直为 40；每次保存 4 个上游请求。新 isolate 的签名保存功能检查也通过。
- 同一正式包的 Cache API 运行时计数为 0；全部 154 张 JPEG 在 12/40 并发下分别通过精确字节校验。正式 UI 与 Worker 的联合测试在保存后回读标题和照片顺序；冲突、1102、断网保留编辑，不自动重试。
- 客户端不会把任意 HTTP 200 当作保存成功：必须返回 `status=saved` 和有效、不同于旧值的新 HEAD，否则显示保存结果尚未确认。

本地 workerd/V8 采样不等于 Cloudflare 计费 CPU。生产保存成功样本仍未新增，不能将本地 20 次成功算入真实验收。用户已批准的测试 Project 无需再次申请对象授权；剩余审批只涉及把修复部署到现有管理 Worker。此前自动审批拒绝生产部署的理由是当时可见授权仅涵盖计划，本次已明确询问部署授权，尚待回复。

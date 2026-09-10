# 管理 Worker 部署与短测记录

**推送和部署成功；真实保存首次成功，整体 Free CPU 验收仍不通过。**

## 部署身份

- 用户明确授权：将更新推送 main，部署管理 Worker。
- 修复提交：`64a3cfcf1270e8025343838d7a4cc83dab67ef5d`，已非强制推送到 main。
- Worker：`jason-gallery-admin`，版本 `2c25689b-f108-4b1a-84f0-08c16e52762a`，Cloudflare deployments status 确认 100% 流量。
- 正式 bundle SHA-256：`78055c13acde50406920f1ebd8152923ecfcd722ae2a51e958bfd9e44d2bf4b1`。
- 管理入口：[jason-gallery-admin](https://jason-gallery-admin.jiasheng22016.workers.dev)。Access、套餐和 `PUBLISH_ENABLED=false` 保持原配置；未发布公共网站。临时验收页面已从此次部署包移除。
- 部署前 43 项后台、46 项 Project 回归与正式包完整性校验通过。原有未跟踪失败报告没有混入修复提交。

## 真实保存

通过正常管理 UI 保存批准对象 `[TEST] 后台验收 2026-09-11`，slug `admin-acceptance-20260911`，状态 draft，顺序 DSC 0129 → DSC 0160，封面 DSC 0129。

页面显示提交成功及新 HEAD；随后直接 fetch GitHub main 并读取该提交下的 JSON，断言标题、slug、draft、两张 canonical 引用和封面全部匹配。保存提交：`4b496146db6339156be68d988554d1194432ca89`。该 draft 保留在仓库中。

唯一保存请求 `0273dabe-0a41-45e0-a9ed-453fc8d861b2`：HTTP 200、outcome ok、CPU **10 ms**、wall 2076 ms、上游请求 4、Cache API 计数 0。没有通过直接 GitHub 写文件代替后台保存。保存前 40 个受控 Project，保存后为 41 个。

这是 1 个真实成功样本，不能替代 20 次成功保存与逐路由 P95 验收，也不能证明 CPU 有稳定余量。

## 照片和 CPU

管理页读出 154 张照片；按正常视口逐屏滚动触发懒加载，最终 DOM **154/154 图片完成解码，失败 0**。没有放大视口或绕过客户端的 4 并发队列；没有手动重试。

本观察窗含搜索、选图、编辑与返回照片页，总缩略图请求 175 个（包括重新挂载和自动重试）：171 个 200、4 个 502；CPU 最大 10 ms、P95 7 ms，未出现 exceededCpu。502 的应用错误为 `storage_body` / `preview_download`，约 15.7 秒时响应体下载中断。新日志将本次错误定位到下载阶段；不能据此倒推旧失败窗口的原因，或断言具体网络/存储根因已经修复。最终可见图片由有限自动重试恢复。

首个 `/api/state` 为 HTTP 200、outcome ok，但 CPU **42 ms**，上游 7、Cache API 0。因此读取仍超过 Free 10 ms 基准，**整体验收不通过**；不能用保存成功或图片最终恢复掩盖这一项。没有宣称浏览器新页面等于新 isolate。

原始脱敏证据：`.cache/admin-compact-live/deploy-approved-tail.jsonl`；摘要：`deploy-approved-results.json`。只保留路由、版本、CPU、wall、状态、请求 ID 和白名单错误阶段，不保存身份凭据、Cookie、证明参数或签名下载 URL。tail 已停止。

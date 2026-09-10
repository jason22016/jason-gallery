# Phase 7 — 轻量后台（视觉确认阶段）

2026-09-10。独立分支 `codex/phase7-admin`，基于最新 main `bc54046`。**当前仅完成方案记录、automation 前置修复与 fixture UI，Phase 7 尚未完成正式接口验收。** 按用户要求，视觉确认后再全面接入管理接口。Polish、SEO 与性能优化顺延 Phase 8。

- 唯一方案：独立 Cloudflare Worker + Cloudflare Access 管理员邮箱 OTP；公开网站继续 Pages。每个管理 API 校验 JWT 与邮箱白名单，凭据只在服务端。决策、边界及上线配置见 [实施记录](docs/PHASE7_PLAN.md)。本阶段尚未实现正式认证或管理 API。
- 查看了 Afilmory 精确 commit 的实际后台布局、导航、照片网格、来源表单、同步进度与结果源码；核对 ANL 许可。只参考交互与布局，自写 React/CSS，不复制其应用代码或引入其业务架构。
- fixture 预览：照片源筛选/搜索、跨源选图、Project 新建编辑、封面/顺序、draft/published、来源新增编辑/启停、引用影响、空/过期/失败产物、任务排队与执行状态。暗色/浅色与移动布局。全部写操作仅保存在页面内存，无模拟登录、真实远端保存或部署。
- 正式照片 schema、Project schema 不变；把来源纯 schema 从 Node 文件抽离以供浏览器复用，原 `sources.ts` 继续导出相同接口。正式 Project 目录保持空白。
- 合并后的 [Gallery automation 34449154936](https://github.com/jason22016/jason-gallery/actions/runs/34449154936) 回归通过、resolve 失败，旧错误吞掉 HTTP 原因。实际仓库仍 public；修复元信息请求复用只读 token、严格拒绝 private、保留 HTTP/额度诊断。不能从旧日志断言历史请求必然限流。修复未合并，main automation 尚未成功重跑。

## 验证

本机使用固定 Node 24.19.0 / pnpm 11.19.0，完整 `pnpm test` 退出码 0：strict、Project 46/46、Engine/network smoke、Viewer/Color 5/5、Website 27/27、automation 4/4、后台 4/4、真实 metadata 1/1 与正式 Astro build；零失败、零跳过。`git diff --check` 通过。新增测试覆盖公开源鉴别与 HTTP 错误、跨源选图、Project schema、来源 schema/失效引用拦截、产物状态、排队不等于发布、390px 布局、键盘关闭对话框、无外部写请求及浏览器 bundle 不引入服务端凭据/Node 模块。

本地证据：`.cache/phase7-full-test.log`、`.cache/phase7-real-resolve.json`。修复后的真实公开源解析成功，仍为 `6a7ae47d75dd71bc6874e8d3f222f25b2c05e27f`；未进行全库重新同步。桌面与 390px 手机预览已检查。GitHub 分支检查结果在交付消息中报告。

真实管理员登录、未登录 API 拒绝、服务端保存冲突、真实 Actions dispatch/产物读取、正式发布状态均留待视觉确认后的实现与测试。Cloudflare 未配置，无真实上线 URL，无生产部署。fixture 测试不作为这些项目的正式验收。

## 查看预览

`pnpm admin:preview`：使用已有本地缩略图，虚构来源分组和示例 Project，仅在 `.cache/admin-fixture` 与内存；照片缩略图不提交 Git。`pnpm admin:fixture`：无需真实图库的确定性测试图。打开 `http://127.0.0.1:4325/`。`pnpm test:admin` 构建独立 fixture 并运行浏览器检查。预览代码位于 `tests/admin/`，不进入 Astro 路由或公开 dist。

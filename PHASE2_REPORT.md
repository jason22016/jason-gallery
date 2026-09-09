# Phase 2 — Project System

**实现完成，完整自动测试通过。** 2026-09-09；测试使用锁定的 Node 24.19.0 / pnpm 11.19.0。

## 实现

- `src/projects/schema.ts`：Zod 4.5.4 严格契约，覆盖 `schemaVersion`、`id`、`slug`、`title`、`summary`、`description`、`location`、`coverPhotoId`、`photos`、`tags`、`period`、`order`、`status`。拒绝未知字段和类型强制转换；校验真实公历日期、起止区间、非空照片、项目内重复引用和封面归属。
- `resolver.ts`：全部 published/draft 项目共同检查唯一 ID/slug；通过 Phase 1 `getPhoto` 解析每个引用，悬空引用直接失败。同一照片可属于多个项目，保留项目内照片顺序与局部 caption/alt。`cover`、照片元数据仅为内存派生值。
- `loader.ts`：读取 `src/content/projects/<slug>.json`，强制文件名与 slug 一致；错误包含文件来源，schema/引用错误包含字段路径。目录缺失、非法 JSON、非 JSON 文件或嵌套目录均失败；空目录合法。
- 公开入口 `src/projects/index.ts` 的 `loadProjects()` 返回 published 索引，提供 `listProjects()`、`getProject(id)`、`getProjectBySlug(slug)`；草稿对三种查询均不可见。编辑/构建工具可显式从 `loader.ts` 使用 `loadProjectCatalog()` 的 `published` / `drafts` 分离索引。
- 两种索引均按 `order` 升序、slug ASCII 字典序稳定排序；集合及嵌套 Project/照片值均为 TypeScript readonly 且运行时深度冻结，与输入数据隔离。
- `integration.ts` 接入 `astro:build:start`，无 Project 页面时仍严格校验全部内容，包括 draft；不生成额外公开数据或路由。
- 已同步 `ARCHITECTURE.md` 中的校验细节和接口约定；Zod 加为精确版本直接依赖，lockfile 未升级其他依赖。

## 测试结果

执行 `pnpm test`，退出码 **0**：

| 检查 | 结果 |
| --- | --- |
| TypeScript strict + readonly 编译期反例 | 通过 |
| Project 自动测试 | **46 / 46 通过，无跳过** |
| 真实 Astro 构建集成测试 | 有效 fixture 构建成功；悬空引用的 draft、schema 非法的 draft 均使构建失败 |
| Phase 1 网络/Engine smoke | 通过，包括 HDR fixture、缩略图复用、ID 碰撞、失败保护 |
| Viewer bundle / worker 隔离检查 | 通过 |
| 本站 Astro build | 通过，0 published / 0 draft，仅原有 `/health.txt` 探针 |

Project 用例覆盖正常完整/最小契约、全部要求的非法引用与重复约束、非法日期及闰年边界、草稿过滤、跨项目共享照片、稳定排序、深度只读、文件加载错误与 Photo Index 原有 ID 冲突保护。所有内容 fixture 位于测试代码或临时目录，测试后清理。

完整日志：`.cache/phase2-full-test.log`（本地产物，不提交）；独立复现：`pnpm test:projects`。

## 保持不变与已知限制

- Photo Engine、上游 Afilmory packages、Manifest schema 和 `PHASE1_REPORT.md` 无修改。真实 Manifest SHA-256 仍为 `c342c50d25c39f301d4a9c00a1b8824ba706717ab6bb5946f25bd5425e3187d6`，与 Phase 1 一致。
- 正式 Project 目录只有 `.gitkeep`，没有代建摄影内容；因此本阶段以 fixture 验证非空 Project，不声称完成正式内容验收。
- 查询是 Node 构建/渲染期快照；文件修改后需重新加载或重新构建，不提供内容热更新监听、持久化解析缓存或浏览器端 loader。
- 没有开发首页、Project 页面、Gallery、Map、正式 Viewer UI、部署或后端；本次未重跑真实图库下载及浏览器 HDR 设备测试，Phase 1 已记录的相关限制继续适用。

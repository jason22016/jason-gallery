# 照片库同步与只读预览

在「照片 → 同步照片」中勾选已启用的来源。预览只读取已保存的配置、可信同步目录和固定 Git 版本的文件清单；不调用同步工作流，不写 Project、照片源、缩略图或网站。

新增、更新、移除和未变化均为所选来源的文件差异。按来源身份和相对路径匹配，以 blob SHA 及 Live Photo 配套视频变化判断更新；重命名计为移除加新增。预览不解码图片，实际同步仍校验原图可访问性、完整产物及所有 Project 引用。

## 接口

- `GET /api/sync-preview?sourceId=...&sourceId=...`：返回比较版本、检查时间、各源统计、文件列表、引用冲突、基线可用性和是否允许正式同步。沿用 Access 身份验证与 `Cache-Control: no-store`。
- `POST /api/dispatch` 的 `mode: sync` 支持 `sourceIds` 与 `previewRevision`；实际触发前重新检查。版本变化返回 `409 preview_changed` 和新预览，用户再次点击才触发。
- 未提供 `sourceIds` 的旧调用仍全量同步。Project 保存与网站发布接口语义不变。

## 实际同步

工作流新增 `source_ids`、`sync_baseline_run_id`、`sync_first_run` 输入。所选来源处理最新固定版本，未选来源复制已验证基线中的原有产物；完整合并与引用校验通过后，才切换照片库。排队期间基线被其他同步替换时，部分同步失败并提示刷新预览。

未选来源配置不兼容、处理器变化或基线过期时需全量同步。历史基线不可读取时，差异数量显示无法确定；全量重建成功后也不会凭空报告全部新增。只有确实不存在历史任务时，才使用空照片库基线。

本改动更新了照片处理器指纹，上线后需要先完成一次全量同步再使用部分来源复用。后台与 Actions 工作流必须一同更新。同步不提交 Project，也不发布网站。

## 验证

- `pnpm check`
- `pnpm test:admin`：接口只读、Access 鉴权、版本变化、引用冲突、失败后保留目录、桌面/移动布局、同步刷新失败提示以及 Project 草稿回归。
- `pnpm test:automation`：差异算法、来源选择、完整快照、部分同步复用、空来源、引用保护及既有自动化。
- `pnpm test:smoke`：只读网络边界与照片处理缓存、缩略图及失败保护。

本地 UI 截图使用隔离测试数据：`.cache/sync-panel-desktop.png`、`.cache/sync-panel-mobile.png`。发布时需验证 Cloudflare 后台版本，并确认新版工作流成功生成完整照片库后再验收线上预览。

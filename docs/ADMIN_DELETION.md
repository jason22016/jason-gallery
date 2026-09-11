# 删除照片源和 Project

- 在已保存 Project 的编辑页点击“删除 Project”，核对名称后确认。取消或失败时保留编辑；成功后移除编排记录并返回 Project 列表。未保存的新 Project 使用原有“放弃当前修改”。
- 在照片源列表点击“删除来源”。弹窗先检查所有草稿和已设为发布的 Project，列出阻止删除的引用。先删除这些 Project，或移除、迁移照片引用，再删除来源。有未保存的 Project 编辑时，先保存或明确放弃编辑。
- 两种删除都保留照片仓库和原图。删除已发布 Project 后，公开网站要到下一次成功发布才更新。删除照片源后需重新同步目录。
- 允许删除最后一个 Project 和最后一个照片源，之后可以重新连接仓库、创建 Project。

`POST /api/delete` 接受 `expectedHead` 和单个目标：`{kind: "project", projectId}` 或 `{kind: "source", sourceId}`。接口沿用 Access 登录、同源 JSON 校验和请求大小限制。Project 路径由服务端当前内容解析，不接受客户端提供的文件路径。GitHub 的 `expectedHeadOid` 在提交时再次检查并发修改；不强制覆盖、不自动重试。提交继续使用 `[skip ci]`，不会自动同步或发布。

删除不依赖照片产物下载，因此产物过期时仍可清理 Project。照片源的引用检查使用仓库中的所有 Project，覆盖草稿、发布状态和旧格式照片引用。响应只有包含目标身份与新的 Git HEAD 才被界面视为成功；结果不确定时保留界面内容并提示核对仓库。

验证入口：`pnpm check`、`pnpm test:admin`。专项测试在 `tests/admin/delete.test.ts`、`tests/admin/delete-ui.test.ts` 和 `tests/admin/api-errors.test.ts`；`tests/admin/profile.ts` 通过真实本地 workerd 检查受引用来源拒删、Project 删除和解除来源连接。测试上游及照片均为隔离数据，不代表生产部署或 Free CPU 验收。

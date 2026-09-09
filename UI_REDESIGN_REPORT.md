# UI Redesign 验收记录

日期：2026-09-10。实现与数据边界见 [ARCHITECTURE.md](ARCHITECTURE.md#ui-redesign--当前-website-ui-约定2026-09-10)。

## 交付

- Light 首页：Jason Gallery 灰色字标、绿色句点、5:6 封面、响应式网格、标题与日期遮罩、触屏两次点击。
- Project：深色 48px 顶栏、4px 瀑布流、列表、列数偏好、排序、搜索筛选、项目信息、按需加载的地图。
- 灯箱：模糊背景、缩略图条、桌面 EXIF 侧栏、手机信息抽屉、滑动与拖拽、缩放与平移、分享链接及浏览器历史恢复。
- 保留静态原图链接、公开项目数据隔离、原有 GPU 回退与 HDR 状态。ThumbHash 使用 Photo Engine 原生十六进制解码。Viewer Motion 与现有引擎锁定相同上游提交，记录见 `licenses/viewer-motion-files.json`。

## 验证结果

Node 24.19.0 / Chromium 151.0.7922.34 下运行 `pnpm test`，全部通过：

| 检查 | 结果 |
| --- | --- |
| TypeScript 严格类型检查 | 通过 |
| Project System | 46 / 46 |
| Photo Engine 网络与处理 smoke | 通过 |
| Viewer 浏览器包与 worker 隔离 | 通过 |
| Website 浏览器测试 | 17 / 17 |
| Astro 静态生产构建 | 通过 |
| `git diff --check` | 通过 |

浏览器用例覆盖 390、768、1440、2048px 首页布局、手机横屏、键盘焦点、触屏滚动与两次点击、减少动态效果、筛选与灯箱顺序、单图边界、分享直达/刷新/前进后退、无 EXIF/GPS、草稿隔离、无 JavaScript 浏览、失败重试、GPU 降级及 HDR 状态。原生触摸事件验证滑动切图、上滑信息抽屉和下滑关闭；另验证原生 ThumbHash 的解码颜色。

使用真实照片对首页、桌面照片墙与灯箱、390px 信息抽屉、768px 与 2048px 照片墙做了目视检查；手机抽屉从顶部展示基本信息，页面无横向溢出。完整测试输出位于本机 `.cache/ui-redesign-final.log`。

测试以 Chromium 为准，未进行实体 HDR 显示器亮度校准或 Safari / Firefox 真机验收。MapLibre 保持独立懒加载，构建有其大于 500kB 的体积提示，不阻止构建。

## 独立预览

运行 `pnpm ui:preview`，打开 <http://127.0.0.1:4324/>。脚本使用已有照片与缩略图，在 `.cache/ui-preview/` 创建四个临时展示选集；这些选集只用于验收，不写入正式内容目录。

正式站点目前没有公开 Project，因此正式生产首页保留空状态。正式 Manifest、照片、缩略图及 Project 内容未改动，也未部署。

# 华电安规刷题 PWA

一款为 iPad 优化的华电安规离线刷题应用。打开网页后可添加到主屏幕，像普通 App 一样全屏运行；题库、错题、收藏、编辑内容与做题进度均保存在设备本地。

## 在线使用

GitHub Pages 部署完成后，可直接用 Safari 打开在线地址。首次完整加载后，应用与 270 道题会缓存在设备上，断网也能继续使用。

在 iPad 上安装：

1. 用 Safari 打开应用。
2. 点工具栏中的“共享”。
3. 选择“添加到主屏幕”。

## 功能

- 顺序、随机、指定题号与按题型练习
- 错题本、错题重刷、收藏和单题错误次数统计
- 全文搜索、章节筛选与题目手动修订
- 自动保存未完成练习，随时继续
- 适配 iPad 横屏/竖屏、安全区与触控热区
- 标准 Web App Manifest、Service Worker 和主屏幕图标
- 完全离线运行，不请求任何第三方资源

## 本地预览与测试

需要 Node.js 18+ 与 Python 3：

```bash
npm test
npm run dev
```

然后访问 `http://localhost:8080`。Service Worker 只会在 HTTPS 或 localhost 环境下启用。

## 部署

`.github/workflows/pages.yml` 会在 `main` 分支更新后自动把 `app/` 发布到 GitHub Pages。仓库的 Pages 来源应设为 **GitHub Actions**。

## 项目结构

- `app/`：PWA 界面、离线缓存、图标和内置题库
- `tests/`：题库完整性、判题逻辑和 PWA 配置检查
- `android-app/`、`native-src/`：保留的 Android 离线包工程
- `scripts/`：题库解析、嵌入与 Android 构建脚本

版本：1.3.0；题库：安规考试 8.28（270 题）。

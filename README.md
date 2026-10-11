# LevOJ 一键出答案

> 面向南信大学子：打开 LevOJ 题目页，自动抓取题面 → 调 AI → 直接给出可提交的 C++ 代码。
> Chrome / Edge 扩展（Manifest V3），无需后端，点开即用。

![version](https://img.shields.io/badge/version-1.3.1-4d6bfe)
![manifest](https://img.shields.io/badge/manifest-v3-4d6bfe)

<!-- 截图：把图片放进仓库后取消下面的注释 -->
<!-- ![悬浮窗](docs/screenshot.png) -->

## 特性

- **自动出答案** —— 进入 `/problem/{id}` 页面即自动抓题、自动请求 AI，无需任何点击。
- **只出代码** —— 不废话，直接返回一个可直接提交的完整 C++ 代码块，一键复制。
- **双通道抓题** —— 优先走 OJ 的 `/v1/problem/{id}` 接口；接口不可用时自动降级到 DOM 抓取（多组选择器 + 通用兜底）。
- **不碰页面** —— 全部 UI 挂在 Shadow DOM 里，样式与宿主页面完全隔离，不会污染 OJ 站点。
- **Key 不出本机** —— API Key 只存在浏览器扩展存储中，请求由 background service worker 代理发出。
- **429 自动退避重试** —— 命中限流时按 `Retry-After` 退避重试，并对限流/额度不足给出可读的中文提示。
- **安全开关** —— `/exam`、`/contest`、`/compete` 页面自动禁用，小球变橙色。

## 安装

1. 打开浏览器，地址栏输入 `chrome://extensions`（Edge 为 `edge://extensions`）回车。
2. 打开右上角 **开发者模式**。
3. 点左上角 **加载已解压的扩展程序**，选择本项目文件夹。
4. 工具栏出现蓝色鲸鱼图标即安装成功。

## 配置

点工具栏鲸鱼图标（或 OJ 页面悬浮窗右上角 ⚙），填写任意 OpenAI 兼容接口：

| 字段 | 示例 |
| --- | --- |
| API Base URL | `https://api.deepseek.com/v1` |
| API Key | `sk-xxxxxxxx` |
| 模型 | `deepseek-chat` |

点 **测试连接** 确认连通，再 **保存配置**。另外可勾选 **进入题目页自动出答案**（默认开启）。

> 也可填 OpenAI 官方、通义、本地中转等任意 OpenAI 兼容网关。Base URL 漏写 `/v1` 会自动补一次。

## 使用

1. 打开任意题目页，网址需包含 `/problem/数字`。
2. 右下角出现悬浮窗，自动开始出答案，等待数秒。
3. 点代码框右上角 **复制**，粘贴到提交框。

窗口挡住题面时，拖标题栏可移动，点 `—` 收成小球，点小球展开。

## 适配到别的 OJ

本项目默认绑定 LevOJ（内网 `172.16.37.108`），换站点需要改两处：

- `manifest.json` → `content_scripts[0].matches` 与 `host_permissions` 改成你的域名；
- `content.js` → `fetchProblemViaAPI()` 里的接口路径 `/v1/problem/{id}`，以及 `RESTRICTED_RE` 的禁用规则。

题目 ID 解析规则在 `parseProblemId()`，默认匹配 `/problem/(\d+)`。

## 项目结构

```
levoj-ai-helper-extension/
├── manifest.json      # MV3 清单：权限、content script 匹配、入口
├── background.js      # service worker：代理 AI 请求（绕开页面 CORS）
├── content.js         # 注入 OJ 页面：抓题、悬浮窗 UI、自动出答案
├── popup.html/js      # 工具栏设置弹窗
└── preview.html       # 纯静态 UI 预览页（不参与扩展运行）
```

**请求链路**：content script 抓题 → `chrome.runtime.sendMessage` → background 用 `fetch` 调 AI 接口 → 回传文本 → content script 渲染 Markdown。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| `未配置 API Key` | 按上方「配置」填一次 |
| `AI 接口错误 429` | 触发限流或额度不足；可关掉自动出答案、错峰重试，或更换 Key |
| `后台无响应` | 扩展刚重载，当前页 `Ctrl+Shift+R` 强制刷新 |
| 右下角没有小球 | 确认是题目页；`Ctrl+Shift+R` 刷新；检查扩展是否被停用 |
| `未抓取到题目` | 不是题目详情页或页面未加载完，刷新后从列表点进具体题目 |

## 注意事项

- **考试 / 比赛页面自动禁用**：`/exam`、`/contest`、`/compete` 下的助手不工作，这是刻意保留的限制。
- **生成的代码仅供参考**，请自行理解思路，不要直接当成作业提交。
- **图标**：悬浮窗中的鲸鱼标记为手绘图形的近似实现，**并非 DeepSeek 官方素材**，商标归其所有者所有。如需使用官方 logo，请自行替换 `content.js` 中的 `LOGO_SVG`（替换写法已写在注释里）。
- API Key 请勿提交到仓库或分享给他人。

## 开发

无构建步骤、无依赖，改完源码后在 `chrome://extensions` 点扩展的刷新按钮即可。改动 `content.js` 后需强制刷新已打开的 OJ 页面。UI 样式可先在 `preview.html` 里离线预览（与扩展共用同一份 CSS，仅将 `:host` 换成 `:root`）。

## License

MIT

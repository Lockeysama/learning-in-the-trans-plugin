# Littp

Chrome 扩展：把中英文网页变成刚够看懂的英文。生词或短语后紧跟 `（中文释义）`。点原文回到处理前页面。

## 加载

1. 打开 Chrome `chrome://extensions`
2. 打开「开发者模式」
3. 「加载已解压的扩展程序」，选本仓库里的 `extension/` 目录
4. 安装后会打开初始设置：填写 DeepSeek API Key、学历等信息，并完成约 12 句短句互译
5. 打开任意 http/https 页面，点工具栏图标里的「学习视图」，或用页面右下角 Littp 条

生成种子词表后，请打开一个 **http/https 网页** 再点「学习视图」（不要停在设置页或 `chrome://` 页）。若页面是扩展加载前就开着的，扩展会自动注入，不用手动刷新。

本地验收页：

```bash
python3 -m http.server 8767 --directory demo
```

然后打开 `http://127.0.0.1:8767/en.html` 和 `zh.html`。

## 行为约定

- 密钥只存在 `chrome.storage.local`，内容脚本不拿 Key、不直连 DeepSeek
- 熟词由打包词表 + 设置页选档决定，页面匹配用代码，不让模型决定标哪些词
- 难度只移动熟词门槛：更易中文更多，更难英文更多
- 模型失败时回原文
- 不处理导航、侧栏；只改正文
- 右下角工具条不常驻：原文状态下不显示，只有进入学习视图（或正在处理）时才出现；`×` 可临时隐藏，下次从插件按钮激活时再出现
- 判断正文时，工具类名不算侧栏/目录证据：Tailwind 这类带 `:`、`[]`、`@` 的 class（如 `toc-visible:md:grid-cols-10`）只是样式，不是页面 chrome。否则正文容器会被误判、正文被整段丢掉
- 页面加载即自动注入：`manifest.content_scripts` 声明的必须是**经典脚本**。Chrome 不认 `"type": "module"`，会把带 `import` 的文件当经典脚本执行并抛 `SyntaxError`，整个内容脚本直接不运行。所以入口是 `content/bootstrap.js`，由它 `import()` 拉 `content/content.js`。往 `content_scripts.js` 加文件时保持经典脚本语法，`npm test` 会检查

## 开发

```bash
python3 scripts/build-lexicon.py
npm test
```

真实 Chrome 的端到端验收（加载 `extension/`，打开演示页，点一次弹窗里的「学习视图」，断言页面进入学习视图、工具条按需出现/隐藏；模型调用在 service worker 里打桩，不需要 Key 和网络）：

```bash
python3 -m http.server 8767 --directory demo
node scripts/diagnose-reading-view.mjs
```

也可以直接跑线上页面（默认无头）：

```bash
node scripts/diagnose-reading-view.mjs https://example.com/some-article
HEADFUL=1 node scripts/diagnose-reading-view.mjs https://openai.com/index/some-post/   # 有反爬的站点
```

某个页面「不翻译」时，先看它到底选了哪块正文：

```bash
HEADFUL=1 node scripts/probe-page.mjs https://example.com/some-article
```


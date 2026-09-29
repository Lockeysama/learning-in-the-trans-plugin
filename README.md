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
- 「原文 / 学习视图 / 全文翻译」可在扩展弹窗和页面工具条切换。全文翻译默认英文译成中文、中文译成英文，不加生词注释；保留正文链接、强调格式与代码，每批完成就显示对应译文
- 全文译文显示后，自动二次标粗关键意群：条件/原因与动作/结果成对标注，仅允许插入 Markdown `**...**`，页面呈现为粗体。文字、标点或空白被改动、格式错误或标注失败时保留未标粗译文；标注与翻译独立缓存，清除本页缓存时一起清除
- 每个页面的全文翻译和重点标注默认各并发 5 个请求，可在设置页分别调整为 1–10，下一轮翻译生效；完整句段一旦译好就进入标注，翻译和标注并行，哪个结果先完成就先显示，不等待前面的慢请求
- 重点标注默认粗体、绿色字体、无背景色；设置页可切换粗体、选择字体与背景颜色，并实时预览。外观修改立即作用于已显示及缓存中的标注，不重新翻译或标注
- 学习视图和全文翻译的成功批次缓存在扩展本地，刷新或重新打开同一页面可复用；中途停止后，已完成批次也可复用。缓存按页面、模型、提示词及实际输入区分，最多 400 批、约 2 MB，超限淘汰最旧结果。「清除本页缓存」同时清除两种模式的页面缓存和翻译结果缓存
- 划词菜单提供「即时翻译」：默认只显示自然译文（单词显示语境释义与词性），「贴近原文」「词句解析」按需展开；固定搭配按词组解释，查询不会自动加入生词表
- 划词加入熟词或生词后只保存词表，不立即重新处理当前页面；手动刷新页面后进入学习视图，或再次点击「学习视图」时应用最新词表
- 即时翻译保留选区大小写、标点和附近上下文，支持英译中/中译英；每次最多 2000 字符。展开内容在当前选区内复用，失败可重试，Esc 或点击页面关闭
- 右下角工具条不常驻：原文状态下不显示，只有进入学习视图（或正在处理）时才出现；`×` 可临时隐藏，下次从插件按钮激活时再出现
- 判断正文时，工具类名不算侧栏/目录证据：Tailwind 这类带 `:`、`[]`、`@` 的 class（如 `toc-visible:md:grid-cols-10`）只是样式，不是页面 chrome。否则正文容器会被误判、正文被整段丢掉
- 页面加载即自动注入：`manifest.content_scripts` 声明的必须是**经典脚本**。Chrome 不认 `"type": "module"`，会把带 `import` 的文件当经典脚本执行并抛 `SyntaxError`，整个内容脚本直接不运行。所以入口是 `content/bootstrap.js`，由它 `import()` 拉 `content/content.js`。往 `content_scripts.js` 加文件时保持经典脚本语法，`npm test` 会检查

## 开发

```bash
python3 scripts/build-lexicon.py
npm test
node scripts/check-selection-translation.mjs
node scripts/check-full-translation.mjs
```

划词验收脚本会启动临时测试页和隔离的 Chrome，并在后台模拟模型响应；不需要真实 API Key。覆盖分层加载、上下文、错误重试、过期响应和菜单边界。

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

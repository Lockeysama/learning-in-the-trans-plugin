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

## 开发

```bash
python3 scripts/build-lexicon.py
npm test
```

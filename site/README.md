# 砖皮百科站点说明

## 本地预览

- 在项目根目录运行 `启动.bat`
- 访问 `http://localhost:8765/site/index.html`（新 UI 壳）
- 本地图片：`http://localhost:8765/site/index.local.html`

## 当前主流程

进入页（图鉴 | 上传）→ 选枪封面墙 → 枪种图鉴 → 皮肤详情（心得、点赞、评论、补充图、lightbox）。  
上传走进入页 → 上传选择：投稿四步 / 公开待审（接口未开放时提示）/ 密钥审核。

## 构建

- 皮肤截图放在武器目录（如 `K416/`、`MP7/`、`M250/`）
- `python scripts/validate_and_build.py --weapon <武器名>`
- 写入 `site/data.js`、`site/meta.js`、`site/covers.js`

## 投稿审核相关

- 用户投稿 API：`/api/submit`
- 审核通过 API：`/api/submissions/<id>/approve`
- 审核通过后会把图片落到武器目录并触发构建

## 焚诀（知识库）

- 进入页第二个入口「焚诀」打开 `site/wiki/index.html#kb`，是独立的一套静态页面（浅色档案风）。
- 内容源在仓库根的 `wiki/内容/`（Markdown + 图片），写法见 `wiki/补充指南.md`，样式规范见 `wiki/美学标准.md`。
- 本地预览：`python wiki/preview/build.py`，访问 `http://localhost:8765/wiki/preview/index.html`。
- 发布：`python wiki/preview/build.py --site`，把网页和压缩图写进 `site/wiki/`，再提交。
- 玩家见闻的投稿和审核页目前是「正在开发」占位；对应的 `/api/market-posts` 接口已在 `server/app.py` 里，部署并重启 API 后再把前端切过去。

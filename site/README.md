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

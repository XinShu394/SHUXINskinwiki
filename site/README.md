# 砖皮百科站点说明

## 本地预览

- 在项目根目录运行 `启动.bat`
- 访问 `http://localhost:8765/site/index.html`

## 当前主流程（已统一）

- 皮肤截图放在武器目录（如 `K416/`、`MP7/`、`M250/`）
- 运行 `python scripts/validate_and_build.py --weapon <武器名>` 更新站点数据
- 生成结果直接写入：`site/data.js`、`site/meta.js`、`site/covers.js`

## 投稿审核相关

- 用户投稿 API：`/api/submit`
- 审核通过 API：`/api/submissions/<id>/approve`
- 审核通过后会把图片落到武器目录并触发构建

## 维护目标

- 当前优先完善：`MP7`、`M7`、`M250`

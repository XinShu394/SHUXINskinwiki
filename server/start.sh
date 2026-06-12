#!/bin/bash
# 砖皮百科 · 评论服务启动脚本
# 在 ECS 上运行：bash start.sh

cd "$(dirname "$0")"

# 安装依赖（首次运行）
if [ ! -d "venv" ]; then
  echo "[初始化] 创建虚拟环境..."
  python3 -m venv venv
  source venv/bin/activate
  pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
else
  source venv/bin/activate
fi

echo "[启动] 评论 API 服务..."
# 使用 gunicorn 生产模式，4 个 worker，监听本地 5200 端口
# timeout 需要覆盖审核通过时构建脚本的最长执行时间（默认 120s）
exec gunicorn -w 4 -b 127.0.0.1:5200 --timeout 180 --access-logfile - app:app

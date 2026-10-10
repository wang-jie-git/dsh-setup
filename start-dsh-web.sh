#!/bin/bash
# DSH Web 启动脚本（统一管理环境变量）
# 视频理解 key 实际在 one_settings.json 的 vision.api_key（嵌套结构），修复 2026-08-29
VISION_KEY="$(python3 -c "import json; print(json.load(open('$HOME/.openharness/one_settings.json'))['vision']['api_key'])" 2>/dev/null)"
export AGNES_API_KEY="$VISION_KEY"
export VIDEO_LENS_API_KEY="$VISION_KEY"
export OPENHARNESS_VISION_API_KEY="$VISION_KEY"
# 记忆系统 viewer 数据路径（XDG 标准路径，2026-09-06 恢复）
export AI_MEMORY_CODEGRAPH_DIR="$HOME/.local/share/ai-memory"
# 记忆系统权限层级（prime 允许全局操作，2026-09-06 恢复）
export AI_MEMORY_TIER=prime
# 记忆系统 embedder 走本地代理（jina API 直连被网络阻断，修复 2026-09-05）
export NODE_USE_ENV_PROXY=1
export HTTPS_PROXY="http://127.0.0.1:7890"
export HTTP_PROXY="http://127.0.0.1:7890"
cd "$HOME/.dsh/profiles/web"
exec dsh web --port 3080 --no-open "$@"

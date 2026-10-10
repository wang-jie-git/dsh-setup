#!/bin/bash
# dsh 双包危害检测器（Dual Package Hazard Checker）
# 检测 profile 里 @deepseek-ai/* 核心包是否与宿主重复物理加载
# 用法: bash ~/.dsh/scripts/check-dual-package.sh
# 精确宿主：含 @deepseek-ai/dsh 的 npx 缓存目录
HOST_ROOT=""
for d in ~/.npm/_npx/*/; do
  if [ -f "$d/node_modules/@deepseek-ai/dsh/package.json" ]; then
    HOST_ROOT="${d%/}"
    break
  fi
done
PROFILE=~/.dsh/profiles/web/node_modules
if [ -z "$HOST_ROOT" ] || [ ! -d "$PROFILE/@deepseek-ai" ]; then
  echo "⚠️ 未找到宿主或 profile 路径"; exit 1
fi
echo "宿主: $HOST_ROOT"
echo "Profile: $PROFILE"
echo "--- 检查 @deepseek-ai/* 是否物理重复（应为全部 symlink/无输出） ---"
for p in "$PROFILE"/@deepseek-ai/*/; do
  name=$(basename "$p")
  if [ -e "$HOST_ROOT/@deepseek-ai/$name/package.json" ] && [ ! -L "$p" ]; then
    echo "❌ 物理副本: @deepseek-ai/$name  ->  请替换为 symlink"
  fi
done
echo "--- 检查顶层关键库 react/zod/schemastery ---"
for name in react zod schemastery cosmokit; do
  if [ -e "$PROFILE/$name/package.json" ] && [ ! -L "$PROFILE/$name" ] && [ -e "$HOST_ROOT/$name/package.json" ]; then
    echo "❌ 物理副本: $name  ->  请替换为 symlink"
  fi
done
echo "--- Symbol 唯一性实测 ---"
HOST_ROOT_ESC=$(echo "$HOST_ROOT" | sed 's/\//\\\//g')
PROFILE_ESC=$(echo "$PROFILE" | sed 's/\//\\\//g')
node -e "
const { createRequire } = require('module');
const hostReq = createRequire('$HOST_ROOT_ESC/');
const profReq = createRequire('$PROFILE_ESC/');
const h = hostReq('@deepseek-ai/dsh-tools');
const p = profReq('@deepseek-ai/dsh-tools');
console.log(h.TOOL_RUNTIME_SCHEDULER === p.TOOL_RUNTIME_SCHEDULER ? '✅ Symbol 唯一' : '❌ Symbol 分裂!');
"
echo "--- .npmrc 检查（应有 auto-install-peers=false） ---"
grep -q "auto-install-peers=false" ~/.dsh/profiles/web/.npmrc && echo "✅ auto-install-peers=false 已配置" || echo "❌ 缺少 auto-install-peers=false"

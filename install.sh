#!/usr/bin/env bash
# =============================================================
# dsh-setup 一键安装脚本
# 用途：在其他设备上安装 dsh 全套插件与配置
# 主程序不在此仓库：请先安装官方 dsh（deepseek-ai/deepseek-harness）
# 用法：bash install.sh [--dry-run] [--dsh-home ~/.dsh]
# =============================================================
set -euo pipefail

DRY_RUN=0
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --dsh-home=*) DSH_HOME="${arg#*=}" ;;
  esac
done

info()  { printf '\033[1;34m[install]\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m[warn]\033[0m %s\n' "$*"; }
die()   { printf '\033[1;31m[error]\033[0m %s\n' "$*"; exit 1; }

# ---------- 0. 前置检查 ----------
info "dsh 主程序检测…"
if ! command -v dsh >/dev/null 2>&1 && [ ! -x "$DSH_HOME/../deepseek-harness-official/apps/cli/lib/bin.js" ]; then
  warn "未检测到 dsh CLI。请先安装官方 dsh：https://github.com/deepseek-ai/deepseek-harness"
  warn "（本仓库只包含插件与配置，不包含主程序）"
fi

# ---------- 1. 目标目录准备 ----------
if [ -d "$DSH_HOME" ]; then
  if [ "$DRY_RUN" = 1 ]; then
    info "检测到已有 $DSH_HOME（dry-run 不备份）"
  else
    TS="$(date +%Y%m%d-%H%M%S)"
    info "备份现有 $DSH_HOME → $DSH_HOME.bak-$TS"
    mv "$DSH_HOME" "$DSH_HOME.bak-$TS"
  fi
fi
if [ "$DRY_RUN" = 1 ]; then
  info "[dry-run] 将创建 $DSH_HOME 并复制配置"
else
  mkdir -p "$DSH_HOME"
fi

# ---------- 2. 复制配置 ----------
info "复制 profiles / .agent-presets / skills / scripts…"
for item in profiles .agent-presets skills scripts; do
  if [ -d "$REPO_DIR/$item" ]; then
    if [ "$DRY_RUN" = 1 ]; then
      info "[dry-run] cp -a $REPO_DIR/$item → $DSH_HOME/"
    else
      cp -a "$REPO_DIR/$item" "$DSH_HOME/"
    fi
  fi
done

# ---------- 3. 环境变量模板 ----------
if [ -f "$REPO_DIR/env.tpl" ]; then
  if [ ! -f "$DSH_HOME/.env" ] && [ "$DRY_RUN" = 0 ]; then
    cp "$REPO_DIR/env.tpl" "$DSH_HOME/.env"
    warn "已生成 $DSH_HOME/.env（模板），请填入你的 API keys："
    grep -E '^[A-Z_]+=' "$REPO_DIR/env.tpl" | sed 's/=.*/=<需要填写>/'
  else
    info "[dry-run] 将生成 .env 模板（已有则跳过）"
  fi
fi

# ---------- 4. 路径适配（Mac 特定路径 → 新设备） ----------
# cordis.patch.yml 中的绝对路径需要按新设备适配
PATH_MAP=(
  "/Users/mac/Desktop/AI-memory"        "AI_MEMORY_DIR"
  "/Users/mac/.local/share/ai-memory"   "AI_MEMORY_DATA_DIR"
  "/Users/mac/Documents/ObsidianVault"  "OBSIDIAN_VAULT"
  "/Users/mac/Desktop/nexus-browser"    "NEXUS_BROWSER_DIR"
  "/Users/mac/Desktop/dsh-media-mcp"    "DSH_MEDIA_MCP_DIR"
  "/Users/mac/.npm-global/bin"          "NPM_GLOBAL_BIN"
)
PATCH="$DSH_HOME/profiles/web/cordis.patch.yml"
if [ -f "$PATCH" ]; then
  for pair in "${PATH_MAP[@]}"; do
    src="${pair%% *}"; var="${pair##* }"
    val="${!var:-}"
    if [ -n "$val" ] && [ "$val" != "$src" ]; then
      if [ "$DRY_RUN" = 1 ]; then
        info "[dry-run] sed 替换 $src → $val"
      else
        sed -i '' "s|$src|$val|g" "$PATCH" 2>/dev/null || sed -i "s|$src|$val|g" "$PATCH"
      fi
    fi
  done
  if [ "$DRY_RUN" = 0 ]; then
    warn "已按环境变量替换 cordis.patch.yml 中的 Mac 路径；未设置的路径请手动编辑 $PATCH"
  fi
fi

# ---------- 5. 安装依赖 ----------
if [ "$DRY_RUN" = 1 ]; then
  info "[dry-run] 将执行 pnpm install（在 $DSH_HOME/profiles/web）"
else
  info "安装 web profile 依赖…"
  if [ -f "$DSH_HOME/profiles/web/package.json" ]; then
    (cd "$DSH_HOME/profiles/web" && pnpm install 2>&1 | tail -5 || true)
  fi
fi

# ---------- 6. 收尾 ----------
info "完成！"
cat << 'EOF'

后续步骤：
1. 填写 $HOME/.dsh/.env 中的 API keys
2. 根据设备路径编辑 $HOME/.dsh/profiles/web/cordis.patch.yml
   （AI-memory / ObsidianVault / nexus-browser / dsh-media-mcp / wigolo 等）
3. 启动 dsh：dsh --profile web --no-open --port 3080
4. 验证：curl http://localhost:3080/api/worktable/health

注意：
- package.json 中的 @local/* link: 本地 bundles（个人形象管理/文案/宋式美学）需自行部署
- MCP 服务器（AI-memory / nexus-browser / dsh-media-mcp）需先在目标设备安装
EOF

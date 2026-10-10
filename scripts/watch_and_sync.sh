#!/bin/bash
# 实时监控文件变化并自动同步
# 使用 fswatch 监控 workspaces 目录，变化时立即同步

# 配置
WATCH_DIR="/Users/mac/Documents/ObsidianVault"
REMOTE_HOST="ziqian@192.168.1.173"
REMOTE_DIR="~/backup/obsidian-vault"
LOG_DIR="$HOME/.dsh/logs"
SYNC_SCRIPT="$HOME/.dsh/scripts/sync_bidirectional.sh"
PID_FILE="$HOME/.dsh/scripts/.watch_sync.pid"
DEBOUNCE=3  # 防抖动：3秒内多次变化只触发一次同步

# 颜色
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_DIR/watch_sync.log"
}

# 检查是否已在运行
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if ps -p "$OLD_PID" > /dev/null 2>&1; then
        echo "⚠️  监控服务已在运行 (PID: $OLD_PID)"
        echo "如需重启，请先执行: watch-stop"
        exit 1
    else
        # 清理过期的PID文件
        rm -f "$PID_FILE"
    fi
fi

log "🚀 启动实时监控同步服务"
log "📁 监控目录: $WATCH_DIR"
log "🔄 同步脚本: $SYNC_SCRIPT"
log "⏱️  防抖延迟: ${DEBOUNCE}秒"
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# 检查目录是否存在
if [ ! -d "$WATCH_DIR" ]; then
    log "❌ 监控目录不存在: $WATCH_DIR"
    exit 1
fi

if [ ! -f "$SYNC_SCRIPT" ]; then
    log "❌ 同步脚本不存在: $SYNC_SCRIPT"
    exit 1
fi

# 保存PID
echo $$ > "$PID_FILE"
log "✅ 服务已启动 (PID: $$)"

# 设置退出清理
trap 'log "🛑 监控服务已停止"; rm -f "$PID_FILE"; exit 0' INT TERM EXIT

# 记录上次同步时间
LAST_SYNC=0

# 启动监控
fswatch -r "$WATCH_DIR" \
    --event=Created \
    --event=Updated \
    --event=Removed \
    --event=MovedFrom \
    --event=MovedTo \
    --exclude='.DS_Store' \
    --exclude='\.git/' \
    --exclude='node_modules/' \
    --exclude='__pycache__/' \
    --exclude='\.watch_sync\.log' \
    --exclude='sync_log\.txt' \
    --exclude='sync_cron\.log' \
    | while read event; do

    # 获取当前时间
    CURRENT_TIME=$(date +%s)

    # 防抖动：距离上次同步不足DEBOUNCE秒则跳过
    if [ $((CURRENT_TIME - LAST_SYNC)) -lt $DEBOUNCE ]; then
        continue
    fi

    # 更新最后同步时间
    LAST_SYNC=$CURRENT_TIME

    # 显示触发事件
    CHANGE_FILE=$(echo "$event" | sed "s|$WATCH_DIR/||")
    log "📝 检测到变化: $CHANGE_FILE"

    # 等待防抖时间
    sleep $DEBOUNCE

    # 执行同步 - 本地优先单向同步（只推送，不拉取）
    log "🔄 开始同步..."
    "$SYNC_SCRIPT" --local-first > /dev/null 2>&1

    if [ $? -eq 0 ]; then
        log "✅ 同步完成"
    else
        log "❌ 同步失败，请检查日志"
    fi

    log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
done

#!/bin/bash

# Obsidian Vault 实时同步守护进程
# 使用 fswatch 监控本地文件夹，实时同步到网络磁盘
# 创建于: 2026-03-05

LOCAL_VAULT="$HOME/Documents/ObsidianVault"
REMOTE_HOST="ziqian@192.168.1.173"
REMOTE_VAULT="~/backup/obsidian-vault"
LOG_FILE="$HOME/.dsh/logs/sync-daemon.log"
PID_FILE="$HOME/.dsh/logs/sync-daemon.pid"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 记录日志
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# 检查远程服务器
 check_remote() {
    if ! ssh -o ConnectTimeout=5 "$REMOTE_HOST" "test -d $REMOTE_VAULT" 2>/dev/null; then
        log "ERROR: 服务器不可达或目录不存在: $REMOTE_HOST:$REMOTE_VAULT"
        return 1
    fi
    return 0
}

# 执行同步
sync_to_remote() {
    local event_path="$1"
    
    # 检查网络磁盘
    if ! check_remote; then
        return 1
    fi
    
    log "SYNC triggered by: $event_path"
    
    # 执行 rsync（通过 SSH）
    rsync -avzq --delete -e ssh \
        --exclude='.obsidian/workspace.json' \
        --exclude='.obsidian/workspaces.json' \
        --exclude='.DS_Store' \
        --exclude='.trash/' \
        --exclude='.stfolder/' \
        "$LOCAL_VAULT/" "$REMOTE_HOST:$REMOTE_VAULT/" 2>&1 | head -20 >> "$LOG_FILE"
    
    if [ $? -eq 0 ]; then
        log "SYNC completed"
        # 通知已禁用（避免弹窗干扰）
        # osascript -e 'display notification "Obsidian Vault 已同步" with title "同步完成"' 2>/dev/null || true
    else
        log "SYNC failed"
    fi
}

# 启动监控
start_monitoring() {
    log "=========================================="
    log "启动 Obsidian Vault 实时同步守护进程"
    log "本地: $LOCAL_VAULT"
    log "远程: $REMOTE_HOST:$REMOTE_VAULT"
    log "日志: $LOG_FILE"
    log "=========================================="
    
    # 检查本地目录
    if [ ! -d "$LOCAL_VAULT" ]; then
        log "ERROR: 本地 Vault 不存在: $LOCAL_VAULT"
        exit 1
    fi
    
    # 检查服务器
    if ! check_remote; then
        log "WARNING: 服务器不可达，等待中..."
        # 继续运行，等待服务器可用
    fi
    
    log "开始监控文件变化..."
    
    # 使用 fswatch 监控
    # -r: 递归
    # -l 5: 延迟5秒批量处理（避免频繁触发）
    # --exclude: 排除某些文件
    fswatch -r \
        -l 5 \
        --exclude='\.obsidian/workspace\.json$' \
        --exclude='\.obsidian/workspaces\.json$' \
        --exclude='\.DS_Store$' \
        --exclude='\.trash/' \
        --exclude='\.stfolder/' \
        --exclude='\.sync/' \
        "$LOCAL_VAULT" | while read file_path; do
        
        # 防抖处理：如果 2 秒内再次触发，忽略
        sleep 2
        
        # 检查服务器是否可用
        if check_remote; then
            sync_to_remote "$file_path"
        else
            log "SKIP: 服务器不可达"
        fi
    done
}

# 后台运行
start_daemon() {
    if [ -f "$PID_FILE" ]; then
        local old_pid=$(cat "$PID_FILE")
        if ps -p "$old_pid" > /dev/null 2>&1; then
            log "守护进程已在运行 (PID: $old_pid)"
            echo "守护进程已在运行"
            exit 0
        fi
    fi
    
    # 后台启动
    nohup "$0" monitor > /dev/null 2>&1 &
    local new_pid=$!
    echo $new_pid > "$PID_FILE"
    
    log "守护进程已启动 (PID: $new_pid)"
    echo "✅ 实时同步守护进程已启动"
    echo "   PID: $new_pid"
    echo "   日志: $LOG_FILE"
}

# 停止守护进程
stop_daemon() {
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            kill "$pid" 2>/dev/null
            rm "$PID_FILE"
            log "守护进程已停止 (PID: $pid)"
            echo "✅ 守护进程已停止"
        else
            echo "守护进程未运行"
            rm "$PID_FILE"
        fi
    else
        echo "守护进程未运行"
    fi
}

# 查看状态
show_status() {
    echo "=== Obsidian 实时同步状态 ==="
    echo ""
    
    if [ -f "$PID_FILE" ]; then
        local pid=$(cat "$PID_FILE")
        if ps -p "$pid" > /dev/null 2>&1; then
            echo -e "${GREEN}状态: 运行中${NC} (PID: $pid)"
        else
            echo -e "${RED}状态: 已停止${NC} (PID 文件存在但进程不存在)"
            rm "$PID_FILE"
        fi
    else
        echo -e "${YELLOW}状态: 未启动${NC}"
    fi
    
    echo ""
    echo "本地 Vault: $LOCAL_VAULT"
    if [ -d "$LOCAL_VAULT/.obsidian" ]; then
        echo -e "状态: ${GREEN}已初始化${NC}"
        echo "文件数: $(find "$LOCAL_VAULT" -type f 2>/dev/null | wc -l)"
    else
        echo -e "状态: ${RED}未初始化${NC}"
    fi
    
    echo ""
    echo "服务器: $REMOTE_HOST:$REMOTE_VAULT"
    if ssh -o ConnectTimeout=5 "$REMOTE_HOST" "test -d $REMOTE_VAULT/.obsidian" 2>/dev/null; then
        echo -e "状态: ${GREEN}已连接${NC}"
        echo "文件数: $(ssh "$REMOTE_HOST" "find $REMOTE_VAULT -type f 2>/dev/null | wc -l")"
    else
        echo -e "状态: ${RED}不可达${NC}"
    fi
    
    echo ""
    echo "日志文件: $LOG_FILE"
    if [ -f "$LOG_FILE" ]; then
        echo "最近 5 条日志:"
        tail -5 "$LOG_FILE"
    fi
}

# 显示帮助
show_help() {
    cat << EOF
Obsidian Vault 实时同步守护进程

用法: $(basename $0) [选项]

选项:
    start       启动实时同步守护进程（后台）
    stop        停止守护进程
    restart     重启守护进程
    status      查看状态
    monitor     前台运行监控（调试用）
    once        执行一次同步
    help        显示帮助

说明:
    - 使用 fswatch 实时监控本地文件夹变化
    - 变化后 5 秒内自动同步到网络磁盘
    - 支持网络磁盘断开重连
    - 日志保存在: $LOG_FILE

示例:
    $(basename $0) start    # 启动实时同步
    $(basename $0) status   # 查看状态
    $(basename $0) stop     # 停止同步

EOF
}

# 主逻辑
case "$1" in
    start)
        start_daemon
        ;;
    stop)
        stop_daemon
        ;;
    restart)
        stop_daemon
        sleep 1
        start_daemon
        ;;
    monitor)
        start_monitoring
        ;;
    once)
        check_remote && sync_to_remote "手动触发"
        ;;
    status)
        show_status
        ;;
    help|--help|-h)
        show_help
        ;;
    *)
        show_status
        echo ""
        echo "运行 '$(basename $0) help' 查看详细用法"
        ;;
esac

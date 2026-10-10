#!/bin/bash
# 双向同步脚本：本地 workspaces ↔ 云盘
# 优化版：解决删除恢复、移动变两份的问题

# 配置
LOCAL_DIR="/Users/mac/Documents/ObsidianVault"
REMOTE_HOST="ziqian@192.168.1.173"
REMOTE_DIR="~/backup/obsidian-vault"
LOG_FILE="$HOME/Documents/ObsidianBackups/sync_log.txt"
# ssh 超时与保活：避免局域网断连时挂死/误报
SSH_OPTS="-o ConnectTimeout=10 -o ServerAliveInterval=5 -o ServerAliveCountMax=2"

# 同步模式：默认为空，--local-first 时以本地为准
MODE="$1"

# 颜色输出
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

log_error() {
    echo -e "${RED}[错误]${NC} $1" | tee -a "$LOG_FILE"
}

log_warn() {
    echo -e "${YELLOW}[警告]${NC} $1" | tee -a "$LOG_FILE"
}

log "=== 双向同步开始 ==="
log "模式: ${MODE:-双向}"

# 检查远程服务器是否可达
if ! ssh $SSH_OPTS "$REMOTE_HOST" "echo reachable" > /dev/null 2>&1; then
    log_error "服务器不可达: $REMOTE_HOST"
    exit 1
fi

log "✅ 服务器已连接"

# 获取当前状态
LOCAL_SIZE=$(du -sh "$LOCAL_DIR" 2>/dev/null | awk '{print $1}')
REMOTE_SIZE=$(ssh $SSH_OPTS "$REMOTE_HOST" "du -sh $REMOTE_DIR 2>/dev/null" | awk '{print $1}')
if [ -z "$REMOTE_SIZE" ]; then
    REMOTE_SIZE="0"
fi

log "📊 本地: $LOCAL_SIZE"
log "📊 服务器: $REMOTE_SIZE"

# 排除模式
EXCLUDE_OPTS="
    --exclude='.DS_Store'
    --exclude='._*'
    --exclude='.Trash'
    --exclude='.trash'
    --exclude='node_modules'
    --exclude='__pycache__'
    --exclude='.git'
    --exclude='venv'
"

# 根据模式执行同步
if [ "$MODE" = "--local-first" ]; then
    # 本地优先：以本地为准，推送到服务器，删除服务器多余文件
    log ""
    log "📤 同步模式: 本地优先"
    log "🔄 从本地推送到服务器..."
    rsync -avz --delete -e ssh $EXCLUDE_OPTS "$LOCAL_DIR/" "$REMOTE_HOST:$REMOTE_DIR/"
    
    PUSH_RESULT=$?
    if [ $PUSH_RESULT -eq 0 ]; then
        log "✅ 推送成功"
    else
        log_error "推送失败 (错误码: $PUSH_RESULT)"
    fi

elif [ "$MODE" = "--remote-first" ]; then
    # 服务器优先：以服务器为准，拉取到本地，删除本地多余文件
    log ""
    log "📥 同步模式: 服务器优先"
    log "🔄 从服务器拉取到本地..."
    rsync -avz --delete -e ssh $EXCLUDE_OPTS "$REMOTE_HOST:$REMOTE_DIR/" "$LOCAL_DIR/"
    
    PULL_RESULT=$?
    if [ $PULL_RESULT -eq 0 ]; then
        log "✅ 拉取成功"
    else
        log_error "拉取失败 (错误码: $PULL_RESULT)"
    fi

else
    # 标准双向同步（修复版）
    
    # 第一步：删除操作同步（先处理删除，避免恢复已删除文件）
    log ""
    log "🗑️ 步骤 1/4: 同步删除操作..."
    
    # 找出本地已删除但服务器还存在的文件
    find "$LOCAL_DIR" -type f 2>/dev/null | sed "s|$LOCAL_DIR/||" > /tmp/local_files.txt
    ssh $SSH_OPTS "$REMOTE_HOST" "find $REMOTE_DIR -type f 2>/dev/null | sed 's|$REMOTE_DIR/||'" > /tmp/remote_files.txt
    
    # 删除服务器上有但本地没有的文件（删除同步）
    while IFS= read -r file; do
        if [ -n "$file" ]; then
            ssh $SSH_OPTS "$REMOTE_HOST" "rm -f $REMOTE_DIR/$file" 2>/dev/null
        fi
    done < <(comm -23 <(sort /tmp/remote_files.txt) <(sort /tmp/local_files.txt))
    
    log "✅ 删除同步完成"
    
    # 第二步：服务器 → 本地（拉取更新）
    log ""
    log "📥 步骤 2/4: 从服务器拉取更新..."
    rsync -avz -e ssh $EXCLUDE_OPTS "$REMOTE_HOST:$REMOTE_DIR/" "$LOCAL_DIR/"

    PULL_RESULT=$?
    if [ $PULL_RESULT -eq 0 ]; then
        log "✅ 拉取成功"
    else
        log_warn "拉取部分失败 (错误码: $PULL_RESULT)"
    fi

    # 第三步：本地 → 服务器（推送更新）
    log ""
    log "📤 步骤 3/4: 推送更新到服务器..."
    rsync -avz -e ssh $EXCLUDE_OPTS "$LOCAL_DIR/" "$REMOTE_HOST:$REMOTE_DIR/"

    PUSH_RESULT=$?
    if [ $PUSH_RESULT -eq 0 ]; then
        log "✅ 推送成功"
    else
        log_warn "推送部分失败 (错误码: $PUSH_RESULT)"
    fi

    # 第四步：清理 macOS 系统文件
    log ""
    log "🧹 步骤 4/4: 清理系统文件..."
    ssh $SSH_OPTS "$REMOTE_HOST" "find $REMOTE_DIR -name '._*' -delete 2>/dev/null"
    find "$LOCAL_DIR" -name "._*" -delete 2>/dev/null
    log "✅ 清理完成"
fi

# 统计同步结果
log ""
log "📊 同步统计..."

LOCAL_COUNT=$(find "$LOCAL_DIR" -type f 2>/dev/null | wc -l | tr -d ' ')
REMOTE_COUNT=$(ssh $SSH_OPTS "$REMOTE_HOST" "find $REMOTE_DIR -type f 2>/dev/null | wc -l | tr -d ' '")
if [ -z "$REMOTE_COUNT" ]; then
    REMOTE_COUNT=0
    log_error "ssh 超时，无法获取服务器文件数"
fi

log "本地文件: $LOCAL_COUNT 个"
log "服务器文件: $REMOTE_COUNT 个"

if [ "$LOCAL_COUNT" -eq "$REMOTE_COUNT" ]; then
    log "✅ 文件数量一致"
else
    log_warn "文件数量不一致，差 $(($REMOTE_COUNT - $LOCAL_COUNT)) 个"
fi

log ""
log "=== 双向同步完成 ==="

exit 0

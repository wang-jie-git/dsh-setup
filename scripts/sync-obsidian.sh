#!/bin/bash
# 同步 Obsidian 笔记到家庭服务器
# 用途：Mac 崩溃或丢失时，笔记不丢

VAULT="/Users/mac/Documents/ObsidianVault"
SERVER="ziqian@192.168.1.173"
REMOTE_PATH="~/backup/obsidian-vault"
LOG="/tmp/obsidian-sync.log"

echo "===== $(date) =====" >> "$LOG"

rsync -avz --delete \
  --exclude=".DS_Store" \
  --exclude=".obsidian/workspace.json" \
  --exclude=".obsidian/cache" \
  --exclude=".trash" \
  "$VAULT/" \
  "$SERVER:$REMOTE_PATH/" >> "$LOG" 2>&1

if [ $? -eq 0 ]; then
  echo "✅ 同步完成" >> "$LOG"
else
  echo "❌ 同步失败" >> "$LOG"
fi
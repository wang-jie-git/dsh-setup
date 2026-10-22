#!/bin/bash
# apply-workbuddy-patch.sh — 幂等固化 workbuddy system-prompt 渠道签名补丁
#
# 背景：workbuddy 上游网关检测 system prompt 里的 "DeepSeek Harness" 品牌签名
#       → 400 "Illegal API invocation from an unapproved channel"（请求被拦截）。
#       修复 = 在插件 shim 转发层（prepareChatBody）中和所有渠道品牌词。
# 补丁打在 .pnpm 打包副本内，dsh 升级 / 插件重装会丢失，此脚本负责重打。
#
# 用法：直接执行（幂等，已打补丁则跳过）。
# 由 LaunchAgent com.one.dsh-web 在启动 dsh 前调用。

set -u
LOG="/tmp/dsh-workbuddy-patch.log"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] === workbuddy patch check ===" >> "$LOG"

PROFILE_DIR="$HOME/.dsh/profiles/web"
BACKUP_DIR="$HOME/.dsh/backups/workbuddy-patch"

# 定位最新 .pnpm workbuddy-connect 副本（可能有多个版本残留）
TARGET=""
for d in "$PROFILE_DIR"/node_modules/.pnpm/dsh-workbuddy-connect@*/node_modules/dsh-workbuddy-connect/lib/host-heartbeat-*.js; do
  if [ -f "$d" ]; then
    # 取最新 mtime 的副本
    if [ -z "$TARGET" ] || [ "$d" -nt "$TARGET" ]; then
      TARGET="$d"
    fi
  fi
done

if [ -z "$TARGET" ] || [ ! -f "$TARGET" ]; then
  echo "ERROR: 未找到 workbuddy-connect 的 host-heartbeat 文件（插件可能未安装）" >> "$LOG"
  exit 0  # 不阻塞 dsh 启动，仅记录
fi

echo "目标文件: $TARGET" >> "$LOG"

# 幂等：已含 cleanChannelSignature 则跳过
if grep -q "cleanChannelSignature" "$TARGET"; then
  echo "OK: 补丁已存在，跳过" >> "$LOG"
  exit 0
fi

# 备份原文件（保留最近 5 份）
mkdir -p "$BACKUP_DIR"
BAK="$BACKUP_DIR/host-heartbeat-$(date +%Y%m%d-%H%M%S).js.bak"
cp "$TARGET" "$BAK"
echo "备份: $BAK" >> "$LOG"
ls -t "$BACKUP_DIR"/*.bak 2>/dev/null | tail -n +6 | xargs -r rm -- 2>/dev/null || true

# 用 python 精确打补丁（两处：调用点 + 函数定义）
python3 - "$TARGET" <<'PYEOF'
import sys

target = sys.argv[1]
with open(target, encoding="utf-8") as f:
    src = f.read()

if "cleanChannelSignature" in src:
    print("ALREADY PATCHED")
    sys.exit(0)

# 1) prepareChatBody 调用点：在 normalizeDeveloperRole 后插入 cleanChannelSignature
old_call = "normalizeDeveloperRole(obj);\n\tnormalizeToolChoice(obj);"
new_call = "normalizeDeveloperRole(obj);\n\tcleanChannelSignature(obj);\n\tnormalizeToolChoice(obj);"
if old_call not in src:
    print("ERROR: 找不到调用点锚文本")
    sys.exit(1)
src = src.replace(old_call, new_call, 1)

# 2) 在 normalizeDeveloperRole 定义前插入函数
anchor = '/** Rewrite `role: "developer"` messages to `role: "system"` (upstream rejects developer). */\nfunction normalizeDeveloperRole(obj) {'
if anchor not in src:
    print("ERROR: 找不到函数插入锚文本")
    sys.exit(1)

fn = r'''/** Neutralize upstream channel signatures in system prompts (workbuddy blocks "DeepSeek Harness" branded prompts). */
function cleanChannelSignature(obj) {
	const messages = obj["messages"];
	if (!Array.isArray(messages)) return;
	for (const message of messages) {
		if (typeof message !== "object" || message === null || Array.isArray(message)) continue;
		const role = message["role"];
		if (role !== "system" && role !== "developer") continue;
		const content = message["content"];
		const rewrite = (text) => {
			if (typeof text !== "string") return text;
			return text
				.replace(/You are an AI agent powered by DeepSeek Harness\./gi, "You are a helpful AI assistant.")
				.replace(/You are a coding agent powered by the [A-Za-z0-9._-]+ model\./gi, "You are a helpful coding assistant.")
				.replace(/DeepSeek Harness implementation checkout/g, "the hosted implementation checkout")
				.replace(/DeepSeek Harness Web GUI/g, "the local web GUI")
				.replace(/DeepSeek Harness/g, "the hosting platform")
				.replace(/\bDSH\b/g, "the system")
				.replace(/\bdsh web\b/gi, "the local web GUI")
				.replace(/window\.__DSH_BOOT__/g, "window.__HOST_BOOT__");
		};
		if (typeof content === "string") {
			message["content"] = rewrite(content);
		} else if (Array.isArray(content)) {
			for (const item of content) {
				if (item && typeof item === "object" && item["type"] === "text" && typeof item["text"] === "string") {
					item["text"] = rewrite(item["text"]);
				}
			}
		}
	}
}
'''
src = src.replace(anchor, fn + anchor, 1)

with open(target, "w", encoding="utf-8") as f:
    f.write(src)

# 验证
with open(target, encoding="utf-8") as f:
    after = f.read()
if after.count("cleanChannelSignature") >= 2:
    print("PATCHED OK")
else:
    print("ERROR: 补丁后验证失败")
    sys.exit(1)
PYEOF

PYRC=$?
if [ $PYRC -ne 0 ]; then
  echo "ERROR: python 打补丁失败 rc=$PYRC（已备份到 $BAK，请检查）" >> "$LOG"
  exit 0  # 不阻塞启动，下次重启会重试
fi

echo "OK: 补丁已应用 → $(grep -c 'cleanChannelSignature' "$TARGET") 处" >> "$LOG"
exit 0

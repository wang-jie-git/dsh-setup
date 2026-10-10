# dsh-setup — dsh 全套插件与配置（跨设备一键安装）

> 主程序**不在此仓库**：直接引用官方 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)。
> 本仓库只保存 **插件、技能、智能体预设与配置**，让新设备可以快速复刻 dsh 环境。

## 快速开始

```bash
# 1. 安装官方 dsh 主程序（任意设备）
git clone https://github.com/deepseek-ai/deepseek-harness /path/to/deepseek-harness
cd /path/to/deepseek-harness && pnpm install && pnpm run build:lib && pnpm run build:web

# 2. 克隆本仓库并一键安装配置
git clone https://github.com/wang-jie-git/dsh-setup ~/dsh-setup
cd ~/dsh-setup && bash install.sh

# 3. 填写 API keys
# ~/.dsh/.env 已生成模板，填入 AGNES/SHANGTANG/ZHIPUAI/JINA/NOCOBASE 等 key

# 4. 按设备路径调整 MCP 配置
# ~/.dsh/profiles/web/cordis.patch.yml 中的 Mac 路径
# （AI-memory / ObsidianVault / nexus-browser / dsh-media-mcp / wigolo）按需替换

# 5. 启动
dsh --profile web --no-open --port 3080
# 验证插件：curl http://localhost:3080/api/worktable/health
```

## 仓库内容

| 目录 | 说明 |
|---|---|
| `profiles/web/` | web profile 完整配置（cordis.patch.yml 54 个插件条目、package.json 依赖、pnpm-workspace） |
| `.agent-presets/` | 智能体预设：anthropic-skills / personal-stylist / song-cao-kb / garment-matcher |
| `skills/` | 672 个技能文件（公文、图像、OCR、微信发布等） |
| `scripts/` | 同步与启动辅助脚本 |
| `env.tpl` | 环境变量模板（真实 key 不入仓库） |
| `install.sh` | 一键安装脚本（支持 `--dry-run` 预览） |

## 主要插件

- **dsh-worktable** v0.4.0 — 侧边栏应用抽屉与停靠工作区（健康路由 `/api/worktable/health`）
- **dsh-free-vision** — 视觉模型路由
- **MCP 服务器**：ai-memory（语义记忆）、obsidian-vault（文件系统）、dsh-media（ASR+视频抽帧）、nexus-browser、wigolo（搜索）、nocobase（服装 ERP）

## 模型（web profile）

- agnes-3.0-flash / agnes-2.5-flash / sensenova-6.8-flash-lite / glm-4.5-flash / deepseek-v4-flash 等
- contextWindow 已优化（compaction thresholdRatio 0.2，防 token 膨胀）

## 安全说明

- **仓库不含任何明文密钥**：`apiKey` 全部改为环境变量引用（`apiKeyEnv` / `process.env` / `os.environ`）
- 含 key 的本地文件（`.credentials.yaml`、`.env`、`free-vision.json`、`memory-ai-config.json`、`settings.yaml` 等）已在 `.gitignore` 排除
- 新设备通过 `env.tpl` 模板自行填写 key

## 卸载

```bash
# 备份现有 ~/.dsh 后恢复官方纯净状态
mv ~/.dsh ~/.dsh.bak-$(date +%Y%m%d)
# 重新初始化 dsh profile
dsh --from-default-profile web
```

## 已知限制

- `package.json` 中的 `@local/* link:` bundles（个人形象管理/文案/宋式美学）是业务智能体，不在本仓库，需自行部署
- MCP 依赖的外部服务（AI-memory / nexus-browser / dsh-media-mcp）需先在目标设备安装
- macOS 上 dsh-worktable 仍为实验性支持

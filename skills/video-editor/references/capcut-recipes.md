# 剪映草稿生成配方（capcut-cli / cutcli）

适用于用户要求"生成剪映工程/在剪映里继续编辑"的任务。生成标准剪映（JianYing）/CapCut 草稿，用户用桌面端打开即可继续编辑。

## 环境现状（2026-08-29）

| 工具 | 状态 | 安装 |
|---|---|---|
| capcut-cli | ⚠️ 未装 | `npm install -g capcut-cli`（node v24 已就绪） |
| cutcli | ⚠️ 未装 | `curl -s https://cutcli.com/cli \| bash` |

**首次使用前先安装**，并 `capcut doctor` 检测剪映版本兼容性。

## 剪映草稿原理

- 剪映/CapCut 把每个项目存在本地草稿文件夹，核心是 `draft_content.json`
- capcut-cli 直接读写草稿存储（JSON in, JSON out），不上传、无 API、无服务
- 新版剪映草稿可能加密，capcut-cli 支持（见 docs/jianying-encryption.md）
- 生成后可 `capcut quickstart` 或直接指定草稿目录，剪映打开即见

## capcut-cli 命令速查

```bash
# 初始化
capcut doctor                                          # 环境检测
capcut quickstart my-first --video clip.mp4 --srt caps.srt  # 快速上手
capcut init my-project                                 # 创建项目

# 查看
capcut info ./project/ -H                              # 项目信息（-H 人类可读）
capcut tracks ./project/
capcut materials ./project/
capcut segments ./project/
capcut lint ./project/                                 # 校验草稿

# 添加
capcut add-video ./project clip.mp4
capcut add-audio ./project bgm.mp3
capcut add-text ./project "标题文字"

# 编辑/动画
capcut trim ./project 0:01:00 0:02:00
capcut speed ./project 1.5
capcut volume ./project 0.5
capcut transitions ./project add <from> <to> <type>
capcut masks ./project <clip> <mask>
capcut sfx ./project zoom-in
capcut chroma ./project --color green                  # 绿幕抠像

# 字幕（核心能力）
capcut caption ./project --srt subtitles.srt           # 生成风格化字幕
capcut import-srt ./project subs.srt
capcut export-srt ./project                            # 导出 SRT
capcut translate ./project --to en                    # 多语言克隆（需 ANTHROPIC_API_KEY）

# 长视频切短视频
capcut cut ./project --auto
capcut detect-scenes ./project                         # 场景检测（ffmpeg）

# 模板
capcut make-preset ./project --name my-style           # 文本样式预设
capcut templates apply ./project <template>

# 渲染预览（低清 ffmpeg proxy，非最终渲染）
capcut render ./project --low-res

# 自动化
capcut serve                                           # JSONL 队列执行（n8n/Make/Coze）

# 剪映命名空间
capcut <cmd> --jianying                                # 切到剪映枚举命名空间
```

## 典型工作流

```bash
# 1. 安装 + 检测
npm install -g capcut-cli && capcut doctor

# 2. 创建草稿 + 导入素材
capcut init build/draft/my-project
capcut add-video build/draft/my-project raw/clip.mp4
capcut add-audio build/draft/my-project assets/bgm.mp3

# 3. 加字幕（从 SRT）
capcut import-srt build/draft/my-project build/edit/subtitles.srt

# 4. 微调
capcut trim build/draft/my-project 0:00:05 0:00:15
capcut sfx build/draft/my-project fade-in

# 5. 交付：告诉用户草稿路径，剪映打开即可继续编辑
echo "草稿在 build/draft/my-project，剪映草稿列表可看到"
```

## cutcli（备选，云端渲染更强）

```bash
curl -s https://cutcli.com/cli | bash                # 安装
cutcli draft create --video clip.mp4                 # 创建草稿
cutcli captions add --text "字幕" --t 1              # 加字幕
cutcli draft easy                                    # 按音频自动适配
cutcli cloud render <draftId>                        # 云端渲染（需 API key，可选）
```

cutcli-cookbook（github.com/xuliang2024/cutcli-cookbook）提供**可运行示例 + JSON 模板 + AI 提示词**，首次使用先参考其中的 examples/（01-hello-caption、02-image-slideshow-bgm、03-tiktok-keyword-highlight）。

## 何时用剪映草稿方案

- ✅ 用户明确要"在剪映里继续改"
- ✅ 需要剪映特有的动画/模板/音效库
- ✅ 用户习惯剪映工作流，最终发布在抖音/剪映生态
- ❌ 用户只想要一个最终 MP4 → 走 FFmpeg/Kdenlive

## 注意事项

- 剪映草稿格式随版本变化，升级前先 `capcut doctor` + 参考 docs/version-support.md
- 旧版 fixture（0.17.2 前）含设备标识，视为未脱敏数据
- 独立社区项目，非字节官方，仅用于识别性使用
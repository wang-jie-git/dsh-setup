# 视频剪辑项目目录结构

每个视频项目一个独立文件夹。**原始素材只读不改**，中间产物放 `build/`（可随时删除重建），最终成片放 `output/`（按版本命名）。

## 目录骨架

```
project/                        # 项目根（默认 workspace 下按项目建目录）
├── raw/                        # 原始素材，只读不改
├── converted/                  # 转码后的图片/视频（HEIC→PNG 等）
├── scripts/                    # 镜头表、剪辑脚本、自动化脚本（JSON 镜头表）
├── build/
│   └── edit/
│       ├── keyframes/          # 素材关键帧（抽帧用）
│       ├── segments/           # 单个片段（每个镜头一个）
│       ├── overlays/           # 字幕、信息卡、标题卡 PNG
│       ├── captioned/          # 已叠字幕片段
│       ├── qc_frames/          # 抽帧检查图
│       └── concat.txt          # 片段合并清单
├── output/
│   ├── final_v1.mp4            # 最终成片（版本号递增）
│   └── cover.jpg               # 封面图
└── publish-copy.md             # 发布文案（标题、正文、标签）
```

## 命名规范

| 内容 | 规则 | 示例 |
|---|---|---|
| 原始素材 | 保持相机原文件名 | `IMG_0042.MOV` |
| 自动生成 | 放 build/，可删 | `segments/001.mp4` |
| 最终成片 | output/ + 版本号 | `final_v1.mp4`、`final_v2.mp4` |
| 脚本/镜头表 | scripts/ | `shot-plan.json` |
| 发布文案 | output 旁 | `publish-copy.md` |

## 镜头表 JSON（机器可读的编辑计划）

```json
{
  "width": 1080,
  "height": 1920,
  "fps": 30,
  "raw_dir": "raw",
  "build_dir": "build/edit",
  "font_file": "/System/Library/Fonts/PingFang.ttc",
  "segments": [
    {
      "kind": "video",
      "file": "clip_001.mov",
      "start": 12.5,
      "dur": 2.5,
      "caption": "开场钩子字幕"
    },
    {
      "kind": "image",
      "file": "photo_001.heic",
      "dur": 3,
      "caption": "地点或细节说明"
    },
    {
      "kind": "card",
      "dur": 6,
      "card": "信息卡标题\n\n要点一\n要点二\n要点三"
    }
  ]
}
```

- `kind=video`：需 `file`、`start`、`dur`
- `kind=image`：需 `file`、`dur`（图片转视频用 `-loop 1 -t <dur>`）
- `kind=card`：需 `dur`、`card`（信息卡文字）
- `caption`：底部字幕；`style: "title"` 居中标题

## 短视频结构模板（60-150 秒）

1. 0-5 秒：强钩子（结果/反差/动作/问题/惊喜）
2. 5-20 秒：地点/背景/主题
3. 20-45 秒：核心信息（价格/规则/步骤/亮点）
4. 45-90 秒：过程和体验（B-roll 串联）
5. 90-120 秒：实测/优缺点/结论
6. 结尾 3-8 秒：收藏/关注/下集预告/封面回收

## 出片前检查

- 镜头表总时长 = 脚本预期时长
- 素材入点/出点未越界
- 字幕无错别字、不挡平台按钮（底部留 120-180px）
- 封面第一眼能看懂主题
# RooYun（完整版 skill）

用自然语言驱动 [RooYun](https://www.rooyun.com/?utm_source=github&utm_medium=plugin-readme) 的 AI 漫剧 / AI 短剧创作工作台：按「剧本 → 角色/场景/道具 → 分镜 → 定嗓 → 生成」的固定流程在无限画布上搭工程，生成分镜图、视频和配音，产物自动落回画布。

- 第一次使用时，Agent 会运行 `dj.mjs login` 并打开浏览器，在 RooYun 页面点一次「授权」即可。
- 生成会消耗 RooYun 积分。skill 要求 Agent 每次生成前先报价，等你确认后才提交。
- 与 `rooyun-cli` 二选一安装。

技能说明见 [skills/rooyun/SKILL.md](skills/rooyun/SKILL.md)，安装与权限说明见 [skills/rooyun/README.md](skills/rooyun/README.md)。

## 安装

```bash
claude plugin marketplace add DeepHiveAI/rooyun-skill
claude plugin install rooyun@rooyun
```

Full guided skill for RooYun, an AI comic-drama and short-drama studio: break a script into characters, scenes, props and shots on an infinite canvas, then generate storyboard images, video clips and voice-over after a price quote you confirm.

隐私政策：https://www.rooyun.com/privacy · 用户协议：https://www.rooyun.com/terms

# 衣见 · AI Outfit Studio

本地整套穿搭生图工具。只支持本机 Codex 已有的 ChatGPT 登录。在左侧图库点击＋加入右侧常驻待试清单，统一选择可选人物参考、姿势与视角、摄影风格后提交；单套和多套共用这一流程，每套一张，提交后移出清单。点击图片可预览，导入穿搭会直接加入清单。

底部任务栏可展开查看进度、取消排队或带回失败任务的设置。“本次成片”提供下载、沿用设置和换一套穿搭，恢复设置后由用户再次提交。图库浏览位置和本次设置在切页时保留，刷新后清空。

## 交给 Agent 启动

> 帮我下载并启动 https://github.com/lzq976291321/ai-outfit-studio 。已有目录先检查，不覆盖修改；阅读 AGENTS.md 和 README.md，检查环境后启动本地网站并打开页面。端口占用时换空闲端口，不停止其他服务。启动后等我手动连接 ChatGPT，不读取或展示登录文件，不提交生成。

Agent 完成下载与启动，你在设置中点击“连接本机 ChatGPT”。需要先在本机 Codex 使用 ChatGPT 登录；仅浏览器登录不足以连接。

## 手动启动

Python 3.10+、Node.js 20+、curl；无需安装项目依赖。

```sh
python3 -B start.py --check
python3 -B start.py
```

默认 http://127.0.0.1:8765/；端口占用可加 `--port 8766`，不自动打开浏览器可加 `--no-open`。Ctrl+C 停止。服务仅监听本机。

## 使用与保存

穿搭与姿势目录运行时从 AI Costume Gallery 和 AI Pose Gallery（中文索引）在线读取，不维护本地图库、图片缓存或随包素材。可临时导入用户自己的穿搭与人物图。穿搭必选、人物可选，默认自然站立；无人物参考不保证跨任务人脸一致。镜头方向同时以文字传递。

最多四个并发任务、八个待完成任务，提交后输入固定。清除已结束记录不删除电脑文件，并保留未自动保存的成片和待核对任务。仅能取消排队任务，失败不自动重试。待试清单、导入、人物参考和任务只留在当前内存，刷新清空。电脑最终成片自动保存到 `~/Downloads/衣见成片`；保存失败可手动下载。桌面工作台优先适配 PC 与笔记本窗口；窄屏仅保留基本排版兼容。当前服务只监听 127.0.0.1，手机不能独立连接本机 ChatGPT，也没有手机相册入口。

凭据仅由本机后端读取，不复制、另存或返回网页。图片与提示词发送到 ChatGPT，生成使用账号额度；本地运行不是本地模型推理。当前依赖非公开 Images 接口，连接就绪不等于远程生图权限验证。拒绝与异常会明确显示；2026-10-30 已完成当前电脑、账号与单参考组合的真实生成及自动保存验收；人物一致性、三参考、手机与持续成功率尚未验证。

## 检查与打包

```sh
node scripts/check-frontend.mjs
(cd prototype && python3 -B -m unittest test_output_save.py test_photography_styles.py test_request_outcomes.py)
python3 -B scripts/check-release.py
python3 -B scripts/package.py
```

测试使用本地假响应，不调用真实模型。GitHub Actions 在 push/PR 检查，v* 标签发布 ZIP；不配置在线部署。

代码使用 MIT，Anime.js 保留原 MIT 许可。在线图片适用来源自己的条款，不随发布包分发，详见 THIRD_PARTY_NOTICES.md。

在线来源：https://ai-costume-gallery.pages.dev/ 、https://ai-pose-gallery.pages.dev/ ，中文姿势索引：https://github.com/anhao/ai-pose-gallery-zh 。图片允许作品参考但禁止再分发；姿势库限制用于真实人物或未成年。代码开源不等于图片开源。图库不可用时明确提示，不回退本地样本。

摄影风格按环境、光线、镜头、质感和避免事项展开后发送，详见 [摄影风格说明](docs/photography-styles.md)。

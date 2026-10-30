# 衣见 · AI Outfit Studio

本地运行的整套穿搭图生图工具。选择穿搭、人物参考（可选）、姿势与摄影风格，用自己的账号或 API Key 生成成片。

**首个 Alpha 版本，接口与模型效果仍在验证。** 内置 3 套 AI 生成的虚构穿搭、6 个自绘姿势示意；不包含第三方图库数据。姿势示意不是摄影样片，镜头方向同时以文字传递。

## 开始使用

需要 Python 3.10+、Node.js 20+ 和 curl。无需安装项目依赖。

1. 下载 [最新发布包](https://github.com/lzq976291321/ai-outfit-studio/releases/latest)，解压后进入目录。
2. 运行 `python3 -B prototype/server.py`。
3. 打开 http://127.0.0.1:8765/，在设置中连接本机登录或填写自己的 API Key。

也可以克隆：

```sh
git clone https://github.com/lzq976291321/ai-outfit-studio.git
cd ai-outfit-studio
python3 -B prototype/server.py
```

端口 8765 需要空闲。停止服务使用 Ctrl+C。

## 生成方式

- **本机 ChatGPT 登录**：读取本机 Codex 已有的 ChatGPT 登录，仅在服务器内存使用凭据。需要先在 Codex 登录；仅在浏览器登录 ChatGPT 不足以使用此方式。不复制登录文件，也不向网页返回令牌。当前依赖非公开的图像接口，可能变更、限流或拒绝请求；不是官方 OAuth 集成，不保证任意账号可用。
- **自己的 API Key**：支持豆包、OpenAI 兼容图像编辑、GlobalRouter 图生图协议。模型、地址、尺寸支持与费用由服务商决定。没有账号或 Key 也能浏览、选图和准备任务。

图片会发送到你选择的上游服务。本地运行指界面与代理在本机，不是本地模型推理。当前路径未完成所有供应商、账号与输入组合的真实验收，不能保证每次成功；内容拒绝或异常会显示失败，不自动重试。

## 使用规则

穿搭必选，人物参考可选；不选人物参考不保证跨任务人脸一致。默认自然站立，可以换姿势。支持本地添加穿搭与人物图片，上传、收藏、配置、任务仅保留当前页面会话。最多 2 个并发任务、8 个待完成任务；任务提交后使用固定输入。

桌面本机运行时，最终成片自动保存到 `~/Downloads/衣见成片`。手机网页需要点击分享或下载，由系统处理保存；不能静默写入相册，尚未完成真机验收。输入、Key 和任务不会写入应用数据库或浏览器持久化存储，上游有自己的数据政策。

Vercel 页面只提供介绍与下载，不处理账号、上传或生成。只导入你有权使用的图片。

## 验证与发布

```sh
node --test prototype/test_chatgpt_images.mjs prototype/test_chatgpt_response.mjs
(cd prototype && python3 -B -m unittest test_output_save.py)
python3 -B scripts/check-release.py
python3 -B scripts/package.py
```

测试使用本地假响应，不调用真实模型，不等于模型效果验收。GitHub Actions 在 push/PR 检查；推送 `v*` 标签会检查并发布 ZIP。Vercel 连接 main，使用 `site/` 静态输出，不安装依赖。

## 许可

代码与自绘姿势使用 MIT；Anime.js 保留原 MIT 许可。内置穿搭与网页配图由 AI 生成，是虚构素材，不代表真实商品。详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

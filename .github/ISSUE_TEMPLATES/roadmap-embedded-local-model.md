## Title
Roadmap: 内置本地模型后端（无 Python）+ 可配置离线模型

## 背景
当前已支持通过 `local_server/` (Python + transformers) 提供本地翻译服务，并在扩展侧自动启动/探活/降级。同时新增了：
- `translate.local.offline`：严格离线（不下载模型）
- `translate.local.model.*`：可配置本地模型路径（root / enZh / zhEn）
- `vscode-translate.checkLocalModel`：一键自检离线模型配置

但现状仍依赖用户具备 Python 环境与依赖安装，这对“开箱即用”体验不友好。

## 目标
在不依赖用户 Python 环境的前提下，支持插件内置/自带的本地模型推理能力，并且允许未来灵活配置模型来源（本地文件/不同模型/不同后端）。

## 关键约束
- 离线优先：支持完全离线模式（不联网下载模型）。
- 可配置：模型来源必须可配置（至少 EN→ZH、ZH→EN 两个槽位），后续可扩展更多语言对。
- 可维护：避免 VSIX 包体无限膨胀；避免引入难以维护的多平台编译链。
- 不阻塞 Extension Host：推理/加载需要在子进程或 worker 中执行，避免卡主扩展。

## 方案候选（待评估）
### A) Node/JS 推理后端（推荐优先验证）
- 使用 `@huggingface/transformers`（transformers.js / Xenova）+ ONNX/WASM 或 onnxruntime-node。
- 扩展侧继续复用现有 HTTP 协议（/health /translate /shutdown + READY stdout），仅替换服务实现。
- 离线模式：要求本地权重文件存在，严格 `local_files_only`。

风险/难点：
- 性能与内存占用；
- 模型格式（onnx/权重）与跨平台一致性；
- 缓存目录与权限（globalStorage）。

### B) 内置二进制（Rust/Go/或 PyInstaller）
- 按平台发布多份产物（win/mac/linux），VSIX 内带可执行服务。

风险/难点：
- CI 构建矩阵复杂；
- 可执行文件签名/兼容问题；
- 包体更大。

## 拆分任务（建议）
1) 配置设计固化（面向未来）
- 增加 `translate.local.backend`: `python | node`（默认 python，未来可切换）
- 统一模型配置结构：
  - `translate.local.model.root`
  - `translate.local.model.enZh`
  - `translate.local.model.zhEn`
  - （可选）`translate.local.model.format` / `translate.local.model.cacheDir`
- 明确离线语义：offline=true 时禁止任何网络行为。

2) Node 本地服务 MVP（同协议）
- 新增 `local_server_node/` 或 `src/local-node-server/`：实现 `/health` `/translate` `/shutdown` + `LOCAL_TRANSLATE_READY ...`
- 支持读取与 python 服务同名 env：
  - `VSCODE_TRANSLATE_OFFLINE`
  - `VSCODE_TRANSLATE_MODEL_ROOT` / `VSCODE_TRANSLATE_MODEL_EN_ZH` / `VSCODE_TRANSLATE_MODEL_ZH_EN`

3) 扩展侧后端抽象
- `LocalTranslateServer` 支持根据 backend 选择启动命令/服务实现（或封装成两套启动器）。
- 保留 remote fallback。

4) 离线模型校验增强
- 复用/扩展 `vscode-translate.checkLocalModel`：区分 backend（python/node）并检查对应格式/文件集。

5) 文档与验收
- 文档明确：完全离线需要用户提供模型文件；给出目录结构示例与常见报错。

## 验收标准
- 用户无 Python 环境时，选择 `backend=node` 仍可本地翻译（en↔zh）。
- offline=true 时：不会触发模型下载；缺文件时给出明确错误提示。
- 扩展启动不阻塞；首次加载可稍慢但不会触发无穷重启。
- 多窗口下默认复用/不重复拉起（至少不明显重复占用）。

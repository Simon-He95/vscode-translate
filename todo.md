# 本地免费模型翻译（Local AI）接入 TODO

目标：在不依赖远程 API 的情况下，使用本地免费模型完成中英互译，并由 VS Code 扩展在启动时自动拉起本地推理服务；扩展退出/崩溃时尽可能优雅关闭服务，并在异常情况下可恢复。

> 现状速记（基于当前仓库）：
> - 扩展 `activationEvents` 为 `onStartupFinished`。
> - 入口在 `src/index.ts`，翻译通过 `@simon_he/translate` 的 `translateLoader()`。
> - `createExtension(..., deactivateCb)` 第二个回调可用于释放资源（现在仅 `cacheMap.clear()`）。
> - 当前 `package.json` 未声明 `contributes.configuration`，需要补齐本地服务相关配置。

---

## 1. 模型与运行时选型

### 1.1 推荐默认（MVP）
- **模型**：Helsinki-NLP OPUS-MT
  - `Helsinki-NLP/opus-mt-en-zh`（英->中）
  - `Helsinki-NLP/opus-mt-zh-en`（中->英）
- **理由**：体积相对小、CPU 可跑、效果对“代码词/短句”够用，工程接入简单。

### 1.2 备选
- **Argos Translate（Offline 纯本地）**：部署更“本地化”，包/语言对更新机制不同；效果一般但无大依赖。
- **NLLB / M2M100**：质量更强但模型大，CPU 体验差；更适合可选项而非默认。
- **Node 内嵌推理（如 transformers.js / onnxruntime-node）**：减少对 Python 的依赖，但包体/编译/跨平台复杂度明显上升。

### 1.3 关键约束（需要写进实现）
- VS Code 扩展**不能假设用户必有 Python**。
- 扩展市场分发不适合直接打包巨大的模型权重。
- 多窗口（多个 Extension Host）可能导致**重复启动多个模型进程**，必须有“单实例/共享实例”策略。

---

## 2. 架构方案（建议）

### 2.1 进程模式
- 扩展启动时：**spawn 本地翻译服务**（推荐 Python FastAPI/Flask）。
- 扩展调用翻译：HTTP 请求本地服务 `/translate`。
- 扩展退出（deactivate）：发送 shutdown，超时后 kill。

### 2.2 通信与发现
- 本地服务监听 `127.0.0.1`（默认），避免公网暴露。
- 端口策略：
  - 推荐：服务使用 `port=0` 让系统分配可用端口，服务启动后把实际端口打印到 stdout，扩展解析并缓存。
  - 备选：配置固定端口 + 启动前探测占用。
- **单实例策略（重要缺漏）**：
  - 方案 A：使用 lock file（globalStorage）+ 端口文件（port.json），新窗口优先复用已有服务。
  - 方案 B：每窗口单独起服务（实现简单但资源浪费，不推荐）。

### 2.3 生命周期管理（重要缺漏）
- 扩展需保存 `ChildProcess` 引用，并监听：
  - `exit`/`close`：记录原因并触发降级（fallback 到远程翻译或提示）。
  - `error`：同上。
- 关闭策略：
  - 优先调用 `/shutdown`（或发送 stdin 命令）让服务自行退出。
  - 超时（如 3s~10s）后：
    - macOS/Linux：`SIGTERM` -> `SIGKILL`
    - Windows：`taskkill /T /F`（需要 kill 进程树）

### 2.4 异常/崩溃处理
- Extension Host 崩溃时 `deactivate` **不一定可靠**：
  - 必须在服务侧实现“空闲超时自杀”（例如 N 分钟无请求自动退出）。
  - 或实现“心跳机制”：扩展定期 ping `/health`，服务若长时间收不到心跳也退出。

---

## 3. 配置设计（需要补齐到 contributes.configuration）

建议新增：
- `translate.useLocal`：boolean，默认 false
- `translate.local.autoStart`：boolean，默认 false（或 true，视产品取舍）
- `translate.local.url`：string，本地服务 URL（默认自动发现；允许用户手填）
- `translate.local.command`：string，启动命令（例如 `python -m vscode_translate_local_server --port 0`）
- `translate.local.pythonPath`：string，Python 路径（可选）
- `translate.local.model`：string（默认 opus-mt；允许用户改）
- `translate.local.idleTimeoutMs`：number（服务空闲退出阈值）
- `translate.local.startupTimeoutMs`：number（扩展等待服务就绪超时）
- `translate.local.maxRestart`：number（防止无限重启）

---

## 4. 本地服务实现 TODO（Python 示例）

1. 新增目录 `local_server/`（或 `server/`）：
   - `app.py` / `main.py`
   - `requirements.txt`
   - `README.md`（说明如何安装/启动/下载模型）
2. HTTP API：
   - `GET /health`：返回版本、加载模型状态、当前模型名、uptime
   - `POST /translate`：`{ "texts": string[], "sourceLang": "en"|"zh", "targetLang": "en"|"zh" }`
   - `POST /shutdown`：优雅退出
3. 模型加载：
   - 首次启动自动下载权重（需明确缓存目录，如 `HF_HOME` / `TRANSFORMERS_CACHE`）
   - 支持通过环境变量或参数指定 cache 路径
4. 性能与并发：
   - 需要串行队列或限制并发，避免 hover 高频触发导致排队爆炸
   - 可加简单去重缓存（文本->翻译）
5. 日志：
   - 将“端口、就绪、错误”输出到 stdout 供扩展解析

---

## 5. 扩展侧接入 TODO

### 5.1 启动与复用
1. 读取配置：若 `useLocal && autoStart` 则尝试启动/复用服务。
2. 单实例复用：
   - 读 port 文件并先 `/health` 探活，成功则复用。
   - 失败才 spawn 新服务并写入 port 文件。
3. 启动握手：
   - spawn 后循环探测 `/health`（带超时）。
   - 超时后降级并提示用户（不要卡死 hover）。

### 5.2 翻译调用与降级
1. 优先使用本地 `/translate`。
2. 本地失败（超时/500/不可达）则：
   - fallback 到 `@simon_he/translate`（保持现有可用性）
   - 记录失败次数，达到阈值后暂时禁用本地并弹一次提示（避免刷屏）

### 5.3 关闭与清理
1. 在 deactivate 回调中：
   - 发送 `/shutdown`
   - 等待退出，超时 kill
2. 在进程异常退出时：
   - 清理 port/lock
   - 若启用自动重启：退避重启（例如 1s/2s/4s）+ 最大次数限制

### 5.4 多窗口与竞争条件（重要缺漏）
- lock file 需要包含 PID + port + timestamp。
- 写入采用原子方式（先写临时文件再 rename）。
- 若检测到“锁存在但服务不可达”，需要抢锁并覆盖。

---

## 6. 安全/隐私/合规注意事项

- 默认仅绑定 `127.0.0.1`。
- 明确说明：文本会发送到本机服务，不会出网（除首次下载模型）。
- 下载模型时：
  - 提供开关允许用户手动下载
  - 或提示用户将 cache 目录加入信任/代理配置

---

## 7. 测试与验收标准（建议补齐）

### 7.1 验收标准
- 扩展开启本地模式后：hover 触发翻译成功且不会明显卡顿。
- 扩展关闭/重载窗口：本地服务能在合理时间内退出（或空闲超时退出）。
- 端口冲突/服务不可用：能自动降级到远程翻译并提示一次。
- 多窗口：不会启动 N 份模型（默认复用 1 份）。

### 7.2 自动化测试（最小集成）
- 启动服务 -> `/health` 返回 ok -> `/translate` 返回数组长度一致 -> `/shutdown` 退出。
- 扩展侧可用最小单元测试：
  - 端口解析/探活/重试逻辑
  - kill 进程树逻辑（可用 mock）

---

## 8. MVP 交付顺序（建议）

1. `local_server/` + `/health` + `/translate`（opus-mt）
2. 扩展配置项 + 本地/远程切换 + 超时降级
3. 启动握手 + deactivate 关闭
4. 单实例复用（lock + port 文件）
5. 服务空闲自杀/心跳 + 重启退避
6. 文档与最小集成测试

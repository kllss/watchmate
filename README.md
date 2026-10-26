# 腕上搭档 WatchMate · REDMI Watch 6（Vela）

把 AI 助手装进 432×514 的手表。直连 WorkBuddy / DeepSeek / OpenAI / 智谱 / Ollama 等任意 OpenAI 兼容接口，或走本地桥接服务。自带**自绘中文键盘**（拼音候选 + 常用短语板），解决 Vela 没有文本输入框的硬伤。**大字号 + 图标 + 多级下钻**，专为小屏易读性设计。

> 本工程沿用 `game/`（DQ3 手表版）踩过的 Vela 编译器坑，规则沉淀见 [构建与模块验证](https://github.com/kllss/dq3-watch-vela/blob/main/docs/%E6%9E%84%E5%BB%BA%E4%B8%8E%E6%A8%A1%E5%9D%97%E9%AA%8C%E8%AF%81.md)。

---

## 三种运行模式

| 模式 | 说明 | 适用 |
|---|---|---|
| `demo` | 本地示例回答，不联网 | 真机验收 UI、无 Key 体验 |
| `direct` | 手表直接请求 OpenAI 兼容接口 | 服务商给公网 HTTPS 接口时 |
| `bridge` | 手表只请求自己的桥接服务，由桥接聚合多 API 再调模型 | 需要鉴权聚合、私有数据源、限流中转时 |

模式由构建时注入的 `config.local.json` 决定（默认 `direct`），运行期可在「设置」页切换。

---

## 页面（大字号 + 图标 + 多级）

| 页面 | 路径 | 职责 |
|---|---|---|
| Home | `/` | 栈底：大时间 + 状态胶囊 + 两个大图标入口（问 AI / 设置） |
| Ask | `/ask` | 二级入口「选个问题 / 自己写」→ 预设指令卡片 + 回答滚动 |
| Compose | `/compose` | 自绘键盘：拼音候选 + 常用短语板 → 输出问题到 Ask |
| Settings | `/settings` | 模式 / 服务商 / 连接测试 / 清缓存 |

> 图标用 PNG（`src/Common/icons/*.png`，由 `make-ui-icons.mjs` 生成）。**Vela 手表不渲染 emoji**，所有图标必须用图片，不能用 emoji 字符。

---

## 目录结构

```
watchmate/
├── src/
│   ├── manifest.json         包名 com.klls.watchmate
│   ├── app.ux
│   ├── config.gen.js         构建时生成（config 合并 + 环境变量展开后的产物）
│   ├── Common/icons/         UI 小图标 PNG（chat/gear/keyboard/back/refresh）
│   ├── core/                 副作用模块，挂 globalThis.__wm（禁 export）
│   │   ├── boot.js           唯一入口，按序加载
│   │   ├── config.js         配置读取 / provider 选择 / baseUrl 拼装
│   │   ├── http.js           system.fetch 封装：超时、JSON、状态码映射
│   │   ├── api.js            demo/direct/bridge 三模式统一调用面
│   │   ├── ime.js + ime-data.js   拼音候选 + 常用短语词表
│   │   ├── format.js         去 Markdown / 数值分组 / pickPath / 错误文案
│   │   ├── save.js           system.storage 封装（读写 + 哨兵校验）
│   │   └── store.js          缓存回答 / 设置 / lastError
│   └── pages/{Home,Ask,Compose,Settings}/index.ux
├── bridge/                  零依赖 Node 桥接服务
│   ├── server.mjs            /v1/ask /v1/chat /api/prompts /health
│   ├── config.default.json
│   └── test/server.test.mjs
├── test/core.test.mjs       核心逻辑单测（Node 侧跑）
├── build.mjs                构建：config 合并 → 环境变量展开 → 调 aiot-toolkit → bundle 校验
├── config.default.json      默认配置（不含密钥）
├── make-icon.mjs            生成应用图标
├── make-ui-icons.mjs        生成 UI 小图标 PNG
└── lib/png-icon.mjs
```

---

## 构建

```bash
# 1) 工具链路径（指向你本机的 aiot-toolkit）
export AIOT_TOOLKIT_BIN="/path/to/aiot-toolkit/lib/bin.js"

# 2) （可选）本地配置覆盖：复制后改 baseUrl / apiKey / model
cp config.default.json config.local.json

# 3) 构建
node build.mjs
```

产物：`dist/watchmate-0.1.0.rpk`。

### 密钥注入（不写进仓库）

配置文件里用 `${ENV_NAME}` 占位，构建时从环境变量展开：

```json
{ "apiKey": "${WORKBUDDY_KEY}" }
```

```bash
WORKBUDDY_KEY=sk-xxx node build.mjs
```

---

## 配置要点

- **`mode`**：`demo` / `direct` / `bridge`。
- **`providers[]`**：每个服务商 `baseUrl` + `chatPath`（默认 `/chat/completions`）+ `model` + `apiKey`。已内置 WorkBuddy / DeepSeek / OpenAI / Moonshot / 智谱 / Ollama 六个模板。
- **`bridge`**：`url` / `token` / `timeoutMs`，仅 bridge 模式用。
- **`prompts[]`**：Ask 页的预设指令（`id/label/hint/text`）。
- **`request`**：`maxTokens/temperature/maxChars/systemPrompt`（系统提示强制短回答）。

---

## 桥接服务

```bash
cd bridge
cp config.default.json config.local.json   # 填 provider 与 bridgeToken
node server.mjs                             # 默认 127.0.0.1:8787
```

| 路由 | 说明 |
|---|---|
| `GET /health` | 带 `Authorization: Bearer <token>`，报告 provider/模型 |
| `GET /api/prompts` | 下发预设指令（不泄露模板正文） |
| `POST /v1/ask` | 配方式问答（先拼数据源再调模型） |
| `POST /v1/chat` | 自由文本问答 |

手表 `bridge.url` 指向桥接地址即可（真机需用局域网 IP 或内网穿透）。

---

## 测试

```bash
node test/core.test.mjs          # 核心逻辑 14 项
node bridge/test/server.test.mjs # 桥接协议 8 项
```

---

## 真机验收清单

见 `docs/真机验收清单.md`。

## 架构与设计约束

见 `docs/架构.md`。


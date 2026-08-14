# Sub-Store Scripts

一套围绕 **Sub-Store + Mihomo / Clash.Meta** 的配置模板、文件操作脚本、自定义规则和管理工具。

核心目标是：**只维护一套基础 Mihomo 模板，通过 URL 参数动态选择主订阅、Landing、运行模式、策略组名称等，生成不同客户端需要的完整配置。**

---

## 目录

- [项目结构](#项目结构)
- [核心工作流](#核心工作流)
- [快速开始](#快速开始)
- [config-builder.js](#config-builderjs)
- [URL 参数](#url-参数)
- [sub 主节点来源](#sub-主节点来源)
- [Landing 链式代理](#landing-链式代理)
- [root_group_name](#root_group_name)
- [mihomo_mode](#mihomo_mode)
- [Profile 与 DNS](#profile-与-dns)
- [自定义规则](#自定义规则)
- [节点重命名脚本](#节点重命名脚本)
- [Sub-Store Manager Skill](#sub-store-manager-skill)
- [Bootstrap](#bootstrap)
- [典型 URL 示例](#典型-url-示例)
- [设计原则](#设计原则)

---

## 项目结构

```text
sub-store-scripts/
├── README.md
├── .gitignore
│
├── templates/
│   └── mihomo-base.yaml
│
├── mihomo/
│   ├── config-builder.js
│   └── inject-custom-rules.js
│
├── rules/
│   ├── custom-direct.yaml
│   ├── custom-proxy.yaml
│   └── custom-reject.yaml
│
├── rename-proxies.js
│
├── bootstrap/
│   ├── .env.example
│   └── bootstrap.py
│
└── skills/
    └── substore-manager/
        ├── SKILL.md
        ├── .env.example
        └── scripts/
            └── substore.py
```

### 文件说明

| 文件 | 作用 |
| --- | --- |
| `templates/mihomo-base.yaml` | Mihomo 基础配置模板。提供端口、DNS、TUN、策略组、规则等基础结构，节点由脚本动态注入。 |
| `mihomo/config-builder.js` | **核心文件操作脚本**。读取 `sub` 主节点来源、可选 Landing，处理 `dialer-proxy`、Root Group、Global 模式、Profile、DNS 和可选自定义 Rule Provider。 |
| `mihomo/inject-custom-rules.js` | 独立的自定义规则注入脚本。适合在已有完整 Mihomo 文件基础上再次注入 custom rules。 |
| `rules/custom-direct.yaml` | 强制直连规则。 |
| `rules/custom-proxy.yaml` | 强制代理规则。 |
| `rules/custom-reject.yaml` | 强制拒绝规则。 |
| `rename-proxies.js` | Sub-Store 节点重命名/规范化脚本，用于统一节点名称并附加订阅相关信息。 |
| `bootstrap/.env.example` | 新 Sub-Store 实例初始化工具的环境变量示例。 |
| `bootstrap/bootstrap.py` | 新实例 Bootstrap 骨架。目前主要用于连接检查、结构预览和后续自动化初始化扩展。 |
| `skills/substore-manager/SKILL.md` | Sub-Store Manager Skill 的使用说明和 Agent 指令。 |
| `skills/substore-manager/.env.example` | Skill 连接 Sub-Store 所需环境变量示例。 |
| `skills/substore-manager/scripts/substore.py` | Skill 实际调用 Sub-Store API 的辅助脚本，可用于查询订阅、合集、文件和生成可复制链接等。 |
| `.gitignore` | 排除本地 `.env` 等不应提交的敏感配置。 |

---

## 核心工作流

推荐结构：

```text
Sub-Store Subscription / Collection
              │
              │ sub=xxx
              ▼
      templates/mihomo-base.yaml
              │
              ▼
      mihomo/config-builder.js
              │
       ┌──────┴──────┐
       │             │
   主节点来源     Landing（可选）
       │             │
       └──────┬──────┘
              ▼
       完整 Mihomo 配置
              │
              ▼
      Mihomo / Clash.Meta 客户端
```

`config-builder.js` 不绑定具体机场名称。主节点来源通过 `sub` 参数指定，Landing 通过 `landing` 参数指定。

---

## 快速开始

### 1. 在 Sub-Store 添加订阅

例如：

```text
机场A
机场B
oracle-sg-1
```

也可以创建组合订阅：

```text
机场合集
├── 机场A
└── 机场B
```

### 2. 创建 Mihomo 文件

在 Sub-Store 的文件功能中创建一个 Mihomo 文件，并使用：

```text
templates/mihomo-base.yaml
```

作为基础模板。

### 3. 添加文件操作脚本

使用：

```text
mihomo/config-builder.js
```

作为文件操作脚本。

### 4. 分享文件

生成 Sub-Store 文件分享 URL，并至少传入：

```text
sub=你的订阅或组合订阅名称
```

例如：

```text
/share/file/mihomo?sub=机场合集
```

> `sub` 是必填参数。脚本本身不再写死任何具体机场或组合订阅名称。

---

## config-builder.js

这是本仓库的核心 Mihomo 配置构建器。

它主要负责：

1. 读取 URL / Script Arguments 参数。
2. 根据 `sub` 获取主节点。
3. 根据 `landing` 获取可选 Landing 节点。
4. 合并模板和主订阅节点。
5. 在 Landing 模式下建立 `dialer-proxy` 链式代理。
6. 建立最终 Root Group。
7. 根据 `mihomo_mode` 设置 Rule / Global / Direct。
8. 修正 Mihomo Global 模式默认策略组。
9. 根据 `profile` 和 `dns` 修改运行环境配置。
10. 可选注入自定义 Rule Provider。

---

## URL 参数

参数名称匹配**大小写不敏感**。

建议统一使用 snake_case。

| 参数 | 必填 | 示例 | 说明 |
| --- | --- | --- | --- |
| `sub` | 是 | `sub=机场合集` | 主节点来源。优先匹配 Collection，找不到再匹配 Subscription。 |
| `landing` | 否 | `landing=oracle-sg-1` | Landing 订阅。未传或 `none` 表示禁用 Landing。支持多个订阅逗号分隔。 |
| `root_group_name` | 否 | `root_group_name=🚀 香港代理` | 最终 Root Group 名称。默认 `🚀 节点选择`。 |
| `mihomo_mode` | 否 | `mihomo_mode=global` | Mihomo 模式：`rule` / `global` / `direct`。 |
| `profile` | 否 | `profile=phone` | 环境预设：`default` / `home` / `router` / `phone`。 |
| `dns` | 否 | `dns=global` | DNS 预设：`default` / `cn` / `global` / `off`。 |
| `rule_provider_base` | 否 | `rule_provider_base=https://.../rules` | 自定义规则文件的基础 URL。设置后启用 custom-direct / proxy / reject。 |

部分参数同时兼容 camelCase，例如：

```text
rootGroupName
mihomoMode
ruleProviderBase
```

但推荐新链接统一使用：

```text
root_group_name
mihomo_mode
rule_provider_base
```

---

## sub 主节点来源

`sub` 是必填参数。

例如：

```text
?sub=机场合集
```

脚本会按照以下顺序解析：

```text
sub=xxx
   │
   ├─ 1. 查找 Collection: xxx
   │       └─ 找到有效节点 → 使用
   │
   └─ 2. 查找 Subscription: xxx
           └─ 找到有效节点 → 使用

两者都不存在 / 没有有效节点 → 报错
```

因此同一个参数既可以使用组合订阅：

```text
?sub=机场合集
```

也可以直接使用单个机场：

```text
?sub=机场A
```

如果 Collection 和 Subscription 恰好同名，**Collection 优先**。

---

## Landing 链式代理

Landing 是可选功能。

### 不使用 Landing

以下两种写法等价：

```text
?sub=机场合集
```

```text
?sub=机场合集&landing=none
```

此时主机场节点直接作为代理出口。

### 使用 Landing

例如：

```text
?sub=机场合集&landing=oracle-sg-1
```

`landing` 的值代表 **Sub-Store Subscription 名称**。

脚本读取该订阅中的所有节点，并给 Landing 节点设置：

```yaml
dialer-proxy: 🚀 手动选择
```

形成：

```text
客户端
  ↓
Root Group
  ↓
Landing
  ↓ dialer-proxy
🚀 手动选择
  ↓
机场节点
  ↓
Internet
```

### 多个 Landing 订阅

支持逗号分隔：

```text
?sub=机场合集&landing=oracle-sg-1,oracle-jp-1
```

脚本会合并两个订阅中的 Landing 节点。

只要指定的某个 Landing 订阅不存在或没有有效节点，生成过程就会直接失败，避免意外退化成直出。

---

## root_group_name

默认 Root Group：

```text
🚀 节点选择
```

可以覆盖：

```text
?sub=机场合集&root_group_name=🇸🇬 新加坡代理
```

### 无 Landing

结构大致为：

```text
🇸🇬 新加坡代理
├── 机场节点 A
├── 机场节点 B
└── ...
```

### 有 Landing

结构为：

```text
🇸🇬 新加坡代理
├── Landing A
├── Landing B
└── 🚀 手动选择
      ├── 机场节点 A
      ├── 机场节点 B
      └── ...
```

其中 Landing 通过 `dialer-proxy` 使用 `🚀 手动选择` 中选择的机场节点建立连接。

---

## mihomo_mode

支持：

```text
rule
global
direct
```

例如：

```text
?sub=机场合集&mihomo_mode=global
```

脚本不仅会设置：

```yaml
mode: global
```

还会处理 Mihomo 的 `GLOBAL` 策略组，使其固定指向最终 `root_group_name`，避免客户端进入 Global 模式后默认选择 `DIRECT`。

结构类似：

```text
GLOBAL
  ↓
root_group_name
  ↓
实际代理策略
```

客户端仍然可以在本地手动切换运行模式；URL 参数控制的是配置加载时的默认值。

---

## Profile 与 DNS

### profile=home

```text
allow-lan = true
默认 DNS = cn
```

### profile=router

```text
allow-lan = true
bind-address = *
默认 DNS = cn
```

### profile=phone

```text
allow-lan = false
默认 DNS = global
```

如果同时显式传入 `dns`，则 `dns` 优先。

例如：

```text
?sub=机场合集&profile=phone&dns=cn
```

### DNS 参数

```text
dns=default
dns=cn
dns=global
dns=off
```

`default` 表示保持模板中的 DNS 配置。

---

## 自定义规则

仓库包含：

```text
rules/
├── custom-direct.yaml
├── custom-proxy.yaml
└── custom-reject.yaml
```

语义分别为：

```text
custom-direct  → DIRECT
custom-proxy   → root_group_name
custom-reject  → REJECT
```

### 方式一：config-builder.js 直接注入

传入：

```text
rule_provider_base=https://你的规则目录
```

脚本会生成对应 `rule-providers`，并把规则放在现有规则前面：

```text
custom-reject
custom-proxy
custom-direct
原有规则...
```

这样自定义规则拥有更高优先级。

### 方式二：独立 inject-custom-rules.js

如果已经有一个完整 Mihomo 文件，只希望在其基础上增加规则，可以使用：

```text
mihomo/inject-custom-rules.js
```

这适合：

```text
已有 Mihomo 配置
       ↓
inject-custom-rules.js
       ↓
增加自定义规则后的配置
```

---

## 节点重命名脚本

根目录：

```text
rename-proxies.js
```

用于 Sub-Store Subscription / Collection 的节点处理流程。

主要用途包括：

- 规范节点名称。
- 给不同订阅节点增加可识别前缀。
- 提取订阅信息。
- 在节点列表中展示到期时间等辅助信息。

它与 `config-builder.js` 是独立的：

```text
Subscription 节点处理
        ↓
rename-proxies.js
        ↓
标准化后的节点
        ↓
Collection / config-builder.js
```

---

## Sub-Store Manager Skill

目录：

```text
skills/substore-manager/
```

这是用于让 AI Agent / Skill 管理 Sub-Store 的辅助工具。

结构：

```text
skills/substore-manager/
├── SKILL.md
├── .env.example
└── scripts/
    └── substore.py
```

### 配置

复制环境变量：

```bash
cp skills/substore-manager/.env.example skills/substore-manager/.env
```

然后填写自己的 Sub-Store 地址和密钥。

**不要把真实 `.env` 提交到 GitHub。**

Skill 可以围绕 Sub-Store API 提供订阅、组合订阅、文件以及分享链接管理能力。

---

## Bootstrap

目录：

```text
bootstrap/
├── .env.example
└── bootstrap.py
```

目标是让一个新部署的 Sub-Store 实例快速获得本仓库需要的基础结构。

当前版本以安全模式为主：

```bash
cp bootstrap/.env.example bootstrap/.env
nano bootstrap/.env
python3 bootstrap/bootstrap.py
```

默认执行 Dry Run：

```text
读取配置
→ 检查 Sub-Store API
→ 显示计划结构
→ 不写入数据
```

未来可以继续扩展 `--apply`，通过实际 Sub-Store API 自动创建文件、模板和其他基础资源。

> 注意：现在 `config-builder.js` 的 `sub` 已经是必填参数，因此 Bootstrap 不需要再假设所有实例都必须存在一个叫「机场合集」的 Collection。

---

## 典型 URL 示例

### 单个机场

```text
/share/file/mihomo?sub=机场A
```

### 机场合集

```text
/share/file/mihomo?sub=机场合集
```

### 机场合集 + Landing

```text
/share/file/mihomo?sub=机场合集&landing=oracle-sg-1
```

### 多 Landing

```text
/share/file/mihomo?sub=机场合集&landing=oracle-sg-1,oracle-jp-1
```

### Global + Landing

```text
/share/file/mihomo?sub=机场合集&landing=oracle-sg-1&mihomo_mode=global
```

### 自定义 Root Group

```text
/share/file/mihomo?sub=机场合集&landing=oracle-sg-1&root_group_name=🚀 新加坡代理
```

### 手机 Profile

```text
/share/file/mihomo?sub=机场合集&profile=phone
```

### 完整组合

```text
/share/file/mihomo?sub=机场合集&landing=oracle-sg-1&root_group_name=🚀 新加坡代理&mihomo_mode=global&profile=phone&dns=global
```

实际使用 URL 时，如果参数值包含空格、Emoji、中文或特殊字符，建议由浏览器/客户端进行 URL Encode。

---

## 设计原则

### 1. 配置与数据解耦

脚本不写死具体机场名称。

```text
sub=xxx
landing=xxx
```

决定实际使用哪个 Sub-Store 资源。

### 2. Landing 默认关闭

不传 `landing` 就不会启用链式代理。

必须显式指定：

```text
landing=xxx
```

才会启用。

### 3. Landing Fail Closed

显式指定 Landing 后，如果对应订阅不存在或没有有效节点，直接报错。

不会静默退化成：

```text
机场 → 直接出站
```

### 4. 一个模板，多种客户端配置

通过 URL 参数复用同一个 Mihomo 文件：

```text
同一个模板
   ├── 手机
   ├── 家庭设备
   ├── 路由器
   ├── Rule
   ├── Global
   ├── 无 Landing
   └── 不同 Landing
```

不需要为每一种组合维护一份 YAML。

### 5. GitHub 作为配置代码仓库

模板、脚本、规则和 Skill 全部版本化：

```text
Sub-Store = 数据和配置编排
GitHub    = 模板 / 脚本 / 规则 / 工具的 Source of Truth
Mihomo    = 最终运行端
```

---

## 安全建议

- 不要把机场订阅 URL 提交到公开仓库。
- 不要提交真实 `.env`。
- 不要在脚本里硬编码 Sub-Store API Key。
- Sub-Store 管理 API 建议只通过可信网络、反向代理认证或 Tailscale 等方式访问。
- 对外分享的配置 URL 与管理 API 应尽量分离权限。

---

## License

当前仓库未声明开源许可证。若计划公开供他人复用，建议后续补充合适的 LICENSE。

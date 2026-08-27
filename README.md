# Creator Compass｜创作者罗盘

本地优先的 AI 创作者工作台，连接 IP 定位、内容策划、数据复盘与下一步行动。

*A local-first AI workspace connecting creator positioning, content planning, performance review, and next actions.*

当前版本包含：单机 Owner 初始化、一次性恢复码、定位访谈、三候选定位、创作方案、浏览器本地 OCR、复盘报告、可执行任务中心、素材使用记录、可归档的版本化报告、加密备份与安全恢复出厂、PWA 离线草稿、DeepSeek 结构化生成、离线中文向量 RAG 和本机知识治理后台。它不包含平台授权、自动抓取网页、短信、邮件、支付，也不会把开发示例当成真实案例。

任务中心支持应用内的今天／本周／全部日期视图、状态筛选、开始、完成、恢复、同日排序和最多 50 项原子批量操作；这些是用户打开应用后可见的行动提醒，不是邮件、系统推送或日历同步。素材库支持搜索、来源和保存时间、当前关联次数以及最近使用该素材的真实创作入口。报告记录默认展示当前报告，可切换已归档报告；归档只改变报告根状态，不删除历史版本、生成方式、引用依据或原业务入口，失败版本只在存在可重试 AI 运行时展示恢复入口。

## 本地首次启动

这台电脑已配置本地运行环境时，双击根目录的 `启动 Creator Compass.cmd` 即可启动数据库、网页、AI 工作进程与已安装的本地向量服务，并自动打开产品。双击 `停止 Creator Compass.cmd` 可完整停止本地运行环境。

首次打开会要求创建唯一的本机 Owner。没有配置 DeepSeek Key 时，资料、任务和非 AI 功能仍可使用，所有 AI 入口会明确提示先配置；产品不会用模拟结果冒充真实生成。`AI_ADAPTER=test` 只用于隔离自动化测试，不是用户功能。

前置条件：Node.js 22、pnpm 11、PostgreSQL 16。Windows 请使用 `pnpm.cmd`。本地语义检索另需 Python 3.11+；未安装时产品会明确降级为关键词检索，不影响其他功能。

```powershell
Copy-Item .env.example .env.local
pnpm.cmd install
pnpm.cmd db:up
pnpm.cmd db:migrate
pnpm.cmd db:seed
pnpm.cmd dev:all
```

首次安装本地中文语义检索：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-local-embedding.ps1
```

该脚本把 Python 环境和 `BAAI/bge-small-zh-v1.5` 模型放在 `C:\Temp\CreatorCompassRuntime`，不会写入 Git 仓库。重启产品后自动使用 512 维本地向量；模型离线时会保留真实的关键词降级状态。

`db:migrate`、`db:seed` 与 `worker` 会在本地自动读取 `.env.local`；容器环境仍优先使用外部注入的生产变量。

访问：

- 产品：http://localhost:3000
- 综合健康检查：http://localhost:3000/api/health
- 分项检查：`/api/health/web`、`/api/health/database`、`/api/health/worker`、`/api/health/storage`

开发种子只创建版本化提示词、待审核来源、内部规则和明确标记的 Demo 内容，不创建默认账号或虚假运营数据。首次启动后在 `/setup` 创建唯一 Owner；不存在可公开使用的“种子账号/密码”。

## DeepSeek 配置

登录后进入「我的 → DeepSeek 与 Token」，输入自己的 DeepSeek API Key 并勾选发送同意。系统会先实际测试连接，再用本机 AES-256-GCM 主密钥加密保存；页面只显示末四位、最近调用和本月 Token，不显示完整 Key。模型固定为 `deepseek-v4-flash`，不可切换其他供应商或模型。

主密钥默认写入 `./data/secrets/master.key`，可通过 `CREATOR_COMPASS_MASTER_KEY_PATH` 更改位置。备份数据库时不要把主密钥打包进公开仓库；恢复到新电脑需要同时恢复这一个文件，否则旧 Key 无法解密，只能重新填写。

## 当前能力边界

- 支持单机单 Owner、IP 定位、事前创作、数据复盘、任务/素材/报告记录，以及文件/文本入库、人工审核、显式 AI 发送授权和混合检索。
- 不支持平台 OAuth 授权或自动同步平台数据；平台账号只作为用户手动维护的标签。
- 不支持邮件提醒、浏览器推送、系统通知或日历同步；当前提醒仅存在于应用内任务日期与状态视图。
- 不支持在线支付、自动订阅或真实套餐购买。
- `/privacy` 与 `/terms` 当前是“发布前待运营主体确认的说明草案”，正式上线前必须补齐运营主体、联系方式、适用地区和生效日期并完成法律审查。

## 验证命令

```powershell
pnpm.cmd lint
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd build
pnpm.cmd build:worker
pnpm.cmd db:generate
```

完整发布验收必须使用隔离数据库和 fail-closed 脚本。脚本会从 0000 开始迁移、执行种子、构建 Web/worker，并用专用的生产模式服务执行 Playwright：

```powershell
$env:E2E_DATABASE_URL='postgresql://creator_compass:change-me@localhost:5432/creator_compass_e2e'
powershell -ExecutionPolicy Bypass -File scripts/verify-release.ps1
```

直接运行 Playwright 而未设置 `E2E_DATABASE_URL` 时，测试会被跳过；这不是发布通过证据。

## 常见问题

- `/api/health` 返回 503：检查数据库是否完成全部 19 个迁移、AI worker 是否在 45 秒内写入心跳、本地私有目录是否可访问。
- 登录后仍回欢迎页：先确认本机已经完成 `/setup`，再检查浏览器是否允许 HttpOnly Cookie。
- AI 显示未配置：进入「我的 → DeepSeek 与 Token」测试并保存 Key；若失败，检查 Key、网络和 DeepSeek 服务状态。
- OCR 识别较慢：OCR 在浏览器本地执行；原图默认不上传，首次加载语言包需要网络。
- Windows 拦截 `pnpm.ps1`：使用相同参数的 `pnpm.cmd`。
- 迁移冲突：不要重写已提交迁移；生成新迁移后运行 schema 与 migration 测试。

本机发布见 [本机运行与发布说明](docs/deployment.md)，备份与恢复演练见 [docs/backup-restore.md](docs/backup-restore.md)，安全问题报告方式见 [安全政策](SECURITY.md)。

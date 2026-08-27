# 本机运行与发布

Creator Compass 的发布目标是 Windows 本机单 Owner，不要求公网服务器。网页只监听 `127.0.0.1:3000`；数据库、私有文件、快照、主密钥和向量模型均保留在本机。仓库可以公开，真实 `.env.local`、运行数据和模型缓存不能提交。

## 1. 运行组成

- Next.js 网页与 pg-boss 工作进程：产品交互、DeepSeek 任务和知识入库。
- PostgreSQL 16：业务记录、队列和审计。
- 本地私有目录：上传文件与自动快照，使用原子写入。
- 可选 Python 向量服务：`BAAI/bge-small-zh-v1.5`，仅监听 `127.0.0.1:8765`。不可用时明确降级到关键词检索。

不需要 Mailpit、SMTP、MinIO、S3、Redis 或公网反向代理。

## 2. 本机配置

复制 `.env.example` 为 `.env.local`，至少配置：

- `DATABASE_URL`
- `AUTH_SECRET`：至少 32 字符
- `AI_LOG_HMAC_KEY`：与认证密钥不同的高熵值
- `APP_URL=http://127.0.0.1:3000`
- `EXPECTED_MIGRATION_COUNT=19`
- `LOCAL_STORAGE_PATH`、`LOCAL_SNAPSHOT_PATH`
- `CREATOR_COMPASS_MASTER_KEY_PATH`
- `POSTGRES_BIN_PATH`：`pg_dump`、`psql` 不在 PATH 时填写
- `EMBEDDING_SERVICE_URL=http://127.0.0.1:8765`
- `AI_ADAPTER=deepseek`

DeepSeek Key 不写环境变量。唯一 Owner 登录后在「我的 → DeepSeek 与 Token」测试并加密保存；模型固定为 `deepseek-v4-flash`。主密钥文件必须留在本机并与 Git 仓库分离。

## 3. 一键启动

双击 `启动 Creator Compass.cmd`，或运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-local-product.ps1
```

脚本会启动本地 PostgreSQL、执行迁移与种子、构建缺失产物、启动网页和 worker，并等待 `/api/health` 通过。停止时双击 `停止 Creator Compass.cmd`。

本地中文语义检索首次安装：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-local-embedding.ps1
```

模型与 Python 虚拟环境写入 `C:\Temp\CreatorCompassRuntime`。安装失败不会阻断产品，知识检索会显示关键词降级状态。

## 4. 数据与隐私边界

- 私有文件不进入 `public/`，下载接口重新校验 Owner。
- 知识来源与切片必须分别审核；来源还需勾选“允许发送给 DeepSeek”。
- 普通知识入库不调用 DeepSeek，本地完成标签、切片和向量化。
- 加密备份不包含登录密码、会话、恢复码、主密钥和 DeepSeek Key。
- 恢复成功后必须重新填写 DeepSeek Key。
- 恢复出厂只删除产品数据、私有文件和快照，不删除程序与向量模型缓存。

## 5. GitHub 发布门槛

提交前确认 `.env.local`、`data/`、模型、日志和构建缓存都被忽略，然后执行：

```powershell
pnpm.cmd lint
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd build
pnpm.cmd build:worker
```

完整 E2E 必须使用名称以 `_e2e`、`_test` 或 `_testing` 结尾的独立 PostgreSQL 数据库：

```powershell
$env:E2E_DATABASE_URL='postgresql://creator_compass:<password>@127.0.0.1:5432/creator_compass_e2e'
powershell -ExecutionPolicy Bypass -File scripts/verify-release.ps1
```

验证脚本会清空 `drizzle` 迁移账本与该测试库的 `public` schema，从 0000 重新迁移，并在专用的 Playwright 服务 `http://localhost:3101` 上执行真实流程。没有 E2E 数据库时不得把跳过测试描述成发布通过。

## 6. GitHub 仓库边界

公开仓库只包含源码、迁移、测试、说明和无秘密的示例配置。发布前运行仓库内的秘密扫描契约；如果 Key 曾经出现在聊天、终端输出或文件历史中，应先在 DeepSeek 控制台轮换，再发布代码。

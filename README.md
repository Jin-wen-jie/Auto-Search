# AI 商品公开链接比价后台

面向单一管理员的后台系统，用于调查公开网络中的 AI 数字商品，自动发现并人工审核后生成价格榜和货源榜。

## 技术栈

- **pnpm** TypeScript 单仓库
- **Next.js 16** + React 19 管理后台
- **PostgreSQL 17** + Drizzle ORM
- **pg-boss** 持久任务队列
- Node.js worker + Fastify validator
- Windows 本机 PostgreSQL 开发，Docker Compose 仅用于可选服务器部署

## 项目结构

```text
apps/
  web/          Next.js 管理后台（唯一管理员认证、候选审核、榜单、设置）
  worker/       后台 worker（来源发现、链接复检、任务调度）
  validator/    隔离 URL 验证器（SSRF 防护、商品信息抽取）
packages/
  domain/       纯函数（规格键、价格排名、货源排名）
  db/           Drizzle schema、迁移、管理员引导
  config/       环境变量与配置
tests/
  fixtures/     测试夹具（X/TG API 响应、商品页 HTML）
  e2e/          Playwright E2E 测试
```

## 本地启动

### 前置条件

- Node.js 24+
- pnpm 10.28+
- Windows 本机 PostgreSQL 17+（无需 Docker Desktop）

### 1. 确认 PostgreSQL 服务

```powershell
Get-Service *postgres*
Start-Service PostgreSQL  # 仅在服务未运行时执行；名称以 Get-Service 输出为准
```

首次使用时创建数据库。若 PostgreSQL 未加入 `PATH`，使用安装目录中的完整路径：

```powershell
$env:PGPASSWORD = "你的 postgres 密码"
& "C:\Program Files\PostgreSQL\17\bin\createdb.exe" -h localhost -U postgres compare
```

数据库已存在时不需要重复创建。

### 2. 配置本地环境

```powershell
Copy-Item .env.example apps/web/.env.local
$env:DATABASE_URL = "postgresql://postgres:你的密码@localhost:5432/compare"
```

同时把 `apps/web/.env.local` 中的 `DATABASE_URL` 改为相同连接串。本地配置已被 Git 忽略，不要提交真实密码或令牌。

### 3. 安装依赖

```bash
pnpm install
```

### 4. 运行已有数据库迁移

```bash
pnpm db:migrate
```

`pnpm db:generate` 只在修改 Drizzle schema、需要创建新迁移时执行，不属于日常启动步骤。

### 5. 启动开发服务器

```bash
pnpm dev
```

- Web 后台: http://localhost:3000
- Validator: http://localhost:3001

### 6. 首次登录

访问 http://localhost:3000/login，使用部署环境变量中的初始用户名和密码登录。首次登录后系统强制修改密码。

### 默认凭据（开发环境）

- 用户名: `owner`
- 密码: `CHANGE-ME-AT-FIRST-LOGIN`

## 外部凭据配置

### X (Twitter)

在 `.env` 或部署环境中设置:

```bash
X_BEARER_TOKEN=your-bearer-token
```

需要 X Developer App 的 Bearer Token 和相应 API 权限。

### Telegram

```bash
TELEGRAM_API_ID=your-api-id
TELEGRAM_API_HASH=your-api-hash
TELEGRAM_SESSION_STRING=your-encrypted-session
```

使用专用用户账号的 MTProto 会话进行公共内容搜索。

**缺少凭据时**：对应连接器显示为"未配置"，手工补链和其余功能保持可用。

## 测试

```bash
# 单元测试
pnpm test

# 类型检查
pnpm typecheck

# E2E 测试（需要先启动开发服务器）
pnpm test:e2e
```

## 备份与恢复（本机 PostgreSQL）

```powershell
$env:PGPASSWORD = "你的 postgres 密码"
& "C:\Program Files\PostgreSQL\17\bin\pg_dump.exe" -h localhost -U postgres -Fc -d compare -f backup.dump
```

恢复到空数据库：

```powershell
& "C:\Program Files\PostgreSQL\17\bin\createdb.exe" -h localhost -U postgres compare_restore
& "C:\Program Files\PostgreSQL\17\bin\pg_restore.exe" -h localhost -U postgres -d compare_restore backup.dump
```

## 免费公网部署

推荐使用 Vercel Hobby 托管持续可访问的 Web，Supabase 托管数据库，GitHub Actions 每小时启动一次有界采集任务。Render 和 Northflank 不再作为推荐的最终方案；下方 Docker Compose 仍保留为可选服务器部署方式。

### 1. 架构

- GitHub `main` -> Vercel Hobby Web：`main` 分支更新后构建并部署 Next.js 管理后台。
- Supabase PostgreSQL：同时供 Web 和采集任务读写持久数据。
- GitHub Actions `Hourly collection`：按小时启动临时 Validator，再运行 one-shot Worker，任务结束后两者随 job 退出。

### 2. 导入并配置 Vercel

1. 在 Vercel 新建项目，从 GitHub 仓库 `Jin-wen-jie/-` 导入。
2. 将 **Root Directory** 精确设置为 `apps/web`。
3. 启用 **Include source files outside of the Root Directory in the Build Step（构建时包含根目录之外的源文件）**，以便安装和构建工作区依赖。
4. 将 **Framework** 设置为 **Next.js**，然后按下方范围配置环境变量。

#### Vercel 环境变量

以下名称同时应用于 Production 和 Preview：

- `DATABASE_URL`
- `SESSION_SECRET`
- `ADMIN_INITIAL_USERNAME`
- `ADMIN_INITIAL_PASSWORD`

初始 username 建议使用 `owner`。Session Secret 和初始 password 应分别随机生成，所有真实值绝不写入仓库或日志。

### 3. 配置 GitHub Actions

#### Repository Secrets

在 GitHub 仓库的 Settings -> Secrets and variables -> Actions 中只新增以下 Repository Secrets 名称：

- `DATABASE_URL`
- `VALIDATOR_SHARED_TOKEN`

#### 采集计划与手动触发

- workflow cron 为 `0 * * * *`。GitHub 计划任务可能延迟，不保证整点启动。
- collect job 最长 30 分钟；Worker 最长运行 25 分钟，每次最多处理 50 个候选项 + 50 个货源链接，并发数 4。
- 需要立即采集或验证配置时，使用路径 `Actions -> Hourly collection -> Run workflow` 手动触发。

### 4. 首次部署顺序

先配置 GitHub Secrets 并手动运行成功，再导入并部署 Vercel：

1. 创建 Supabase 项目并取得数据库连接信息，只保存到平台的 Secret 配置中。
2. 添加 GitHub Repository Secrets，通过 `Actions -> Hourly collection -> Run workflow` 手动运行，确认迁移、初始化和采集成功。
3. 按上述设置导入 Vercel 项目，添加 Production 和 Preview 环境变量后部署。
4. 首次登录后立即修改初始密码。

### 5. 免费方案限制

- Vercel Hobby 不会因空闲休眠，但受免费额度和公平使用限制约束。
- Supabase 和 GitHub Actions 有各自的免费额度；超限或平台策略调整都可能影响可用性。
- 该起步方案无需银行卡，但不能承诺绝对 100% SLA；生产使用前应重新核对各平台的最新条款和配额。

## 可选服务器部署

下面的 Docker Compose 文件用于 Linux 服务器完整栈部署，不是本地开发依赖，也不需要安装 Docker Desktop。

### Docker Compose（Linux 服务器）

```bash
# 复制环境配置
cp .env.example .env
# 编辑 .env 填入真实凭据

# 构建并启动
docker compose up -d --build
```

服务端口：
- HTTPS: 443（Caddy 反向代理）
- Web 内部: 3000
- Validator 内部: 3001
- PostgreSQL 内部: 5432

### 数据库备份

```bash
docker compose exec postgres pg_dump -U postgres compare > backup.sql
```

### 恢复

```bash
docker compose exec -T postgres psql -U postgres compare < backup.sql
```

## 安全设计

- 唯一管理员账号：`admin_accounts` 表约束 `id = 1`，不提供注册
- 密码使用 Argon2id，初始密码一次性引导，重启不重置
- 会话 Cookie: `HttpOnly; Secure; SameSite=Strict`
- CSRF 防护：同步器令牌 + Origin 检查
- Validator SSRF 防护：阻断环回、私网、链路本地、CGNAT、组播地址
- 远端 HTML 只抽取文本，绝不渲染
- 外链 `target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"`
- 密钥和凭据不写入仓库或日志

## 不绕过限制

- 不绕过登录墙、验证码、robots.txt、403/401
- 不进入私人群组或获取私人凭据
- 不伪装用户代理绕过反爬
- 尊重 `Retry-After`、速率限制和平台频控

## 许可证

Private — 仅供授权管理员使用。

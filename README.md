# UNIKOYO 现金流预算 💰

一个**带登录、多用户、云端同步**的网页程序，用来管理公司**滚动式 6 个月现金流预算**。

核心思想（也是它要解决的问题）：
> 一笔突发支出**不应该**改写你整个预测。所以我们把预定预算**冻结**成一条“计划路径”，
> 突发支出用一笔提前准备好的**缓冲金（救火钱）**去吸收，让你随时看清
> **「计划 vs 实际」**的差距。每个用户**只能看到自己**的数据。

---

## 目录
1. [它能干什么](#它能干什么)
2. [技术栈](#技术栈)
3. [第一步：建 Supabase 项目](#第一步建-supabase-项目)
4. [第二步：跑数据库 SQL](#第二步跑数据库-sql)
5. [第三步：填环境变量](#第三步填环境变量)
6. [第四步：安装并运行](#第四步安装并运行)
7. [缓冲金算法怎么算](#缓冲金算法怎么算)
8. [想改东西，改哪里？](#想改东西改哪里)
9. [安全须知（很重要）](#安全须知很重要)
10. [常见问题](#常见问题)

---

## 它能干什么
- **登录/注册/重设密码**（邮箱 + 密码，基于 Supabase Auth）。
- **总览页**：当前月 + 之后 5 个月并排，自动算出期初、收入、支出、缓冲、突发、
  计划期末、实际期末、状态（绿=正常 / 黄=吃紧 / 红=赤字），下方还有实际期末折线图。
- **每月明细页**：三个明显分开的区块——预定收入、预定支出、突发 🔺。
  点格子直接改，随时加/删行，每行有备注。
- **设置页**：改参数、管理重复项目模板、导出/导入（Excel & JSON）、恢复已删记录。
- **新增下个月**：一键新建，自动带入重复模板，期初 = 上月实际期末。
- **软删除**：删掉的记录不真删，随时能在设置里恢复。

---

## 技术栈
- **React + Vite + TypeScript**（界面）
- **Tailwind CSS**（样式）
- **Supabase**：Auth（邮箱+密码）+ Postgres 数据库（云端存数据、RLS 做隔离）
- **@supabase/supabase-js v2**（连 Supabase）
- **react-router-dom**（页面路由 + 受保护路由）
- **xlsx (SheetJS)**（Excel 导出/导入）

---

## 第一步：建 Supabase 项目
1. 打开 <https://supabase.com>，注册/登录，点 **New project** 建一个新项目。
2. 记住你设的**数据库密码**（本程序其实用不到它，但 Supabase 建项目时会让你设）。
3. 项目建好后，进入项目主页。

## 第二步：跑数据库 SQL
1. 左侧菜单点 **SQL Editor** → **New query**。
2. 打开本仓库的 [`supabase/schema.sql`](./supabase/schema.sql)，把**整个文件内容**复制粘贴进去。
3. 点 **Run** 运行。它会：
   - 建三张表：`months`（月份）、`entries`（收支记录）、`recurring_templates`（重复模板）
   - 给每张表**开启 RLS（行级安全）**
   - 加上安全策略：**每个用户只能读写自己的数据**
4. 看到成功提示就建好了。这个脚本可以重复运行，不会报错。

> ⚠️ 金额字段一律是 `numeric(14,2)`（两位小数），**不是**普通浮点，避免出现
> `976.64000000000328` 这种误差。

## 第三步：填环境变量
1. 在 Supabase 项目里，点左下角 **Settings（齿轮）→ API**。
2. 复制两样东西：
   - **Project URL** → 对应 `VITE_SUPABASE_URL`
   - **Project API keys** 里的 **`anon` `public`** → 对应 `VITE_SUPABASE_ANON_KEY`
3. 在本项目根目录，把 [`.env.example`](./.env.example) **复制一份改名为 `.env`**，把上面两个值填进去：
   ```env
   VITE_SUPABASE_URL=https://你的项目编号.supabase.co
   VITE_SUPABASE_ANON_KEY=你的_anon_public_钥匙
   ```

> ⛔ **千万别**用 `service_role` 那把钥匙填到前端！它会绕过所有安全规则(RLS)。
> `.env` 已经被 `.gitignore` 挡住，不会被上传。

## 第四步：安装并运行
需要先装好 [Node.js](https://nodejs.org)（建议 18 以上）。然后在项目根目录：

```bash
npm install     # 装依赖（第一次会久一点）
npm run dev     # 启动开发服务器
```

终端会显示一个网址（通常是 <http://localhost:5173>），浏览器打开它。
第一次用：先**注册**一个账号 → 登录 → 去**设置**页「新增一个月」→ 再去**每月明细**填数据。

打包上线用：
```bash
npm run build   # 产出静态文件到 dist/
npm run preview # 本地预览打包结果
```

---

## 缓冲金算法怎么算
缓冲金 = 提前留出来**专门吸收突发支出**的一笔钱。全部计算都在
[`src/calc.ts`](./src/calc.ts)，每条公式都有大白话注释。核心几条：

```
预定收入合计 plannedIncomeTotal   = 收入区块里没被删的金额之和
预定支出合计 plannedExpenseTotal  = 支出区块里没被删的金额之和
突发支出合计 unexpectedTotal      = 突发区块里没被删的金额之和

预留缓冲 bufferSetAside =
   bufferMode = "fixed"   → 直接就是 bufferValue（固定金额）
   bufferMode = "percent" → 预定支出 × (bufferValue / 100)

计划期末（冻结）plannedClosing  = 计划期初 + 预定收入 − 预定支出   ← 不减突发！
实际期末       liveClosing      = 计划期末 − 突发支出
缓冲余额       bufferRemaining  = 预留缓冲 − 突发支出

状态 status:
   实际期末 < 安全线(safeThreshold)   → 赤字 Deficit（红）
   否则若 缓冲余额 < 0               → 吃紧 Tight（黄）
   否则                              → 正常 OK（绿）
```

**两条链（关键）**：
- **计划路径**：下个月的“计划期初” = 上个月的 `plannedClosing`（冻结，不受突发影响）。
- **实际路径**：下个月的“实际期初” = 上个月的 `liveClosing`（真实手里的钱）。
- 第一个月两条链的期初都用它自己的 `opening_balance`。

**把握度筛选**：总览页有个开关，勾上后把“暂定(Tentative)”的收入从实际余额里排除，
用来看“最保守情况下”的现金流。

---

## 想改东西，改哪里？
| 想改什么 | 改哪个文件 |
|---|---|
| 货币符号、缓冲金算法、安全线、分类清单等所有参数 | [`src/config.ts`](./src/config.ts)（或直接在**设置页**改，存本机浏览器） |
| 所有金额公式、状态判定、两条链的逻辑 | [`src/calc.ts`](./src/calc.ts) |
| 所有读写数据库的函数（getMonths / saveEntry 等） | [`src/lib/store.ts`](./src/lib/store.ts) |
| 连接 Supabase 的方式 | [`src/lib/supabase.ts`](./src/lib/supabase.ts) |
| 金额显示格式（负数红括号、千分位） | [`src/lib/money.ts`](./src/lib/money.ts) |
| 数据库表结构 | [`supabase/schema.sql`](./supabase/schema.sql) + [`src/types.ts`](./src/types.ts) |
| 三个界面 | `src/pages/Overview.tsx`、`MonthDetail.tsx`、`Settings.tsx` |

> **架构铁律**：组件里**绝不**直接查 Supabase，所有数据读写**一律**走 `src/lib/store.ts`。
> 这样以后想换数据库或改字段，基本只动这一个文件。

---

## 安全须知（很重要）
- ✅ 只用 `anon public` 钥匙；**绝不**在前端用 `service_role`。
- ✅ 数据库三张表**都开着 RLS**，每个用户只能碰自己的数据——**绝不关闭 RLS**。
- ✅ 删除都是**软删除**（`is_deleted` 标记），**绝不硬删除**，可随时恢复。
- ✅ 密钥放 `.env`（已被 `.gitignore` 忽略），**绝不**写死在代码里。
- ✅ 金额用 `numeric(14,2)`，前端固定两位小数，**绝不**用普通浮点直接算。

---

## 常见问题
**Q：打开就报“没找到 Supabase 环境变量”？**
A：你还没建 `.env` 或没填对。照[第三步](#第三步填环境变量)做，填完**重启** `npm run dev`。

**Q：注册后登录不了，提示“邮箱还没验证”？**
A：Supabase 默认要邮箱验证。去邮箱点确认链接；或在 Supabase 后台
Authentication → Providers → Email 里关掉 “Confirm email”（仅测试时）。

**Q：看不到别人的数据 / 别人看不到我的？**
A：这是**正常且预期**的——RLS 保证数据互相隔离，每人只看自己的。

**Q：导入会覆盖我现在的数据吗？**
A：不会。导入是“追加恢复”，会新建月份和记录。建议先导出留底。

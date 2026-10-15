# 靠近一点 · A Little Closer

一个给两个人的中文聊天小网站：分享邀请链接、实时文字聊天、同步趣味题卡。

基于 [shwosner/realtime-chat-supabase-react](https://github.com/shwosner/realtime-chat-supabase-react) 的 Supabase 消息加载、发送与实时订阅模式改造；重新实现双人房间、权限与界面。Apache-2.0，来源和修改记录见 [NOTICE](NOTICE)。36 道中文问题为本项目新写。

## 已实现

- 无需手机号或邮箱，使用 Supabase 匿名身份；每个房间最多两位成员。
- 随机邀请链接使用 URL fragment，邀请凭证不会进入普通 HTTP 请求路径。
- 文字消息、三类题卡实时同步，刷新后恢复同一浏览器的身份与房间。
- 双方同时点击“换个问题”只推进一次；显示“已加入”，不把成员身份误报为实时在线。
- 消息上限 1000 字，加载最近 200 条；断线重连和切回页面后补读。
- 数据库行级访问控制、反冒充校验；加入、发送、关闭共享行锁以处理竞争。
- 房间有效期 24 小时。任何成员均可结束房间，立即删除应用数据库里的聊天消息。
- 桌面与手机适配；无 Supabase 时提供显式本机体验入口。

## 本地启动

需要 Node.js 22.12+（本环境验证版本：24.19.0）。

```bash
cd /workspace/1
npm ci --cache /tmp/closer-npm-cache
npm run dev
```

没有配置时首页会说明正式聊天尚未连接。点击“先体验一下”，在同一浏览器的新标签页打开邀请链接可体验双人流程。体验数据在此浏览器 localStorage 中，身份在每个标签页的 sessionStorage 中。它不能让两个设备或两个浏览器互通，也不提供真正的私密数据隔离；不要放入真实敏感内容。清除网站数据可删除全部体验记录。

## 连接真实 Supabase（尚待项目配置）

使用一个新的、专属于本应用的 Supabase 项目，避免通用表名与其他应用冲突。

1. 在 Supabase 的 Authentication 设置中启用 **Anonymous Sign-Ins**。无需配置邮箱或 GitHub OAuth。
2. 在 SQL Editor 以管理员身份执行 [`supabase/schema.sql`](supabase/schema.sql)。它会创建表、函数、权限和实时订阅配置，可重复执行。
3. 在 Database → Extensions 启用 **pg_cron**，再执行 [`supabase/cleanup.sql`](supabase/cleanup.sql)。它每 10 分钟删除过期房间及其成员和消息；已关闭房间的无消息元数据保留至关闭一小时后清理。
4. 从项目的 API 设置取得项目 URL 和 **publishable key / legacy anon key**。将 `.env.example` 复制为 `.env`，设置：

   ```dotenv
   VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   VITE_SUPABASE_ANON_KEY=YOUR_PUBLIC_PUBLISHABLE_OR_ANON_KEY
   ```

   这两个值用于浏览器，不是管理员密钥。**不要填 service_role key 或 secret key**。Vite 会把 `VITE_` 值编入前端，改值后必须重启开发服务器或重新构建部署。
5. 重启 `npm run dev`。创建房间，将邀请发到另一台设备／另一个浏览器。正式模式同一浏览器的标签页会共享匿名身份，不算第二个人。

受限云环境需要允许访问实际的 `YOUR_PROJECT.supabase.co`（HTTPS 和 WSS）。项目 URL 确定前，未修改网络允许列表。正常网页浏览器的访问策略也必须允许连接该项目。

### 数据保留边界

过期后数据库会立即拒绝读取消息和继续发言；**物理删除依赖已经安装且正常运行的 cron 作业**。主动结束立即删除消息，房间与成员元数据随后按计划清理。Supabase Auth 的匿名用户不会随房间自动删除；提供商备份也有独立保留周期，不能把“清空消息”理解为抹除所有备份。匿名身份丢失（清除网站数据或换浏览器）后无法找回原成员席位，首版不支持账号恢复。

### 真实项目验收

完成配置后必须再做一次真实联调，本机体验与嵌入式数据库测试不能替代这一项：

- 两台设备加入同一房间，双向发消息、换题，双方实时看到更新。
- 第三个浏览器加入时被拒绝；非成员不能查询房间消息。
- 刷新、短暂断网再恢复后补齐当前消息；不会重复发出消息。
- 任一方结束后双方显示结束，消息表中该房间记录为零。
- 在 Supabase 检查清理作业最近执行结果，确认 `status = succeeded`：

  ```sql
  select jobid, jobname, schedule, active from cron.job where jobname='closer-room-cleanup';
  select d.status, d.return_message, d.start_time
  from cron.job_run_details d join cron.job j on j.jobid=d.jobid
  where j.jobname='closer-room-cleanup' order by d.start_time desc limit 5;
  ```

## 部署

前端为静态网站，可用 Netlify 或 Vercel，无需另建 Node 服务。

- 构建命令：`npm run build`
- 产物目录：`dist`
- 配置上面的两个 `VITE_` 环境变量，再触发构建。
- 使用 HTTPS，确保复制链接功能及浏览器身份／存储能力可用。
- 邀请使用根路径加 fragment，无需额外的 SPA 路由重写。

### GitHub Pages 自动部署

已添加 `.github/workflows/site.yml`，向 `main` 推送会运行数据库测试、构建和上传静态产物。

首次部署需要：

1. GitHub 仓库 Settings → Pages → Source 选择 **GitHub Actions**。
2. Settings → Secrets and variables → Actions → **Variables** 中设置 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`（浏览器公钥，绝不能使用 service_role/secret key）。
3. 完成上文 Supabase 数据库配置后，在 Actions 手动运行 **Check and deploy website**，或再次推送 `main`。

没有配置这两个变量时，自动部署会跳过，避免把体验模式误作为正式网站发布。仓库子路径由工作流的 `VITE_BASE_PATH` 自动设置。本地和 Netlify/Vercel 默认使用根路径。

当前未创建 Supabase 项目，也未验证真实托管部署。

## 测试

```bash
npm run build
npm test
npm run test:e2e
```

`npm test` 用 PGlite 的 PostgreSQL 引擎执行实际 `schema.sql`，验证 RLS、第三人拦截、冒充拒绝、同步题号、关闭清空、过期和级联清理，并检查 SQL 重复执行。它不验证 Supabase 托管 Auth、Realtime 和 pg_cron 服务。

浏览器测试用系统 Chromium，覆盖体验模式的双人消息、题卡同步、第三人拦截、刷新恢复、结束清空和手机布局。默认浏览器路径 `/usr/bin/chromium`；其他机器可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`。截图生成在忽略的 `test-results/`。

项目不包含 AI 出题、语音视频、好友系统或付费功能。

# react-convex-app

React + Convex 全栈开发项目。

## 技术栈

| 层 | 技术 | 版本 |
| --- | --- | --- |
| 前端框架 | React | 19.3.0 |
| 语言 | TypeScript | 6.0.3 |
| 构建/开发服务器 | Vite | 8.x |
| 后端/数据库 | Convex | 1.46.0 |
| 包管理器 | npm | 10.x |
| 版本控制 | Git | 2.x |

## 目录结构

```
react-convex-app/
├── convex/            # Convex 后端：schema、query/mutation/actions、生成的 .d.ts
├── public/            # 静态资源（构建时原样拷贝到 dist）
├── src/               # React 前端源码
│   ├── main.tsx       # 入口（createRoot + ConvexReactClient 挂载点）
│   └── App.tsx
├── index.html         # Vite 入口 HTML
├── vite.config.ts     # Vite 配置（React 插件，base './' 适配 GitHub Pages）
├── .github/workflows/ # GitHub Pages 部署 workflow
├── tsconfig*.json     # TypeScript 配置（app/node 两个 project）
├── .oxlintrc.json     # oxlint 配置（Vite 模板默认的快速 lint，lint 工具）
├── .prettierrc        # Prettier 配置
└── .env.local         # 本地环境变量（不提交到 Git）
```

## 依赖安装

```bash
npm install
```

## 前端启动

```bash
npm run dev
```

默认访问 http://localhost:5173。

## Convex 开发环境

```bash
npx convex dev
```

- 首次运行要求登录 Convex 账户（浏览器 OAuth），并选择项目名/区域来创建 dev 部署。
- 当前 CLI（1.46.x）的 dev 部署运行在 Convex 云端（本项目：
  `https://opulent-chickadee-561.convex.cloud`），代码改动由 `convex dev`
  自动热同步推送；没有 localhost:3847 本地进程。
- 登录与部署凭证由 CLI 写入 `.env.local`（`VITE_CONVEX_URL`、
  `CONVEX_DEPLOYMENT`、`VITE_CONVEX_SITE_URL`）。
- 发布到生产需要显式 `npx convex deploy --prod`（本项目尚未创建 prod 部署）。

## 代码检查和格式化

```bash
npm run lint           # oxlint（Vite 模板默认 lint 工具）
npm run format         # Prettier 格式化 src/
npm run format:check   # Prettier 只检查不修改
npm run build          # tsc -b && vite build
```

职责划分：TypeScript 负责类型检查，oxlint 负责代码规范与潜在错误，Prettier 只负责格式。

## 环境变量

- 本地配置写在 `.env.local`（已被 `.gitignore` 排除，**不要提交**）。
- 本地开发用的变量（CLI 写入）：`VITE_CONVEX_URL`、`CONVEX_DEPLOYMENT`、
  `VITE_CONVEX_SITE_URL`。
- CI 构建用的变量（GitHub 仓库变量，非 secret）：
  - `CONVEX_URL` — 线上前端要连接的 Convex 部署地址（建议为 prod 部署 URL），
    在仓库 Settings → Secrets and variables → Variables 中配置，
    workflow 构建时通过 `VITE_CONVEX_URL` 注入产物。
- 不要把 API 密钥、访问令牌写入源代码或提交到 Git。

## 部署到 GitHub Pages

工作流：`.github/workflows/deploy.yml`

```
push main → npm ci → npm run lint → npm run build → 校验 bundle 含 convex.cloud
          → 上传 dist → actions/deploy-pages 发布
```

一次性准备：

1. 仓库 Settings → Pages → Source 选 **GitHub Actions**。
2. 仓库 Settings → Secrets and variables → Variables 添加
   `CONVEX_URL`（值如 `https://<prod>.convex.cloud`）。
3. `git push` 到 `main` 后，在 Actions 标签页查看构建/部署状态；
   部署完成后访问 `https://l0v3lac3.github.io/rouvideo/`。

注意：前端产物在**构建时**固化后端地址；更换 Convex 部署后需重新触发构建。

## 当前尚未完成的事项

- `convex/schema.js` 尚无业务数据表（schema 为空，示例已注释）。
- `src/App.tsx` 尚未调用 Convex 后端函数（Provider 已接入，未使用 query/mutation）。
- `/hello` HTTP 路由已注册并推送成功，但经 Cloudflare 边缘实测返回 404
  （疑为 dev 部署边缘路由传播延迟或 region 差异；待部署稳定后复测）。
- 未创建生产（prod）部署，`npx convex deploy --prod` 需用户确认后执行；
  之后需在仓库变量 `CONVEX_URL` 中配置该部署地址。
- GitHub Pages 的一次性准备（仓库 Pages 源设为 GitHub Actions、
  添加仓库变量 `CONVEX_URL`）需在 GitHub 界面完成。
- 尚未进行首次 `git commit`（等待代码审查）。

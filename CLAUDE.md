# CLAUDE.md — 项目开发规则（供 Claude Code 及后续 AI 辅助开发使用）

## 工作规则

1. **修改前检查**：修改任何代码前，先读取并理解相关文件的现状，不要凭记忆或猜测改动。
2. **先计划后动手**：涉及多个文件的修改，先给出简短计划（改哪些文件、为什么），再执行。
3. **小步修改**：优先小步、可审查的改动；一次只改一个关注点，不要大范围重写。
4. **改后验证**：每次修改后运行相关检查（`npm run lint`、`npm run build`；涉及格式时 `npm run format:check`），如实汇报结果。
5. **不覆盖用户改动**：不要丢弃或覆盖用户已有的未提交修改；有冲突时先指出并询问。
6. **密钥安全**：API 密钥、token 等敏感信息只放 `.env.local` 或 Convex 环境变量；绝不写入源代码、日志或提交到 Git。
7. **生产安全**：未经用户明确确认，不执行 `convex deploy` 到生产、不删除云端数据、不修改生产配置。
8. **如实汇报**：汇报实际执行过的命令、通过/失败的真实检查结果，以及剩余未完成事项；未运行的检查不得声称已通过。

## 项目说明

rou.video 无广告播放器：静态 React 前端（GitHub Pages）+ Convex 后端（HTTP actions）。
上游要求浏览器 UA、响应被 PNG 包裹、且不返回 CORS 头，因此**抓取与解包必须在服务端**。

## 技术约定

- 前端：React 19 + TypeScript + Vite；入口 `src/main.tsx`，页面 `src/App.tsx`，
  播放器 `src/components/Player.tsx`，API 客户端 `src/lib/api.ts`。
- 后端：Convex（`convex/`）。路由在 `convex/http.ts`，纯逻辑在 `convex/rou.ts`，
  数据模型在 `convex/schema.ts`。`convex/_generated/` 是自动生成，**不可手改**。
- 连接方式：前端走 **HTTP actions**（`VITE_CONVEX_SITE_URL`，`.convex.site` 域），
  当前没有使用 `ConvexReactClient`；若将来引入 query/mutation 才需要它，并需
  `VITE_CONVEX_URL`（`.convex.cloud` 域）。两者是**不同的域名**，不要混用。
- 代码风格：Prettier（`.prettierrc`）；提交前运行 `npm run format`。
- 检查工具分工：tsc 查类型，oxlint 查规范与错误，Prettier 只管格式。
- 包管理器：npm（勿换成 yarn/pnpm）。

## 关键实现约束（改动前务必注意）

- **不要引入 TLS 指纹伪装库**（curl_cffi / impers / cycletls 等）：实测这些端点只校验
  UA，普通 `fetch` 即可通过，加指纹层是多余依赖。若将来真遇到指纹拦截，先实测确认再引入。
- **PNG 自定义块类型是 `roUd`（`0x726f5564`，大写 U）**，不是小写。写错会导致
  解包静默失败（返回原 PNG 字节）。
- **重写播放列表必须产出绝对地址**：前端在 GitHub Pages、后端在 Convex，两者跨域，
  根相对路径会被浏览器解析到页面所在域。origin 取自 `req.url`。
- **分片 URL 必须签名**（`ROU_PROXY_SECRET`，HMAC-SHA256）并在服务端校验，
  否则部署会变成公开代理。
- **媒体端点必须保留 SSRF 防护**（仅 https、拒绝私有/环回/link-local 地址）与
  域名白名单（`/api/resolve` 只允许 rou.video）。
- 解压用 `fflate`（`unzlibSync`）而非 Node `zlib`：Convex 运行时是 V8 isolate，
  HTTP action 里没有 Node 的 `zlib` 模块。
- 不要再把 Cookie 硬编码进代码：实测上游不需要 Cookie，原脚本里的那串已删除。

## 本地验证方式

```bash
npm run lint && npm run build                # 静态检查
python3 -c "..."                             # 或直接 curl 部署的 /api/selftest
curl -sS https://<deployment>.convex.site/api/selftest   # 运行时能力自检
```

改动后端后，除 `/api/selftest` 外建议实测：
`/api/resolve` → 取 `playlistUrl` → 确认分片地址为**绝对地址**且带签名 →
取一个分片确认返回的是 MPEG-TS（首字节 `0x47`）且长度与直连解包后一致。

浏览器内验证播放时注意：**隐藏标签页会节流 hls.js 的内部定时器**，表现为播放列表
已解析但永远不发分片请求；需要 `Page.bringToFront` 让标签页可见后再测。

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

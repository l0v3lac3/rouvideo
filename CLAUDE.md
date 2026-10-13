# CLAUDE.md — 项目开发规则（供 Claude Code 及后续 AI 辅助开发使用）

## 工作规则

1. **修改前检查**：修改任何代码前，先读取并理解相关文件的现状，不要凭记忆或猜测改动。
2. **先计划后动手**：涉及多个文件的修改，先给出简短计划（改哪些文件、为什么），再执行。
3. **小步修改**：优先小步、可审查的改动；一次只改一个关注点，不要大范围重写。
4. **改后验证**：每次修改后运行相关检查（`npm run lint`、`npm run build`；涉及格式时 `npm run format:check`），如实汇报结果。
5. **不覆盖用户改动**：不要丢弃或覆盖用户已有的未提交修改；有冲突时先指出并询问。
6. **密钥安全**：API 密钥、token 等敏感信息只放 `.env.local` 等被 gitignore 的文件；绝不写入源代码、日志或提交到 Git。
7. **生产安全**：未经用户明确确认，不执行 `convex deploy` 到生产、不删除云端数据、不修改生产配置。
8. **如实汇报**：汇报实际执行过的命令、通过/失败的真实检查结果，以及剩余未完成事项；未运行的检查不得声称已通过。

## 技术约定

- 前端：React 19 + TypeScript + Vite；入口 `src/main.tsx`。
- 后端：Convex（`convex/` 目录）。schema 定义在 `convex/schema.ts`；
  前后端共享类型由 Convex 自动生成（`convex/*` 下的 `.d.ts` 不可手改）。
- 连接方式：前端通过 `ConvexProvider`/`ConvexReactClient` 连接，
  地址来自 `.env.local` 的 `CONVEX_URL`。
- 代码风格：Prettier（`.prettierrc`）；提交前运行 `npm run format`。
- 检查工具分工：tsc 查类型，oxlint 查规范与错误（Vite 模板默认 lint 工具），Prettier 只管格式。
- 包管理器：npm（项目内使用 `package-lock.json`，勿换成 yarn/pnpm）。

<!-- convex-ai-start -->

This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read
`convex/_generated/ai/guidelines.md` first** for important guidelines on
how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running
`npx convex ai-files install`.

<!-- convex-ai-end -->

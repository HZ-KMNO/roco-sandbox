# 参与贡献

感谢你对洛克沙盘的关注！

## 如何贡献

### 报告 Bug

请使用 [Bug 报告模板](https://github.com/HZ-KMNO/roco-sandbox/issues/new?template=bug_report.md) 提交。

### 功能建议

请使用 [功能建议模板](https://github.com/HZ-KMNO/roco-sandbox/issues/new?template=feature_request.md) 提交。

### 提交代码

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/你的功能`
3. 提交改动：`git commit -m "feat: 描述"`
4. 推送：`git push origin feature/你的功能`
5. 创建 Pull Request

### 开发环境

```bash
git clone https://github.com/HZ-KMNO/roco-sandbox.git
cd roco-sandbox
npm install
npm run dev          # 前端开发（端口 1420）
npm run tauri dev    # 完整桌面应用
npx tsc --noEmit     # 类型检查
```

### 代码规范

- TypeScript strict 模式
- Tailwind CSS in JSX
- 中文 UI，英文代码
- 提交信息使用 conventional commits（`feat:` / `fix:` / `docs:` / `chore:`）

## 欢迎的贡献方向

- 特性边界 case 修复（~5% 未覆盖的特性）
- 更多精灵的推荐性格/个体/配招数据
- 教程内容修正和扩充
- 暗色模式 UI 优化
- 国际化（其他语言支持）

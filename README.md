# luo-platform

基于 Vue 3、TypeScript、Vite、Element Plus、Pinia、OpenLayers 和 Cesium 的任务规划平台。项目采用六边形架构（Ports and Adapters），业务核心与 UI、HTTP、地图引擎和实时通信解耦。

## 开发

```bash
npm install
npm run dev
```

提交前执行：

```bash
npm run lint
npm run build
```

## 目录

```text
src/
├── domain/                 # 领域实体、值对象和业务规则
├── ports/                  # 入站/出站端口契约
├── application/            # 用例编排
├── adapters/               # HTTP、地图、WebSocket 等技术适配器
├── infrastructure/         # 配置、客户端和组装根
├── presentation/           # Vue 页面、组件和 composables
├── stores/                 # 仅保存 UI 状态
└── styles/
```

详细的边界规则、错误处理、地图/实时通信约束和测试策略见 [六边形架构补充说明](docs/hexagonal-architecture.md)。开发时还必须遵守 [AGENTS.md](AGENTS.md) 中的依赖边界。

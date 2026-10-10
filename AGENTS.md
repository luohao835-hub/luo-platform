# AGENTS.md - Luo-Platform 开发与架构指南

本指南专为在 `luo-platform` 仓库上工作的 AI Coding Agent 及人类开发者制定。在阅读代码、生成新功能、重构或调试时，**必须严格遵守本指南定义的六边形架构原则与依赖边界**。

---

## 1. 项目概述与核心哲学

- **项目名称**: `luo-platform`
- **技术栈**: Vue 3 (Composition API / `<script setup>`) + TypeScript + Vite + Element Plus + Pinia + OpenLayers + Cesium
- **核心架构**: **严格六边形架构（Hexagonal Architecture / Ports and Adapters）**
- **设计哲学**: 
  - **业务核心与技术细节彻底解耦**：业务逻辑（任务规划、装备状态、态势计算）与视图框架（Vue）、网络驱动（Axios）、渲染引擎（OpenLayers/Cesium）互不绑定。
  - **依赖倒置原则（DIP）**：高层业务不依赖底层技术实现，两者统一依赖抽象端口（Ports）。
  - **静态边界守护**：所有架构约束均由 ESLint + TypeScript 强类型静态守护，禁止越级越界引用。

---

## 2. 目录结构与分层职责

```
src/
├── domain/                 # ① 业务核心层（纯 TS，最内层核心）
│   ├── equipment/          #   - 装备领域：装备实体、状态模型、载荷参数
│   ├── task/               #   - 任务领域：侦察/打击/巡逻子任务、状态流转
│   ├── mission/            #   - 作战任务规划领域
│   ├── target/             #   - 目标领域：敌我态势、属性分类
│   └── geometry/           #   - 几何与空间值对象：经纬度、多边形、航线
│
├── ports/                  # ② 端口契约层（纯抽象接口，定义系统所需能力）
│   ├── repositories/       #   - 仓储端口：TaskRepositoryPort, EquipmentRepoPort
│   ├── map/                #   - 地图能力端口：MapPort (渲染目标、航线绘制等)
│   ├── websocket/          #   - 实时消息推送端口
│   └── large-model/        #   - 态势大模型/算法端口
│
├── application/            # ③ 用例编排层（业务流程组织者）
│   ├── equipment/          #   - 装备用例：绑定装备、同步状态
│   ├── task/               #   - 任务用例：CreateReconnaissanceSubTask, CancelTask
│   ├── mission/            #   - 任务编排与协同用例
│   └── target/             #   - 目标管理与指派用例
│
├── adapters/               # ④ 适配器实现层（具体技术实现）
│   ├── http/               #   - HTTP 仓储实现（HttpTaskRepository，处理 DTO -> Domain 转换）
│   ├── map/                #   - 地图适配器（支持多引擎平滑切换）
│   │   ├── openlayers/     #     * OpenLayers 2D 地图实现
│   │   └── cesium/         #     * Cesium 3D 地球实现
│   ├── websocket/          #   - WebSocket 实时通信适配器
│   └── large-model/        #   - 大模型 API 对接适配器
│
├── infrastructure/         # ⑤ 基础设施层（底座支撑与组装根）
│   ├── config/             #   - 全局环境与接口配置
│   ├── http/               #   - Axios 基础客户端、拦截器封装
│   ├── websocket/          #   - WebSocket 底层连接重试、心跳
│   └── bootstrap/          #   - 依赖注入容器（container.ts），装配线与单例导出
│
├── presentation/           # ⑥ 表现层（Vue 3 UI）
│   ├── pages/              #   - 业务页面
│   ├── components/         #   - 业务组件（模态框、面板、操作栏）
│   ├── layouts/            #   - 页面布局骨架
│   └── composables/        #   - 桥接 Hooks（包装 Application UseCase 为响应式状态）
│
├── stores/                 # UI 状态（Pinia，仅限纯视图层状态）
├── router/                 # 路由定义
├── components/             # 通用纯展示型 UI 组件
├── styles/                 # 全局样式（Element Plus 覆盖、重置样式）
│
├── App.vue                 # 根组件
└── main.ts                 # 启动入口（Composition Root，注册插件与全局样式）
```

---

## 3. 架构依赖铁律（ESLint 强制检查）

项目中配置了严格的 `no-restricted-imports` ESLint 规则。在编写任何代码时，必须遵守以下单向依赖矩阵：

```
                    ┌───────────────────────────────┐
                    │  Presentation (Vue/UI/Store)  │ ◄─── 严禁直接依赖 Adapters 具体类
                    └──────────────┬────────────────┘
                                   │ 调用用例
                                   ▼
                    ┌───────────────────────────────┐
                    │   Application (Use Cases)     │ ◄─── 严禁依赖 Adapters/Infrastructure/Vue
                    └──────┬─────────────────┬──────┘
                           │                 │ 依赖抽象端口
                           ▼                 ▼
          ┌─────────────────────────┐  ┌─────────────┐
          │      Domain (核心)       │  │ Ports (契约) │ ◄─── 严禁依赖任何具体实现
          │ (纯TS，禁外部库及上层)  │  └──────▲──────┘
          └─────────────────────────┘         │ 依赖倒置实现
                                              │
                                   ┌──────────┴─────────────┐
                                   │ Adapters (具体实现)     │ ◄─── 严禁反向依赖 Application/UI
                                   │ (HTTP, Cesium, OL, WS) │
                                   └────────────────────────┘
```

### 详细依赖规则表

| 目录/分层 | 允许依赖的方向 | 严格禁止依赖（违规会被 Lint 阻断） |
| :--- | :--- | :--- |
| **`src/domain/**`** | 纯自闭环（同层 geometry / 纯工具算法） | **任何外层架构**（`application`, `ports`, `adapters`, `infrastructure`, `presentation`）以及**任何第三方库**（`vue`, `pinia`, `axios`, `element-plus`, `ol`, `cesium`）。 |
| **`src/ports/**`** | 纯接口定义，允许依赖 `domain` 模型 | `application`, `adapters`, `infrastructure`, `presentation`, `stores`, `vue`, `axios` 等具体库。 |
| **`src/application/**`** | 允许依赖 `domain`（实体/规则）与 `ports`（端口契约） | 严禁直接依赖 `adapters` 具体实现（必须通过端口）；严禁依赖 `presentation`, `stores`, `vue`, `element-plus`。 |
| **`src/adapters/**`** | 允许依赖 `ports`（实现契约）、`domain`（映射实体）、`infrastructure`（网络客户端/配置）及外部库（`axios`, `ol`, `cesium`） | 严禁反向依赖 `application` 用例、`presentation` 视图或 `stores` 全局状态。 |
| **`src/infrastructure/**`** | 通用通信封装；`bootstrap/container.ts` 作为组装根负责将 Adapters 组装注入到 Application | 严禁依赖 `presentation` 视图表现层或 `stores`。 |
| **`src/presentation/**`** | 允许依赖 `application`（执行用例）、`domain`（展示类型/实体属性）、`bootstrap`（获取实例）、Vue/Element Plus | **严禁直接依赖 `adapters` 具体适配器实现**（必须面向用例或容器调用，禁止跨层裸调）。 |

> **提示**：全局强制使用 `@/*` 路径别名（指向 `./src/*`）。禁止使用多层 `../../` 越界向上引用。

---

## 4. 标准业务开发链路范式

以新增 **侦察子任务（ReconnaissanceSubTask）** 为例，完整标准链路规范如下：

### ① Domain 层：纯业务实体与规则
```typescript
// src/domain/task/ReconnaissanceSubTask.ts
import type { Coordinate } from '@/domain/geometry/Coordinate';

export class ReconnaissanceSubTask {
  public readonly id?: string;
  public readonly name: string;
  public readonly targetId: string;
  public readonly area: Coordinate[];

  constructor(props: { id?: string; name: string; targetId: string; area: Coordinate[] }) {
    this.id = props.id;
    this.name = props.name;
    this.targetId = props.targetId;
    this.area = props.area;
    this.validate(); // 域内不变量自校验
  }

  private validate(): void {
    if (!this.name?.trim()) throw new Error('任务名称不能为空');
    if (!this.area || this.area.length < 3) throw new Error('侦察区域至少需要 3 个坐标点');
  }
}
```

### ② Ports 层：抽象端口契约
```typescript
// src/ports/repositories/TaskRepositoryPort.ts
import type { ReconnaissanceSubTask } from '@/domain/task/ReconnaissanceSubTask';

export interface TaskRepositoryPort {
  create(task: ReconnaissanceSubTask): Promise<ReconnaissanceSubTask>;
  findById(id: string): Promise<ReconnaissanceSubTask | null>;
}
```

### ③ Application 层：业务用例编排
```typescript
// src/application/task/CreateReconnaissanceSubTask.ts
import { ReconnaissanceSubTask } from '@/domain/task/ReconnaissanceSubTask';
import type { TaskRepositoryPort } from '@/ports/repositories/TaskRepositoryPort';
import type { Coordinate } from '@/domain/geometry/Coordinate';

export interface CreateCommand {
  name: string;
  targetId: string;
  area: Coordinate[];
}

export class CreateReconnaissanceSubTask {
  // 依赖注入端口，解耦具体技术实现
  constructor(private readonly taskRepo: TaskRepositoryPort) {}

  async execute(command: CreateCommand): Promise<ReconnaissanceSubTask> {
    const task = new ReconnaissanceSubTask(command);
    return await this.taskRepo.create(task);
  }
}
```

### ④ Adapters 层：具体技术适配与 DTO 转换
```typescript
// src/adapters/http/HttpTaskRepository.ts
import type { AxiosInstance } from 'axios';
import type { TaskRepositoryPort } from '@/ports/repositories/TaskRepositoryPort';
import { ReconnaissanceSubTask } from '@/domain/task/ReconnaissanceSubTask';

export class HttpTaskRepository implements TaskRepositoryPort {
  constructor(private readonly http: AxiosInstance) {}

  async create(task: ReconnaissanceSubTask): Promise<ReconnaissanceSubTask> {
    const payload = { task_name: task.name, target_id: task.targetId, polygon_points: task.area };
    const { data } = await this.http.post('/api/v1/tasks/reconnaissance', payload);
    return new ReconnaissanceSubTask({
      id: data.id,
      name: data.task_name,
      targetId: data.target_id,
      area: data.polygon_points,
    });
  }

  async findById(id: string): Promise<ReconnaissanceSubTask | null> { /* ... */ }
}
```

### ⑤ Infrastructure 层：组装根（IoC Bootstrap）
```typescript
// src/infrastructure/bootstrap/container.ts
import axios from 'axios';
import { HttpTaskRepository } from '@/adapters/http/HttpTaskRepository';
import { CreateReconnaissanceSubTask } from '@/application/task/CreateReconnaissanceSubTask';

const httpClient = axios.create({ baseURL: '/api', timeout: 10000 });
export const taskRepository = new HttpTaskRepository(httpClient);
export const createReconnaissanceSubTaskUseCase = new CreateReconnaissanceSubTask(taskRepository);
```

### ⑥ Presentation 层：Vue Composable 与组件
```typescript
// src/presentation/composables/useCreateReconnaissanceSubTask.ts
import { ref } from 'vue';
import { createReconnaissanceSubTaskUseCase } from '@/infrastructure/bootstrap/container';
import type { CreateCommand } from '@/application/task/CreateReconnaissanceSubTask';

export function useCreateReconnaissanceSubTask() {
  const loading = ref(false);
  const error = ref<string | null>(null);

  const execute = async (command: CreateCommand) => {
    loading.value = true;
    error.value = null;
    try {
      return await createReconnaissanceSubTaskUseCase.execute(command);
    } catch (err: any) {
      error.value = err.message;
      return null;
    } finally {
      loading.value = false;
    }
  };

  return { loading, error, execute };
}
```

---

## 5. Agent 编码守则与防踩坑指南

1. **地图双引擎（OpenLayers / Cesium）规范**：
   - 依赖中同时包含 `ol` 和 `cesium`。
   - 地图相关功能**必须**先在 `src/ports/map/MapPort.ts` 中定义通用抽象（例如 `drawPolygon`, `flyToCoordinates`, `toggleLayer`）。
   - 分别在 `src/adapters/map/openlayers/` 和 `src/adapters/map/cesium/` 中实现该端口。
   - 业务层与页面组件严禁直接引入 `ol/*` 或 `cesium/*` 的原生对象，保证 2D/3D 可随时无缝切换。

2. **错误处理边界**：
   - **Domain / Application 层**：只抛原生 JavaScript `Error`，只包含纯文本业务原因，严禁出现任何 UI 弹窗调用。
   - **Presentation 层**：在 Composable 或组件中捕获错误，调用 Element Plus 的 `ElMessage.error(msg)` 进行展示。

3. **状态管理分工（Domain vs Pinia）**：
   - **业务状态（如装备当前生命周期、任务进度）**：属于 Domain Entity。
   - **UI 状态（如当前选中的侧边栏 Tab、地图面板是否折叠、表格分页索引）**：放入 `src/stores/` (Pinia)。

4. **代码生成后的自检要求**：
   - 生成或修改代码后，**必须运行并确保两个命令全部通过**：
     ```bash
     npm run lint   # 确保无任何架构依赖越界或语法错误
     npm run build  # 确保 TypeScript 类型与打包完全通过
     ```

---

## 6. 常用命令清单

```bash
# 启动本地开发服务
npm run dev

# 执行 ESLint 静态代码分析与架构边界检查
npm run lint

# 自动修复可修复的 ESLint 格式问题
npm run lint:fix

# 执行 TypeScript 完整类型检查与 Vite 生产打包
npm run build
```

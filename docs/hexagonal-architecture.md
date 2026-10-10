# luo-platform 六边形架构补充说明

本文补充六边形架构在 `luo-platform` 中的落地规则。六边形不是固定的六个模块，也不是把文件平均分到六个目录；它要解决的是依赖方向和变化隔离问题。

## 1. 先明确边界

六边形架构的中心是业务能力，而不是 Vue、Axios、OpenLayers 或 Cesium。外部系统只能通过端口与中心交互：

```text
                 入站适配器（驱动系统）
       Vue / Router / WebSocket message handler
                              |
                      入站端口（用例）
                              |
                  Application + Domain Core
                              |
                      出站端口（被驱动）
                              |
       HTTP / WebSocket client / OpenLayers / Cesium
                 出站适配器（被核心驱动）
```

- **入站端口（Driving/Input Port）**：应用对外提供的用例接口，例如 `CreateReconnaissanceSubTaskPort`。Vue 组件调用它，但不关心用例内部如何编排。
- **出站端口（Driven/Output Port）**：应用需要外部能力时定义的接口，例如 `TaskRepositoryPort`、`MapPort`、`ClockPort`。具体适配器实现这些接口。
- **组装根（Composition Root）**：只在 `infrastructure/bootstrap` 中把端口、适配器和用例连接起来。业务层不能自行 `new` Axios、地图引擎或 WebSocket。

依赖关系必须始终指向抽象和业务核心：

```text
Presentation -> Application Port -> Application -> Domain
                                      |
                                      v
                                  Output Ports
                                      ^
                                      |
Adapters ----------------------------+
```

## 2. 各层的职责与禁止事项

### Domain：业务不变量

Domain 只表达业务概念、状态和规则，允许使用 TypeScript 标准能力，不允许依赖 Vue、Pinia、Axios、Element Plus、OpenLayers、Cesium 或浏览器 API。

适合放入 Domain 的内容：

- 实体（Entity）：有身份且生命周期会变化，例如 `ReconnaissanceSubTask`。
- 值对象（Value Object）：由值决定相等性且应保持有效，例如 `Coordinate`、`Polygon`、`TaskId`。
- 领域服务（Domain Service）：不自然属于某个实体的纯业务规则。
- 领域事件（Domain Event）：描述已经发生的业务事实，例如 `SubTaskCreated`。

实体应保护不变量，而不是只暴露可任意修改的字段。状态迁移应通过 `startExecution()`、`complete()` 等方法完成，并拒绝非法迁移。领域错误使用原生 `Error` 或领域错误类型，不弹 UI、不记录日志、不发 HTTP 请求。

几何值对象至少应校验：经纬度范围、点数下限、是否闭合、坐标顺序（本项目约定 `{ lng, lat }`）。如果后端或地图引擎使用 `[x, y]`、投影坐标或反向纬经度，转换必须放在适配器中。

### Application：用例编排

Application 负责一个完整业务动作的流程：校验输入、读取聚合、调用领域行为、持久化、发布事件。它不应包含 Vue 响应式状态、Element Plus 提示、Axios 调用或地图引擎对象。

一个用例应尽量有明确的命令和结果：

```ts
export interface CreateReconnaissanceSubTaskCommand {
  name: string;
  targetId: string;
  area: Coordinate[];
}

export interface CreateReconnaissanceSubTaskPort {
  execute(command: CreateReconnaissanceSubTaskCommand): Promise<ReconnaissanceSubTask>;
}
```

读操作和写操作可以分别建用例，避免一个服务同时承担查询、修改和渲染。应用层需要的时间、ID、持久化、消息发布、地图能力都通过出站端口注入。

### Ports：最小、稳定的契约

端口应按业务能力命名，而不是按技术命名。`TaskRepositoryPort` 是稳定的业务契约；`AxiosTaskRepository` 是可替换的技术实现。

端口需要明确：

- 输入和返回值是否为 Domain 对象或专用 DTO；
- 空结果如何表示（例如 `null`，不要用异常代替正常的“未找到”）；
- 是否支持取消、超时、分页、幂等键和并发版本；
- 资源生命周期由谁负责关闭。

不要把 `AxiosResponse`、`Ref`、`Map`、`WebSocket`、OpenLayers `Feature` 或 Cesium `Entity` 泄漏到端口和 Domain。

### Adapters：转换和技术细节

适配器只做协议转换和技术实现：

- HTTP Adapter：Domain 命令转换为后端 payload，响应 DTO 转回 Domain；处理状态码、序列化和取消请求。
- WebSocket Adapter：连接、重连、心跳、消息解码和订阅注销；向应用发布已经解析的领域消息。
- Map Adapter：把领域几何转换为 OpenLayers/Cesium 对象，管理图层、样式和销毁；不在地图回调里编写任务规则。
- UI Adapter：把点击、表单和路由参数转换为入站端口命令，把结果转换为页面状态。

DTO 不是领域实体。适配器应在边界验证外部数据，缺字段、类型错误或未知状态应转为明确的适配器错误，不能让不可信 DTO 直接进入 Domain 构造函数。

### Infrastructure：底座与组装

Infrastructure 放 Axios 实例、拦截器、运行时配置、WebSocket 传输实现、日志和依赖注入。只有组装根可以同时引用 Application 和 Adapters；其他基础设施模块仍不能引用 Presentation 或 Stores。

运行时配置应集中读取并校验，例如 API 地址、WebSocket 地址和超时时间。不要在每个适配器中分别读取 `import.meta.env`，也不要把密钥打包到前端。

## 3. 一个完整的请求链路

以“创建侦察子任务”为例，推荐链路如下：

1. Vue 表单只负责收集输入和展示 `loading/error`。
2. UI Adapter 调用入站用例端口 `createReconnaissanceSubTaskUseCase.execute(command)`。
3. Application 创建实体并执行领域校验。
4. Application 调用 `TaskRepositoryPort.create(task)`。
5. HTTP Adapter 将实体映射为后端 DTO，并校验响应 DTO。
6. Application 得到新的 Domain 实体，按需要发布领域事件。
7. UI Adapter 将结果转换为页面展示数据；地图更新通过 `MapPort`，而不是直接调用 `ol` 或 `cesium`。

`MapPort` 是否属于该用例要按业务语义决定：如果“提交任务并在地图上标记”是一个不可分的业务动作，可以作为出站端口注入；如果只是页面展示副作用，应由 Presentation 订阅用例结果后调用地图端口，避免持久化失败时地图先显示成功。

## 4. 错误、取消、重试与幂等

错误至少分为三类，并在边界转换：

- 领域错误：输入违反业务规则，例如区域少于三个点。
- 应用错误：用例前置条件不满足，例如目标不存在或状态不允许操作。
- 适配器/基础设施错误：网络超时、认证失败、协议格式错误。

Presentation 负责把错误翻译为用户可见消息；不要在 Application 中调用 `ElMessage`。网络重试只能用于明确可重试的读请求或带幂等键的写请求。创建任务建议携带 `requestId`/幂等键，避免用户重复点击造成重复任务。

长请求应支持 `AbortSignal` 或端口级取消协议。组件卸载时要取消请求、退订 WebSocket 和释放地图资源。重连后的实时消息必须考虑重复、乱序和断线期间的补偿查询，不能假定每条消息只到达一次且严格有序。

## 5. 地图与实时通信的特别约束

### 地图

- Domain 统一使用一种坐标值对象和坐标顺序。
- 投影转换、闭合环补点、样式和图层对象全部属于地图适配器。
- `MapPort` 暴露业务语义，如 `drawTaskArea`、`removeTask`、`flyTo`，不要暴露 `ol.Map` 或 `Cesium.Viewer`。
- 适配器要提供 `dispose` 或等价生命周期方法，避免切换 2D/3D 时监听器和图层泄漏。
- 地图点击得到的原始事件先在适配器中转换为领域坐标，再交给用例或 UI 状态。

### WebSocket

- 连接状态、重连退避、心跳属于 Infrastructure/Adapter。
- 消息 schema 校验和版本兼容属于 Adapter。
- 业务状态变化应转换为领域事件或应用输入，不要直接修改 Pinia 中的领域对象。
- 订阅返回取消函数，页面离开时必须调用；同一事件处理器不得重复注册。

## 6. Pinia、Router 和组件的边界

Pinia 只存页面需要的 UI 状态，例如当前 Tab、筛选条件、分页、地图模式和弹窗开关。任务状态、装备生命周期等业务状态应由 Domain/Application 管理，再映射成 store 所需的展示模型。

Router 负责 URL 到页面和页面参数的映射。路由守卫可以调用认证端口，但不应直接操作 HTTP Adapter。

组件只处理模板交互、表单校验和展示。推荐通过 composable 包装入站用例，统一处理 loading、错误、取消和组件卸载，而不是在多个组件中复制请求逻辑。

## 7. 测试策略

六边形架构的价值要通过替身测试验证，而不是只看目录：

- Domain 单元测试：状态迁移、几何边界和不变量，不启动浏览器或网络。
- Application 单元测试：注入 Fake Repository、Fake Clock、Fake Event Bus，验证调用顺序、失败回滚和幂等行为。
- Adapter 契约测试：固定 DTO 样例验证字段映射、错误转换和坐标转换。
- Presentation 测试：验证用户操作是否产生正确命令、错误是否正确展示。
- 少量端到端测试：验证真实组装根、路由和关键流程。

一个用例如果只能通过启动 Axios、地图引擎和 Vue 才能测试，通常说明端口边界仍然泄漏了技术细节。

## 8. 分阶段改造顺序

不要一次性重写整个项目。建议按以下顺序迁移：

1. 先盘点现有模块的依赖，标记直接访问 API、地图和 Pinia 的页面。
2. 为一个高价值用例定义 Domain 模型和端口。
3. 把现有 API 调用包进 Adapter，补 DTO 映射和错误转换。
4. 在组装根注入适配器，让页面只调用用例。
5. 再迁移地图和 WebSocket，并补生命周期清理。
6. 为 Domain/Application 增加 Fake 测试，最后用 ESLint 规则阻止回退。

每个阶段都应保持可运行，避免为了“目录整齐”而引入大范围行为变化。

## 9. 常见误区检查表

- 只按 `domain/application/adapters` 建目录，却让 Application 直接导入 Axios。
- 把所有接口都叫 Repository，导致地图、时钟、事件总线等能力无法表达。
- 把后端 DTO 当成 Domain 类型使用，字段名和状态值变化会穿透全项目。
- 让 Domain 实体直接保存 OpenLayers Feature、Cesium Entity 或 Vue Ref。
- 让 Application 负责 toast、路由跳转和页面刷新。
- 用 Pinia 作为跨层全局服务定位器，绕过组装根和依赖注入。
- WebSocket 重连后重复订阅，或把原始消息直接写入 UI store。
- 地图渲染成功就视为业务提交成功，忽略持久化失败和回滚。
- 只运行 lint，不测试真实 DTO、坐标系和运行时配置。

## 10. luo-platform 的落地验收标准

一个功能可以认为符合本架构，至少应满足：

- Domain/Application 在没有浏览器、Vue、地图和网络的环境下可以单独测试。
- Presentation 不直接导入 `src/adapters`，Domain 不导入任何上层目录或第三方技术库。
- 所有外部响应在 Adapter 边界完成校验和 DTO -> Domain 映射。
- 依赖只在 `infrastructure/bootstrap` 组装，且适配器可以被 Fake 替换。
- HTTP、WebSocket、地图切换和组件卸载都有明确的超时、取消和资源释放策略。
- `npm run lint`、`npm run build` 和相关测试在提交前通过。


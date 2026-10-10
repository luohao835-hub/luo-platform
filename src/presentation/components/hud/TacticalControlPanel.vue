<script setup lang="ts">
import { onMounted } from 'vue';
import { useMap } from '@/presentation/composables/useMap';
import { useDroneTrajectory } from '@/presentation/composables/useDroneTrajectory';
import type { MapMode } from '@/domain/map/MapMode';
import type { DrawShapeType } from '@/domain/geometry/TacticalGraphic';
import type { ReconnaissanceSubTask } from '@/domain/task/ReconnaissanceSubTask';
import { ElMessage, ElMessageBox, ElPopover, ElSwitch } from 'element-plus';

// 1. 地图与标绘门面 (useMap)
const {
  currentMode,
  switchMode,
  activeDrawType,
  graphicsList,
  startDraw,
  stopDraw,
  clearGraphics,
  drawPresetData,
  activeMeasureType,
  measureResult,
  startMeasure,
  clearMeasure,
  isRoutePlanning,
  currentPlanningType,
  routePlanWaypoints,
  activeExecutionTask,
  startPlanningRoute,
  stopPlanningRoute,
  loadDemoAreaPlan,
  loadDemoStrikePlan,
  loadDemoRoutePlan,
  commitRouteToTask,
  pauseExecutionTask,
  resumeExecutionTask,
  stopExecutionTask,
  savedTasksList,
  fetchSavedTasks,
  deleteSavedTask,
  loadSavedTaskToMap,
  currentBreachAlerts,
  flyTo,
  selectTarget,
  trackTarget,
  trackedTargetId,
} = useMap();

// 2. 真实 Go 后端全球海空态势通信 (useDroneTrajectory)
const {
  isLiveStreaming,
  currentFilterCategory,
  aviationCount,
  maritimeCount,
  graphicsLayerVisible,
  tracksLayerVisible,
  liveMavlinkDrone,
  toggleLayer,
  fetchBackendTargets,
  toggleLiveStream,
  setFilter,
  clearAllTargets,
} = useDroneTrajectory();

// 几何与军规标绘工具箱
const drawingTools: Array<{ type: DrawShapeType; label: string; icon: string }> = [
  { type: 'point', label: '标点', icon: '📍' },
  { type: 'line', label: '折线', icon: '📈' },
  { type: 'circle', label: '圆', icon: '⭕' },
  { type: 'rectangle', label: '矩形', icon: '▭' },
  { type: 'polygon', label: '多边形', icon: '⬡' },
  { type: 'attack_arrow', label: '突击箭头', icon: '🏹' },
  { type: 'double_arrow', label: '钳击双箭', icon: '⚔️' },
  { type: 'sector', label: '雷达扇形', icon: '📡' },
];

const handleToolClick = (type: DrawShapeType) => {
  if (activeDrawType.value === type) {
    stopDraw();
  } else {
    startDraw(type);
  }
};

const handleMeasureClick = (type: 'distance' | 'area') => {
  startMeasure(type);
};

const handleSwitchMode = (mode: MapMode) => {
  switchMode(mode);
};

// 交互式作战任务规划 (支持区域/打击/常规航线，鼠标右键或双击结束并自动闭合)
const handleStartPlan = (type: 'route' | 'area' | 'strike') => {
  const typeText = type === 'area' ? '【区域巡检防区】' : type === 'strike' ? '【战术突防打击】' : '【常规航路巡检】';
  startPlanningRoute(type, () => {
    ElMessage.success(`${typeText}已完成标定并闭合！`);
    handleCommitPlan();
  });
  ElMessage.info(`已开启${typeText}规划：在地图上连续加点，鼠标【右键】或【双击】即可结束并自动闭合防区！`);
};

const handleLoadDemo = (type: 'route' | 'area' | 'strike') => {
  if (type === 'area') {
    loadDemoAreaPlan();
    ElMessage.success('已部署【莫愁湖防区巡检任务】，巡查无人机已起飞执行闭环巡视！');
  } else if (type === 'strike') {
    loadDemoStrikePlan();
    ElMessage.success('已部署【战术突防精确打击任务】，战术突防战机正全速突防！');
  } else {
    loadDemoRoutePlan();
    ElMessage.success('已部署【莫愁湖常规航巡任务】，巡检无人机已起飞！');
  }
};

const handleCommitPlan = async () => {
  try {
    const type = currentPlanningType.value || 'route';
    const typeTitle = type === 'area' ? '区域空巡' : type === 'strike' ? '突防打击' : '空巡侦察';
    const defaultName = `莫愁湖${typeTitle}任务-${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    let taskName = defaultName;

    try {
      const res = await ElMessageBox.prompt(`请输入下发【${typeTitle}】任务名称：`, '下发作战任务并出动', {
        confirmButtonText: '确定出动',
        cancelButtonText: '取消',
        inputValue: defaultName,
        inputPattern: /\S+/,
        inputErrorMessage: '任务名称不能为空',
      });
      if (res.action === 'confirm' && res.value?.trim()) {
        taskName = res.value.trim();
      }
    } catch {
      return;
    }

    const task = await commitRouteToTask(taskName, type);
    ElMessage.success(`【${typeTitle}任务】已成功下发！无人机已起飞执行推演！任务: ${task.name}`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : '提交任务失败';
    ElMessage.warning(msg);
  }
};

const handleLoadSavedTask = (task: ReconnaissanceSubTask) => {
  loadSavedTaskToMap(task);
  ElMessage.success(`已从 SQLite 数据库加载任务【${task.name}】，无人机已就位起飞！`);
};

// 交互式聚焦与视角锁定伴飞 PX4 实机
const handleFocusMavlinkDrone = () => {
  if (liveMavlinkDrone.value) {
    selectTarget(liveMavlinkDrone.value.droneId);
    flyTo(liveMavlinkDrone.value.coordinate, currentMode.value === '3D' ? 14 : 15, 1000);
    ElMessage.success(`视口已对准 PX4 实机 [${liveMavlinkDrone.value.callsign}]`);
  }
};

const handleTrackMavlinkDrone = () => {
  if (liveMavlinkDrone.value) {
    const droneId = liveMavlinkDrone.value.droneId;
    if (trackedTargetId.value === droneId) {
      trackTarget(null);
      ElMessage.info('已解除视角锁定');
    } else {
      selectTarget(droneId);
      trackTarget(droneId);
      ElMessage.success(`已开启第一视角伴飞锁定 PX4 无人机 [${liveMavlinkDrone.value.callsign}]`);
    }
  }
};

const handleDeleteSavedTask = async (task: ReconnaissanceSubTask) => {
  try {
    await ElMessageBox.confirm(`确定要从 SQLite 中彻底删除任务【${task.name}】吗？`, '删除任务', {
      confirmButtonText: '彻底删除',
      cancelButtonText: '取消',
      type: 'warning',
    });
    if (task.id) {
      await deleteSavedTask(task.id);
      ElMessage.success('任务已成功从 SQLite 数据库中移除并注销');
    }
  } catch {
    // 取消删除
  }
};

onMounted(() => {
  fetchBackendTargets();
  toggleLiveStream();
  fetchSavedTasks();
});
</script>

<template>
  <div class="tactical-control-panel">
    <!-- 一体化紧凑战术控制主坞 (Header Dock) -->
    <div class="control-deck">
      <!-- 1. 2D / 3D 双引擎模式切换分段开关 -->
      <div class="mode-switch-group">
        <button
          class="mode-pill"
          :class="{ active: currentMode === '2D' }"
          title="切换至 2D OpenLayers 平面地图"
          @click="handleSwitchMode('2D')"
        >
          🗺️ 2D
        </button>
        <button
          class="mode-pill"
          :class="{ active: currentMode === '3D' }"
          title="切换至 3D Cesium 数字地球"
          @click="handleSwitchMode('3D')"
        >
          🌐 3D
        </button>
      </div>

      <div class="deck-divider" />

      <!-- 2. 图层管控 (Element Plus Popover) -->
      <ElPopover
        trigger="click"
        placement="bottom-start"
        :width="230"
        popper-class="c2-dark-popover"
        :offset="10"
        :show-arrow="false"
      >
        <template #reference>
          <button class="c2-btn" title="图层独立显隐控制">
            👁️ 图层管控
            <span class="dropdown-arrow">▾</span>
          </button>
        </template>

        <div class="popover-panel">
          <div class="popover-title">物理图层显隐管控</div>

          <div class="layer-switch-row">
            <div class="layer-meta">
              <span class="layer-name">🏷️ 战术标绘层</span>
              <span class="layer-desc">标号、几何图形与演练态势</span>
            </div>
            <ElSwitch
              :model-value="graphicsLayerVisible"
              size="small"
              @change="() => toggleLayer('graphics')"
            />
          </div>

          <div class="layer-switch-row">
            <div class="layer-meta">
              <span class="layer-name">🌐 海空目标航迹层</span>
              <span class="layer-desc">飞机、船舶、飞行尾迹与航道</span>
            </div>
            <ElSwitch
              :model-value="tracksLayerVisible"
              size="small"
              @change="() => toggleLayer('tracks')"
            />
          </div>
        </div>
      </ElPopover>

      <!-- 3. 态势工具箱 (Element Plus Popover) -->
      <ElPopover
        trigger="click"
        placement="bottom-start"
        :width="280"
        popper-class="c2-dark-popover"
        :offset="10"
        :show-arrow="false"
      >
        <template #reference>
          <button
            class="c2-btn"
            :class="{ active: activeDrawType != null || activeMeasureType != null }"
            title="军规标号与空间分析工具箱"
          >
            📐 态势工具箱
            <span class="dropdown-arrow">▾</span>
          </button>
        </template>

        <div class="popover-panel">
          <div class="popover-title">军规几何标号</div>
          <div class="tools-grid-layout">
            <button
              v-for="tool in drawingTools"
              :key="tool.type"
              class="grid-tool-btn"
              :class="{ active: activeDrawType === tool.type }"
              @click="handleToolClick(tool.type)"
            >
              <span class="tool-icon">{{ tool.icon }}</span>
              <span class="tool-label">{{ tool.label }}</span>
            </button>
          </div>

          <div class="popover-title mt-2">三维空间量测</div>
          <div class="tools-row-layout">
            <button
              class="row-tool-btn"
              :class="{ active: activeMeasureType === 'distance' }"
              @click="handleMeasureClick('distance')"
            >
              📏 空间测距
            </button>
            <button
              class="row-tool-btn"
              :class="{ active: activeMeasureType === 'area' }"
              @click="handleMeasureClick('area')"
            >
              📐 面积量测
            </button>
          </div>

          <div class="popover-actions-bar">
            <button class="footer-btn accent" @click="drawPresetData">
              ⚡ 军规演练
            </button>
            <button v-if="graphicsList.length > 0" class="footer-btn danger" @click="clearGraphics">
              🗑️ 清空标绘({{ graphicsList.length }})
            </button>
          </div>
        </div>
      </ElPopover>

      <!-- 4. 作战任务规划与出动 (支持区域巡检/战术打击/常规航线) -->
      <ElPopover
        trigger="click"
        placement="bottom-start"
        :width="290"
        popper-class="c2-dark-popover"
        :offset="10"
        :show-arrow="false"
      >
        <template #reference>
          <button
            class="c2-btn"
            :class="{ active: isRoutePlanning || activeExecutionTask != null }"
            title="作战任务规划、下发与无人机推演"
          >
            🎯 作战任务
            <span v-if="activeExecutionTask" class="active-badge">执行中</span>
            <span class="dropdown-arrow">▾</span>
          </button>
        </template>

        <div class="popover-panel">
          <div class="popover-title">新建作战任务 (选择模式)</div>

          <button
            class="menu-action-btn"
            :class="{ active: isRoutePlanning && currentPlanningType === 'area' }"
            @click="handleStartPlan('area')"
          >
            <span class="btn-icon">🌐</span>
            <div class="btn-col">
              <span class="btn-text">区域巡检防区任务</span>
              <span class="btn-sub">圈定多边形防区，无人机闭环环绕巡检</span>
            </div>
          </button>

          <button
            class="menu-action-btn"
            :class="{ active: isRoutePlanning && currentPlanningType === 'strike' }"
            @click="handleStartPlan('strike')"
          >
            <span class="btn-icon">⚔️</span>
            <div class="btn-col">
              <span class="btn-text">战术突防打击任务</span>
              <span class="btn-sub">规划突防攻击走廊，对目标精确打击</span>
            </div>
          </button>

          <button
            class="menu-action-btn"
            :class="{ active: isRoutePlanning && currentPlanningType === 'route' }"
            @click="handleStartPlan('route')"
          >
            <span class="btn-icon">🧭</span>
            <div class="btn-col">
              <span class="btn-text">常规航路巡检任务</span>
              <span class="btn-sub">按先后时序连续规划巡逻航路点</span>
            </div>
          </button>

          <div class="popover-title mt-2">典型实兵演练一键载入</div>

          <div class="demo-buttons-grid">
            <button class="row-tool-btn" @click="handleLoadDemo('area')">
              🌐 防区巡检
            </button>
            <button class="row-tool-btn strike-btn" @click="handleLoadDemo('strike')">
              ⚔️ 突防打击
            </button>
            <button class="row-tool-btn" @click="handleLoadDemo('route')">
              🧭 航路巡逻
            </button>
          </div>

          <button
            v-if="routePlanWaypoints.length >= 3"
            class="menu-action-btn primary mt-2"
            @click="handleCommitPlan"
          >
            <span class="btn-icon">🚀</span>
            <span class="btn-text">下发任务并起飞 ({{ routePlanWaypoints.length }}点)</span>
          </button>

          <button
            v-if="routePlanWaypoints.length > 0 || activeExecutionTask != null"
            class="menu-action-btn danger mt-1"
            @click="stopExecutionTask"
          >
            <span class="btn-icon">⏹️</span>
            <span class="btn-text">清空任务与召回无人机</span>
          </button>
        </div>
      </ElPopover>

      <!-- 5. SQLite 任务库 (Element Plus Popover) -->
      <ElPopover
        trigger="click"
        placement="bottom-start"
        :width="340"
        popper-class="c2-dark-popover"
        :offset="10"
        :show-arrow="false"
      >
        <template #reference>
          <button class="c2-btn" title="查看保存在 SQLite 数据库中的侦察任务库">
            📋 任务库
            <span class="task-count-tag">{{ savedTasksList.length }}</span>
          </button>
        </template>

        <div class="popover-panel">
          <div class="popover-title">🗄️ SQLite 侦察任务库 ({{ savedTasksList.length }})</div>

          <div v-if="savedTasksList.length === 0" class="task-empty-hint">
            暂无已存任务，请在地图打点后点击【下发任务】
          </div>

          <div v-else class="task-list-scroll">
            <div
              v-for="task in savedTasksList"
              :key="task.id"
              class="task-card-item"
              :class="{ 'active-task': activeExecutionTask?.taskId === task.id }"
            >
              <div class="task-card-meta">
                <div class="name-with-tag">
                  <span class="card-name" :title="task.name">{{ task.name }}</span>
                  <span class="type-tag" :class="task.type">
                    {{ task.type === 'area' ? '🌐 区域' : task.type === 'strike' ? '⚔️ 打击' : '🧭 航线' }}
                  </span>
                </div>
                <span class="card-sub">{{ task.area.length }} 个航路点 | {{ task.status }}</span>
              </div>

              <div class="card-action-group">
                <button
                  class="card-btn fly"
                  title="载入地图并立即启动飞行推演"
                  @click="handleLoadSavedTask(task)"
                >
                  🚀 飞航
                </button>
                <button
                  class="card-btn del"
                  title="从 SQLite 彻底删除该任务"
                  @click="handleDeleteSavedTask(task)"
                >
                  🗑️
                </button>
              </div>
            </div>
          </div>
        </div>
      </ElPopover>

      <!-- 任务执行中状态药丸 (有任务时常驻显现) -->
      <div v-if="activeExecutionTask" class="running-task-pill" :class="activeExecutionTask.taskType">
        <span class="task-dot" />
        <span class="task-label">
          {{ activeExecutionTask.taskType === 'area' ? '🌐' : activeExecutionTask.taskType === 'strike' ? '⚔️' : '🧭' }}
          {{ activeExecutionTask.taskName }}
        </span>
        <button
          class="pill-btn"
          :title="activeExecutionTask.status === 'running' ? '暂停巡航' : '继续巡航'"
          @click="activeExecutionTask.status === 'running' ? pauseExecutionTask() : resumeExecutionTask()"
        >
          {{ activeExecutionTask.status === 'running' ? '⏸️' : '▶️' }}
        </button>
        <button class="pill-btn" title="结束并召回无人机" @click="stopExecutionTask">⏹️</button>
      </div>

      <div class="deck-divider" />

      <!-- 6. 全球海空态势感知监控 (推流状态与分类筛选) -->
      <div class="situation-control-group">
        <button
          class="c2-btn stream-pill"
          :class="{ online: isLiveStreaming }"
          :title="isLiveStreaming ? '断开 WebSocket 推流' : '连接 Go 后端 WebSocket 实时流 (10086端口)'"
          @click="toggleLiveStream"
        >
          <span class="stream-indicator" />
          {{ isLiveStreaming ? '态势在线' : '连接服务' }}
        </button>

        <div class="filter-pill-group">
          <button
            class="filter-pill"
            :class="{ active: currentFilterCategory === 'all' }"
            @click="setFilter('all')"
          >
            全部
          </button>
          <button
            class="filter-pill"
            :class="{ active: currentFilterCategory === 'aviation' }"
            @click="setFilter('aviation')"
          >
            ✈ {{ aviationCount }}
          </button>
          <button
            class="filter-pill"
            :class="{ active: currentFilterCategory === 'maritime' }"
            @click="setFilter('maritime')"
          >
            🚢 {{ maritimeCount }}
          </button>
        </div>

        <!-- 7. PX4 / MAVLink 实机在线与遥测感知指示 -->
        <div
          v-if="liveMavlinkDrone"
          class="mavlink-live-pill"
          :title="`【PX4 实机在线】坐标: [${liveMavlinkDrone.coordinate.lng.toFixed(4)}°E, ${liveMavlinkDrone.coordinate.lat.toFixed(4)}°N] | 高度: ${liveMavlinkDrone.coordinate.alt}m | 航速: ${liveMavlinkDrone.speedKmh}km/h | 航向: ${Math.round(liveMavlinkDrone.headingDeg)}°`"
          @click="handleFocusMavlinkDrone"
        >
          <span class="mavlink-pulse-dot" />
          <span class="mavlink-text">
            PX4: {{ liveMavlinkDrone.coordinate.alt }}m
          </span>
          <button
            class="pill-mini-btn"
            title="视口平滑聚焦此无人机"
            @click.stop="handleFocusMavlinkDrone"
          >
            🎯
          </button>
          <button
            class="pill-mini-btn"
            :class="{ active: trackedTargetId === liveMavlinkDrone.droneId }"
            :title="trackedTargetId === liveMavlinkDrone.droneId ? '解除视角锁定' : '视角锁定伴飞'"
            @click.stop="handleTrackMavlinkDrone"
          >
            👁️
          </button>
        </div>

        <button
          class="c2-btn icon-tool-btn"
          title="刷新最新海空目标"
          @click="fetchBackendTargets"
        >
          🔄
        </button>
        <button
          v-if="aviationCount > 0 || maritimeCount > 0"
          class="c2-btn icon-tool-btn"
          title="清空当前海空目标"
          @click="clearAllTargets"
        >
          🗑️
        </button>
      </div>
    </div>

    <!-- 打点中悬浮气泡 -->
    <div v-if="isRoutePlanning" class="floating-guide-bar">
      <span class="guide-pulse" :class="{ 'warning': currentPlanningType === 'strike', 'cyan': currentPlanningType === 'area' }" />
      <span class="guide-text">
        <template v-if="currentPlanningType === 'area'">
          正在圈定【区域巡检防区】(已标定 {{ routePlanWaypoints.length }} 点)：在地图上圈定防区多边形，下发后自动闭合环绕巡检
        </template>
        <template v-else-if="currentPlanningType === 'strike'">
          正在规划【战术突防打击航线】(已标定 {{ routePlanWaypoints.length }} 点)：依次点击突防航点，终点为打击目标阵地
        </template>
        <template v-else>
          正在规划【常规航路巡检】(已标定 {{ routePlanWaypoints.length }} 点)：在地图上连续放置巡航航路点
        </template>
      </span>
      <button v-if="routePlanWaypoints.length >= 3" class="guide-action-btn confirm" @click="handleCommitPlan">
        🚀 立即下发出动
      </button>
      <button class="guide-action-btn cancel" @click="stopPlanningRoute">
        结束规划
      </button>
    </div>

    <!-- 标绘中悬浮气泡 -->
    <div v-if="activeDrawType" class="floating-guide-bar">
      <span class="guide-pulse warning" />
      <span class="guide-text">
        正在绘制【{{ drawingTools.find((t) => t.type === activeDrawType)?.label }}】：点击落点展开 (双击或右键完成)
      </span>
      <button class="guide-action-btn cancel" @click="stopDraw">取消标绘</button>
    </div>

    <!-- 空间量测提示气泡 -->
    <div v-if="activeMeasureType" class="floating-guide-bar">
      <span class="guide-pulse cyan" />
      <span class="guide-text">
        空间量测中：连续加点，双击结束
        <span v-if="measureResult?.formattedDistance" class="result-text">
          [长: {{ measureResult.formattedDistance }}]
        </span>
        <span v-if="measureResult?.formattedArea" class="result-text">
          [面: {{ measureResult.formattedArea }}]
        </span>
      </span>
      <button class="guide-action-btn cancel" @click="clearMeasure">清除量测</button>
    </div>

    <!-- 电子围栏入侵高危警报 -->
    <div v-if="currentBreachAlerts.length > 0" class="floating-guide-bar breach-bar">
      <span class="guide-pulse danger" />
      <span class="guide-text breach-text">🚨 {{ currentBreachAlerts[0].message }}</span>
      <button class="guide-action-btn cancel" @click="currentBreachAlerts = []">知悉</button>
    </div>
  </div>
</template>

<style scoped>
.tactical-control-panel {
  position: relative;
  width: 100%;
  pointer-events: none;
}

/* 一体化紧凑战术控制坞 */
.control-deck {
  display: flex;
  align-items: center;
  background: rgba(11, 20, 32, 0.94);
  border: 1px solid rgba(0, 229, 255, 0.28);
  border-radius: 8px;
  padding: 4px 8px;
  backdrop-filter: blur(14px);
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.75);
  pointer-events: auto;
  gap: 6px;
  width: fit-content;
  max-width: 100%;
}

/* 2D / 3D 分段控制器 */
.mode-switch-group {
  display: inline-flex;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 5px;
  padding: 2px;
  gap: 2px;
}

.mode-pill {
  background: transparent;
  border: none;
  color: #8da4be;
  font-size: 11px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.mode-pill.active {
  background: #00e5ff;
  color: #0b1521;
  font-weight: 700;
  box-shadow: 0 0 8px rgba(0, 229, 255, 0.4);
}

.deck-divider {
  width: 1px;
  height: 18px;
  background: rgba(255, 255, 255, 0.12);
  margin: 0 2px;
  flex-shrink: 0;
}

/* 战术按钮通配 */
.c2-btn {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: #c4d7ec;
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 4px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
  transition: all 0.2s ease;
}

.c2-btn:hover {
  background: rgba(0, 229, 255, 0.12);
  color: #00e5ff;
  border-color: rgba(0, 229, 255, 0.35);
}

.c2-btn.active {
  background: rgba(0, 229, 255, 0.2);
  color: #00e5ff;
  border-color: #00e5ff;
  box-shadow: 0 0 8px rgba(0, 229, 255, 0.3);
}

.dropdown-arrow {
  font-size: 9px;
  opacity: 0.7;
}

.task-count-tag {
  background: rgba(0, 229, 255, 0.25);
  color: #00e5ff;
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 8px;
  font-family: monospace;
}

.active-badge {
  background: #00e676;
  color: #0b1521;
  font-size: 9px;
  padding: 0 4px;
  border-radius: 3px;
  font-weight: 700;
}

/* 运行中任务胶囊 */
.running-task-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: rgba(0, 230, 118, 0.15);
  border: 1px solid rgba(0, 230, 118, 0.4);
  border-radius: 12px;
  padding: 2px 8px;
  font-size: 11px;
  color: #00e676;
}

.running-task-pill.strike {
  background: rgba(255, 61, 0, 0.2);
  border-color: #ff3d00;
  color: #ff3d00;
}

.running-task-pill.area {
  background: rgba(0, 229, 255, 0.18);
  border-color: #00e5ff;
  color: #00e5ff;
}

.running-task-pill.strike .task-dot {
  background: #ff3d00;
  box-shadow: 0 0 6px #ff3d00;
}

.running-task-pill.area .task-dot {
  background: #00e5ff;
  box-shadow: 0 0 6px #00e5ff;
}

.task-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #00e676;
  animation: pulse 1s infinite;
}

.task-label {
  max-width: 110px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
}

.pill-btn {
  background: transparent;
  border: none;
  cursor: pointer;
  font-size: 10px;
  padding: 0 2px;
}

/* 态势推流与分类筛选胶囊 */
.situation-control-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.stream-pill {
  font-weight: 600;
}

.stream-pill.online {
  background: rgba(0, 230, 118, 0.15);
  border-color: rgba(0, 230, 118, 0.4);
  color: #00e676;
}

.stream-indicator {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #ff5252;
}

.stream-pill.online .stream-indicator {
  background: #00e676;
  box-shadow: 0 0 6px #00e676;
}

.filter-pill-group {
  display: inline-flex;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  padding: 2px;
  gap: 2px;
}

.filter-pill {
  background: transparent;
  border: none;
  color: #8da4be;
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.filter-pill.active {
  background: rgba(0, 229, 255, 0.2);
  color: #00e5ff;
  font-weight: 600;
}

.icon-tool-btn {
  padding: 4px 6px;
}

/* PX4 / MAVLink 实机遥测指示药丸 */
.mavlink-live-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: rgba(0, 230, 118, 0.15);
  border: 1px solid rgba(0, 230, 118, 0.5);
  border-radius: 12px;
  padding: 2px 6px 2px 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;

  &:hover {
    background: rgba(0, 230, 118, 0.25);
    border-color: #00e676;
    box-shadow: 0 0 10px rgba(0, 230, 118, 0.35);
  }
}

.mavlink-pulse-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #00e676;
  box-shadow: 0 0 6px #00e676;
  animation: pulse-green 1.5s infinite ease-in-out;
}

@keyframes pulse-green {
  0%, 100% {
    transform: scale(1);
    opacity: 1;
  }
  50% {
    transform: scale(1.3);
    opacity: 0.6;
  }
}

.mavlink-text {
  font-size: 11px;
  font-weight: 600;
  color: #00e676;
  font-family: monospace;
}

.pill-mini-btn {
  background: rgba(0, 0, 0, 0.35);
  border: 1px solid rgba(255, 255, 255, 0.15);
  color: #fff;
  border-radius: 4px;
  font-size: 10px;
  padding: 1px 4px;
  cursor: pointer;
  line-height: 1;
  transition: all 0.15s ease;

  &:hover {
    background: rgba(0, 229, 255, 0.3);
    border-color: #00e5ff;
  }

  &.active {
    background: rgba(0, 229, 255, 0.4);
    border-color: #00e5ff;
    box-shadow: 0 0 6px #00e5ff;
  }
}

.mavlink-idle-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px dashed rgba(255, 255, 255, 0.15);
  border-radius: 12px;
  padding: 2px 8px;
  font-size: 10px;
  color: #7188a4;
  cursor: help;
  user-select: none;
}

.mavlink-idle-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #7188a4;
}

.mavlink-idle-text {
  font-family: monospace;
}

/* 悬浮提示胶囊通配 */
.floating-guide-bar {
  position: absolute;
  top: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  background: rgba(11, 23, 38, 0.95);
  border: 1px solid #ffaa00;
  padding: 6px 14px;
  border-radius: 20px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  pointer-events: auto;
  white-space: nowrap;
  animation: fadeInDown 0.2s ease-out;
  z-index: 50;
  font-size: 11px;
}

.breach-bar {
  border-color: #ff0033;
  background: rgba(45, 10, 18, 0.96);
  box-shadow: 0 4px 20px rgba(255, 0, 51, 0.4);
}

.guide-pulse {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #ffaa00;
  box-shadow: 0 0 8px #ffaa00;
  animation: pulse 1s infinite;
}

.guide-pulse.warning {
  background: #ffaa00;
}

.guide-pulse.cyan {
  background: #00e5ff;
  box-shadow: 0 0 8px #00e5ff;
}

.guide-pulse.danger {
  background: #ff0033;
  box-shadow: 0 0 8px #ff0033;
}

.guide-text {
  color: #ffffff;
}

.breach-text {
  color: #ff4d6d;
  font-weight: 700;
}

.result-text {
  color: #00ffcc;
  font-family: monospace;
  font-weight: 700;
  margin-left: 4px;
}

.guide-action-btn {
  border: none;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.guide-action-btn.confirm {
  background: #00e676;
  color: #0b1521;
}

.guide-action-btn.cancel {
  background: rgba(255, 255, 255, 0.15);
  color: #ffffff;
}

.guide-action-btn.cancel:hover {
  background: rgba(255, 82, 82, 0.4);
}

/* 弹层内部精细样式 */
.popover-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
}

.popover-title {
  color: #64829f;
  font-size: 10px;
  font-weight: 700;
  padding-bottom: 2px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  letter-spacing: 0.5px;
}

.mt-2 {
  margin-top: 4px;
}

.layer-switch-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 4px;
  border-radius: 4px;
  transition: background 0.15s;
}

.layer-switch-row:hover {
  background: rgba(255, 255, 255, 0.03);
}

.layer-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.layer-name {
  color: #ffffff;
  font-size: 11px;
  font-weight: 600;
}

.layer-desc {
  color: #64829f;
  font-size: 10px;
}

/* 工具箱网格 */
.tools-grid-layout {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
  padding: 4px 0;
}

.grid-tool-btn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  padding: 6px 2px;
  cursor: pointer;
  color: #c4d7ec;
  font-size: 10px;
  transition: all 0.15s ease;
}

.grid-tool-btn:hover {
  background: rgba(0, 229, 255, 0.15);
  border-color: rgba(0, 229, 255, 0.4);
  color: #00e5ff;
}

.grid-tool-btn.active {
  background: #ffaa00;
  border-color: #ffaa00;
  color: #0b1521;
  font-weight: 700;
}

.tools-row-layout {
  display: flex;
  gap: 6px;
  padding: 4px 0;
}

.row-tool-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  padding: 6px 4px;
  cursor: pointer;
  color: #c4d7ec;
  font-size: 11px;
  transition: all 0.15s ease;
}

.row-tool-btn:hover {
  background: rgba(0, 229, 255, 0.15);
  border-color: rgba(0, 229, 255, 0.4);
  color: #00e5ff;
}

.row-tool-btn.active {
  background: rgba(0, 255, 204, 0.25);
  border-color: #00ffcc;
  color: #00ffcc;
  font-weight: 700;
}

.popover-actions-bar {
  display: flex;
  gap: 6px;
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.footer-btn {
  flex: 1;
  padding: 5px;
  border-radius: 4px;
  border: none;
  font-size: 11px;
  cursor: pointer;
  font-weight: 600;
  transition: all 0.15s ease;
}

.footer-btn.accent {
  background: rgba(0, 230, 118, 0.2);
  color: #00e676;
}

.footer-btn.accent:hover {
  background: rgba(0, 230, 118, 0.35);
}

.footer-btn.danger {
  background: rgba(255, 82, 82, 0.15);
  color: #ff5252;
}

/* 航线任务动作按钮 */
.menu-action-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  padding: 8px 10px;
  color: #c4d7ec;
  cursor: pointer;
  font-size: 11px;
  transition: all 0.15s ease;
  width: 100%;
}

.menu-action-btn:hover {
  background: rgba(0, 229, 255, 0.15);
  border-color: rgba(0, 229, 255, 0.4);
  color: #00e5ff;
}

.menu-action-btn.active {
  background: rgba(0, 229, 255, 0.22);
  border-color: #00e5ff;
  color: #00e5ff;
}

.btn-col {
  display: flex;
  flex-direction: column;
  text-align: left;
  gap: 1px;
}

.btn-sub {
  font-size: 10px;
  color: #64829f;
}

.demo-buttons-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  padding: 4px 0;
}

.row-tool-btn.strike-btn:hover {
  background: rgba(255, 61, 0, 0.25);
  border-color: #ff3d00;
  color: #ff5252;
}

.menu-action-btn.primary {
  background: rgba(0, 230, 118, 0.15);
  border-color: rgba(0, 230, 118, 0.4);
  color: #00e676;
  font-weight: 600;
}

.menu-action-btn.primary:hover {
  background: rgba(0, 230, 118, 0.3);
}

.menu-action-btn.danger {
  color: #ff5252;
}

.menu-action-btn.danger:hover {
  background: rgba(255, 82, 82, 0.15);
}

/* 任务列表滚动区 */
.task-empty-hint {
  color: #64829f;
  font-size: 11px;
  text-align: center;
  padding: 16px 0;
}

.task-list-scroll {
  max-height: 280px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-right: 2px;
}

.task-card-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 4px;
  padding: 6px 8px;
  gap: 8px;
  transition: all 0.15s ease;
}

.task-card-item:hover {
  background: rgba(0, 229, 255, 0.08);
  border-color: rgba(0, 229, 255, 0.3);
}

.task-card-item.active-task {
  border-color: #00e676;
  background: rgba(0, 230, 118, 0.08);
}

.task-card-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
  flex: 1;
}

.card-name {
  color: #ffffff;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.name-with-tag {
  display: flex;
  align-items: center;
  gap: 5px;
}

.type-tag {
  font-size: 9px;
  padding: 0 4px;
  border-radius: 2px;
  font-weight: 600;
}

.type-tag.area {
  background: rgba(0, 229, 255, 0.2);
  color: #00e5ff;
  border: 1px solid rgba(0, 229, 255, 0.35);
}

.type-tag.strike {
  background: rgba(255, 61, 0, 0.2);
  color: #ff5252;
  border: 1px solid rgba(255, 61, 0, 0.4);
}

.type-tag.route {
  background: rgba(255, 234, 0, 0.2);
  color: #ffea00;
  border: 1px solid rgba(255, 234, 0, 0.35);
}

.card-sub {
  color: #64829f;
  font-size: 10px;
  font-family: monospace;
}

.card-action-group {
  display: flex;
  align-items: center;
  gap: 4px;
}

.card-btn {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 3px;
  padding: 2px 6px;
  color: #c4d7ec;
  font-size: 10px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.card-btn.fly:hover {
  background: rgba(0, 230, 118, 0.25);
  color: #00e676;
  border-color: #00e676;
}

.card-btn.del:hover {
  background: rgba(255, 82, 82, 0.25);
  color: #ff5252;
  border-color: #ff5252;
}

@keyframes pulse {
  0% { transform: scale(0.9); opacity: 0.8; }
  50% { transform: scale(1.3); opacity: 1; }
  100% { transform: scale(0.9); opacity: 0.8; }
}

@keyframes fadeInDown {
  from { opacity: 0; transform: translate(-50%, -6px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}
</style>

<!-- 全局覆盖 Element Plus Popover 暗色高科技主题 -->
<style>
.c2-dark-popover.el-popper {
  background: rgba(11, 23, 38, 0.96) !important;
  border: 1px solid rgba(0, 229, 255, 0.35) !important;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.85) !important;
  backdrop-filter: blur(14px) !important;
  border-radius: 8px !important;
  padding: 8px !important;
  color: #c4d7ec !important;
}

.c2-dark-popover .el-popper__arrow {
  display: none !important;
}
</style>

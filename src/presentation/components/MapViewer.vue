<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue';
import { useMap } from '@/presentation/composables/useMap';
import { useDroneTrajectory } from '@/presentation/composables/useDroneTrajectory';

// 表现层一体化组件：统一战术综合指控面板 + 底部遥测栏 + 目标态势卡片
import TacticalControlPanel from '@/presentation/components/hud/TacticalControlPanel.vue';
import MapTelemetryBar from '@/presentation/components/hud/MapTelemetryBar.vue';
import TargetDetailCard from '@/presentation/components/hud/TargetDetailCard.vue';

const olContainerRef = ref<HTMLElement | null>(null);
const cesiumContainerRef = ref<HTMLElement | null>(null);

const {
  currentMode,
  isLoading,
  viewState,
  cursorPosition,
  selectedTargetId,
  trackedTargetId,
  is3DModelActive,
  init,
  flyTo,
  zoomIn,
  zoomOut,
  selectTarget,
  trackTarget,
  toggle3DModel,
} = useMap();

const { getTargetById } = useDroneTrajectory();

const selectedTarget = computed(() => getTargetById(selectedTargetId.value));
const trackedTarget = computed(() => getTargetById(trackedTargetId.value));

const handleFlyToTarget = (coord: { lng: number; lat: number; alt?: number }) => {
  flyTo(coord, currentMode.value === '3D' ? 12 : 13, 1000);
};

const handleResetCenter = () => {
  flyTo({ lng: 118.7702, lat: 32.0356 }, currentMode.value === '3D' ? 14 : 15, 1000);
};

const handleToggleTrack = () => {
  if (!selectedTargetId.value) return;
  if (trackedTargetId.value === selectedTargetId.value) {
    trackTarget(null);
  } else {
    trackTarget(selectedTargetId.value);
  }
};

const handleCloseCard = () => {
  selectTarget(null);
};

onMounted(async () => {
  if (olContainerRef.value && cesiumContainerRef.value) {
    await init(olContainerRef.value, cesiumContainerRef.value, {
      center: { lng: 118.7702, lat: 32.0356 },
      zoom: 15,
      mode: '2D',
    });
  }
});

onBeforeUnmount(() => {
  // 视口生命周期由各适配器统一管理
});
</script>

<template>
  <div class="map-viewer-wrapper">
    <!-- 2D OpenLayers 渲染容器 -->
    <div
      ref="olContainerRef"
      class="engine-container engine-ol"
      :class="{ 'is-active': currentMode === '2D' }"
    />

    <!-- 3D Cesium 渲染容器 -->
    <div
      ref="cesiumContainerRef"
      class="engine-container engine-cesium"
      :class="{ 'is-active': currentMode === '3D' }"
    />

    <!-- 引擎切换加载中遮罩 -->
    <div v-if="isLoading" class="loading-overlay">
      <div class="loading-spinner" />
      <span class="loading-text">GIS 双引擎视口切换中...</span>
    </div>

    <!-- 顶层战术指控面板 (精简、整齐、高内聚) -->
    <header class="tactical-hud-dock">
      <TacticalControlPanel />
    </header>

    <!-- 右侧地图视口垂直导航工具栏 -->
    <aside class="nav-control-dock">
      <button class="nav-tool-btn" title="放大地图" @click="zoomIn">➕</button>
      <button class="nav-tool-btn" title="缩小地图" @click="zoomOut">➖</button>
      <button class="nav-tool-btn" title="重置回主防区中心" @click="handleResetCenter">🎯</button>
      <button
        v-if="currentMode === '3D'"
        class="nav-tool-btn model-btn"
        :class="{ active: is3DModelActive }"
        :title="is3DModelActive ? '当前为3D精细模型，点击切换矢量符号' : '当前为矢量符号，点击切换3D精细模型'"
        @click="() => toggle3DModel()"
      >
        ✈
      </button>
    </aside>

    <!-- 选中的海空目标战术态势卡片 -->
    <TargetDetailCard
      :target="selectedTarget"
      :is-tracked="trackedTargetId != null && trackedTargetId === selectedTargetId"
      @close="handleCloseCard"
      @fly-to="handleFlyToTarget"
      @toggle-track="handleToggleTrack"
    />

    <!-- 底部态势遥测状态栏 -->
    <MapTelemetryBar
      :view-state="viewState"
      :cursor-position="cursorPosition"
      :tracked-callsign="trackedTarget?.callsign || null"
      @unlock-track="() => trackTarget(null)"
    />
  </div>
</template>

<style scoped>
.map-viewer-wrapper {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 550px;
  overflow: hidden;
  background-color: #0b1521;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.engine-container {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  transition: opacity 0.3s ease;
  pointer-events: none;
  opacity: 0;
  z-index: 0;
}

.engine-container.is-active {
  opacity: 1;
  pointer-events: auto;
  z-index: 1;
}

/* 视口切换遮罩 */
.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(11, 21, 33, 0.65);
  backdrop-filter: blur(4px);
  z-index: 100;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.loading-spinner {
  width: 36px;
  height: 36px;
  border: 3px solid rgba(0, 229, 255, 0.2);
  border-top-color: #00e5ff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.loading-text {
  color: #00e5ff;
  font-size: 13px;
  letter-spacing: 1px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* 顶层战术悬浮舱 */
.tactical-hud-dock {
  position: absolute;
  top: 12px;
  left: 14px;
  right: 14px;
  z-index: 20;
  pointer-events: none;
}

/* 右侧地图视口垂直导航工具栏 */
.nav-control-dock {
  position: absolute;
  right: 16px;
  bottom: 52px;
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: rgba(11, 20, 32, 0.92);
  border: 1px solid rgba(0, 229, 255, 0.3);
  border-radius: 6px;
  padding: 4px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
}

.nav-tool-btn {
  width: 30px;
  height: 30px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  color: #c4d7ec;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
}

.nav-tool-btn:hover {
  background: rgba(0, 229, 255, 0.2);
  border-color: #00e5ff;
  color: #00e5ff;
}

.model-btn.active {
  background: rgba(255, 170, 0, 0.25);
  border-color: #ffaa00;
  color: #ffaa00;
}
</style>

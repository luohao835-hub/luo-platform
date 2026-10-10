<script setup lang="ts">
import type { MapViewState } from '@/domain/map/MapViewState';

defineProps<{
  viewState: MapViewState;
  cursorPosition?: { lng: number; lat: number; alt?: number } | null;
  trackedCallsign?: string | null;
}>();

defineEmits<{
  (e: 'unlockTrack'): void;
}>();
</script>

<template>
  <footer class="telemetry-bar">
    <!-- 视口中心 -->
    <div class="telemetry-item">
      <span class="telemetry-label">视口中心:</span>
      <span class="telemetry-value">
        {{ viewState.center.lng.toFixed(4) }}°E, {{ viewState.center.lat.toFixed(4) }}°N
      </span>
    </div>

    <div class="telemetry-divider" />

    <!-- 缩放层级 -->
    <div class="telemetry-item">
      <span class="telemetry-label">层级:</span>
      <span class="telemetry-value">{{ viewState.zoom }} 级</span>
    </div>

    <div class="telemetry-divider" />

    <!-- 鼠标实时光标位置 -->
    <div class="telemetry-item">
      <span class="telemetry-label">光标经纬:</span>
      <span class="telemetry-value highlight">
        <template v-if="cursorPosition">
          {{ cursorPosition.lng.toFixed(4) }}°E, {{ cursorPosition.lat.toFixed(4) }}°N
        </template>
        <template v-else>
          --
        </template>
      </span>
    </div>

    <!-- 鼠标实时地形高程 -->
    <template v-if="cursorPosition?.alt != null && cursorPosition.alt > 0">
      <div class="telemetry-divider" />
      <div class="telemetry-item">
        <span class="telemetry-label">地面海拔:</span>
        <span class="telemetry-value alt-val">{{ cursorPosition.alt }} 米</span>
      </div>
    </template>

    <!-- 3D 模式相机视点高程 -->
    <template v-if="viewState.cameraAltitude != null">
      <div class="telemetry-divider" />
      <div class="telemetry-item">
        <span class="telemetry-label">视高:</span>
        <span class="telemetry-value">{{ viewState.cameraAltitude.toLocaleString() }} 米</span>
      </div>
      <div class="telemetry-divider" />
      <div class="telemetry-item">
        <span class="telemetry-tag">3D 数字地球</span>
      </div>
    </template>

    <!-- 伴飞跟踪状态呼吸提示 -->
    <div v-if="trackedCallsign" class="track-status-pill" title="点击立即解除视角锁定" @click="$emit('unlockTrack')">
      <span class="track-dot" />
      <span>伴飞中: {{ trackedCallsign }}</span>
      <span class="unlock-hint">[解除]</span>
    </div>
  </footer>
</template>

<style scoped>
.telemetry-bar {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 10;
  height: 32px;
  background: rgba(10, 18, 29, 0.94);
  border-top: 1px solid rgba(0, 229, 255, 0.2);
  display: flex;
  align-items: center;
  padding: 0 16px;
  font-size: 11px;
  color: #8da4be;
  gap: 12px;
  backdrop-filter: blur(8px);
  user-select: none;
  overflow-x: auto;
}

.telemetry-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  white-space: nowrap;
}

.telemetry-label {
  color: #64829f;
}

.telemetry-value {
  color: #ffffff;
  font-family: monospace;
}

.telemetry-value.highlight {
  color: #00e5ff;
}

.telemetry-value.alt-val {
  color: #00e676;
}

.telemetry-divider {
  width: 1px;
  height: 14px;
  background: rgba(255, 255, 255, 0.12);
  flex-shrink: 0;
}

.telemetry-tag {
  background: rgba(0, 229, 255, 0.15);
  color: #00e5ff;
  padding: 1px 6px;
  border-radius: 3px;
  font-size: 10px;
}

.track-status-pill {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(255, 170, 0, 0.2);
  border: 1px solid #ffaa00;
  color: #ffaa00;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
}

.track-status-pill:hover {
  background: rgba(255, 170, 0, 0.35);
  box-shadow: 0 0 10px rgba(255, 170, 0, 0.5);
}

.track-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #ffaa00;
  box-shadow: 0 0 6px #ffaa00;
  animation: pulse 1s infinite;
}

.unlock-hint {
  font-size: 10px;
  opacity: 0.8;
}

@keyframes pulse {
  0% { transform: scale(0.9); opacity: 0.8; }
  50% { transform: scale(1.3); opacity: 1; }
  100% { transform: scale(0.9); opacity: 0.8; }
}
</style>

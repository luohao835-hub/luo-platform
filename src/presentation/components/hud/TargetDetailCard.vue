<script setup lang="ts">
import { computed } from 'vue';
import type { DroneTelemetryFrame } from '@/domain/telemetry/DroneTelemetryFrame';

const props = defineProps<{
  target: DroneTelemetryFrame | null;
  isTracked: boolean;
}>();

const isMavlink = computed(() => {
  if (!props.target) return false;
  const id = props.target.droneId.toUpperCase();
  const name = props.target.callsign.toUpperCase();
  const model = props.target.model.toUpperCase();
  return id.includes('PX4') || name.includes('PX4') || model.includes('PX4');
});

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'flyTo', coord: { lng: number; lat: number; alt?: number }): void;
  (e: 'toggleTrack'): void;
}>();

const handleFlyTo = () => {
  if (props.target) {
    emit('flyTo', props.target.coordinate);
  }
};

const handleToggleTrack = () => {
  emit('toggleTrack');
};

const handleClose = () => {
  emit('close');
};
</script>

<template>
  <transition name="card-slide">
    <div v-if="target" class="target-detail-card">
      <!-- 头部：标题与关闭 -->
      <div class="card-header">
        <div class="header-badge" :class="[target.category, { 'mavlink-badge': isMavlink }]">
          {{ isMavlink ? '📡 PX4 MAVLink 实机' : (target.category === 'maritime' ? '🚢 船舶 AIS' : '✈ 航空遥测') }}
        </div>
        <div class="header-title">
          <span class="callsign">{{ target.callsign }}</span>
          <span class="target-id">{{ target.droneId }}</span>
        </div>
        <button class="close-btn" title="关闭详情" @click="handleClose">✕</button>
      </div>

      <!-- 核心态势数据网格 -->
      <div class="card-body">
        <div class="stat-row">
          <span class="stat-label">装备型号</span>
          <span class="stat-value highlight">{{ target.model }}</span>
        </div>

        <div class="grid-2">
          <div class="stat-box">
            <span class="box-label">航速</span>
            <span class="box-value">
              {{ target.speedKmh }}
              <span class="unit">{{ target.category === 'maritime' ? '节' : 'km/h' }}</span>
            </span>
          </div>

          <div class="stat-box">
            <span class="box-label">航向角</span>
            <span class="box-value">
              {{ Math.round(target.headingDeg) }}°
              <span class="unit">真北</span>
            </span>
          </div>
        </div>

        <div class="grid-2">
          <div class="stat-box">
            <span class="box-label">{{ target.category === 'maritime' ? '吃水高程' : '飞行高程' }}</span>
            <span class="box-value">
              {{ target.category === 'maritime' ? '海平面' : `${target.coordinate.alt ?? 0}m` }}
              <span v-if="target.category === 'aviation' && (target.coordinate.alt ?? 0) > 0" class="unit">
                (FL{{ Math.round((target.coordinate.alt ?? 0) / 100) }})
              </span>
            </span>
          </div>

          <div class="stat-box">
            <span class="box-label">当前姿态</span>
            <span class="box-value status-tag" :class="target.status">
              {{
                target.status === 'standby'
                  ? '地面待命 (Disarmed)'
                  : target.status === 'cruising'
                    ? (isMavlink ? '在空飞航 (Armed)' : '巡航')
                    : target.status === 'patrol'
                      ? '区域巡逻'
                      : target.status === 'underway'
                        ? '在航'
                        : '正常执行'
              }}
            </span>
          </div>
        </div>

        <!-- 航空机载专属三维姿态角 (Pitch / Roll 欧拉角) -->
        <div v-if="target.category === 'aviation'" class="grid-2">
          <div class="stat-box">
            <span class="box-label">机体俯仰 (Pitch)</span>
            <span class="box-value attitude-val">
              {{ target.pitchDeg.toFixed(1) }}°
              <span class="unit">{{ target.pitchDeg >= 0 ? '仰角' : '俯角' }}</span>
            </span>
          </div>

          <div class="stat-box">
            <span class="box-label">机体横滚 (Roll)</span>
            <span class="box-value attitude-val">
              {{ target.rollDeg.toFixed(1) }}°
              <span class="unit">{{ target.rollDeg >= 0 ? '右倾' : '左倾' }}</span>
            </span>
          </div>
        </div>

        <!-- 始发地与目的地 -->
        <div v-if="target.origin || target.destination" class="route-box">
          <div class="route-endpoint">
            <span class="endpoint-dot origin" />
            <span class="endpoint-name">{{ target.origin || '始发点' }}</span>
          </div>
          <div class="route-arrow">➔</div>
          <div class="route-endpoint">
            <span class="endpoint-dot dest" />
            <span class="endpoint-name">{{ target.destination || '目的站' }}</span>
          </div>
        </div>

        <!-- 当前空间经纬度坐标 -->
        <div class="coord-box">
          <span class="coord-label">空间坐标:</span>
          <span class="coord-val">
            {{ target.coordinate.lng.toFixed(5) }}°E, {{ target.coordinate.lat.toFixed(5) }}°N
          </span>
        </div>
      </div>

      <!-- 底部交互操作工具栏 -->
      <div class="card-actions">
        <button class="hud-action-btn focus-btn" title="视口快速平滑飞跃至该目标" @click="handleFlyTo">
          🎯 聚焦目标
        </button>

        <button
          class="hud-action-btn track-btn"
          :class="{ active: isTracked }"
          :title="isTracked ? '点击解除视角锁定' : '将相机视口绑定该目标伴随运动'"
          @click="handleToggleTrack"
        >
          <span v-if="isTracked" class="track-pulse" />
          {{ isTracked ? '🎥 锁定伴飞中' : '🎥 视角锁定' }}
        </button>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.target-detail-card {
  position: absolute;
  top: 60px;
  right: 16px;
  width: 320px;
  background: rgba(10, 20, 32, 0.94);
  border: 1px solid rgba(0, 229, 255, 0.35);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.75);
  backdrop-filter: blur(12px);
  z-index: 90;
  pointer-events: auto;
  overflow: hidden;
  font-size: 12px;
  color: #c4d7ec;
}

.card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: rgba(0, 229, 255, 0.08);
  border-bottom: 1px solid rgba(0, 229, 255, 0.2);
}

.header-badge {
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 4px;
  font-weight: 700;
}

.header-badge.aviation {
  background: rgba(255, 234, 0, 0.2);
  color: #ffea00;
  border: 1px solid rgba(255, 234, 0, 0.4);
}

.header-badge.maritime {
  background: rgba(0, 255, 255, 0.2);
  color: #00ffff;
  border: 1px solid rgba(0, 255, 255, 0.4);
}

.header-badge.mavlink-badge {
  background: rgba(0, 230, 118, 0.2);
  color: #00e676;
  border: 1px solid rgba(0, 230, 118, 0.6);
  box-shadow: 0 0 8px rgba(0, 230, 118, 0.3);
}

.header-title {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.callsign {
  font-size: 14px;
  font-weight: 700;
  color: #ffffff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.target-id {
  font-size: 10px;
  color: #64829f;
  font-family: monospace;
}

.close-btn {
  background: transparent;
  border: none;
  color: #8da4be;
  font-size: 14px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: all 0.2s;
}

.close-btn:hover {
  background: rgba(255, 82, 82, 0.2);
  color: #ff5252;
}

.card-body {
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.stat-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.stat-label {
  color: #7b9bb9;
}

.stat-value {
  color: #ffffff;
  font-weight: 600;
}

.stat-value.highlight {
  color: #00e5ff;
}

.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.stat-box {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 4px;
  padding: 6px 10px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.box-label {
  font-size: 10px;
  color: #64829f;
}

.box-value {
  font-size: 13px;
  font-weight: 700;
  color: #ffffff;
  font-family: monospace;
}

.box-value.attitude-val {
  color: #00e5ff;
}

.unit {
  font-size: 10px;
  color: #8da4be;
  font-family: sans-serif;
  margin-left: 2px;
}

.status-tag {
  color: #00e676;
}

.route-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: rgba(0, 229, 255, 0.05);
  border: 1px dashed rgba(0, 229, 255, 0.25);
  border-radius: 4px;
  padding: 6px 10px;
  gap: 6px;
}

.route-endpoint {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  overflow: hidden;
}

.endpoint-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.endpoint-dot.origin {
  background: #00e5ff;
}

.endpoint-dot.dest {
  background: #ffaa00;
}

.endpoint-name {
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #d0e1f3;
}

.route-arrow {
  color: #00e5ff;
  font-size: 11px;
  flex-shrink: 0;
}

.coord-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  padding: 4px 0;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.coord-label {
  color: #64829f;
}

.coord-val {
  color: #8da4be;
  font-family: monospace;
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: rgba(0, 0, 0, 0.25);
  border-top: 1px solid rgba(0, 229, 255, 0.15);
}

.hud-action-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 6px 10px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.05);
  color: #ffffff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
}

.hud-action-btn:hover {
  background: rgba(0, 229, 255, 0.2);
  border-color: rgba(0, 229, 255, 0.5);
  color: #00e5ff;
}

.track-btn.active {
  background: linear-gradient(135deg, rgba(255, 170, 0, 0.3), rgba(255, 102, 0, 0.4));
  border-color: #ffaa00;
  color: #ffaa00;
  box-shadow: 0 0 12px rgba(255, 170, 0, 0.4);
}

.track-pulse {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #ffaa00;
  box-shadow: 0 0 8px #ffaa00;
  animation: pulse 1s infinite;
}

@keyframes pulse {
  0% { transform: scale(0.9); opacity: 0.8; }
  50% { transform: scale(1.4); opacity: 1; }
  100% { transform: scale(0.9); opacity: 0.8; }
}

/* 过渡动效 */
.card-slide-enter-active,
.card-slide-leave-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.card-slide-enter-from,
.card-slide-leave-to {
  opacity: 0;
  transform: translateX(30px) scale(0.95);
}
</style>

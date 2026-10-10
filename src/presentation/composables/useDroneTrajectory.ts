import { ref, shallowRef } from 'vue';
import axios from 'axios';
import {
  toggleLayerVisibilityUseCase,
  connectTelemetryStreamUseCase,
  webSocketSituationAdapter,
  dualEngineMapAdapter,
} from '@/infrastructure/bootstrap/container';
import { DroneTelemetryFrame, type DroneTelemetryProps } from '@/domain/telemetry/DroneTelemetryFrame';
import type { MapLayerType } from '@/domain/map/LayerType';
import { appConfig } from '@/infrastructure/config/appConfig';

// 模块级单例共享状态 (连接真实 Go 后端)
const isLiveStreaming = ref(false);
const currentFilterCategory = ref<'all' | 'aviation' | 'maritime'>('all');
const aviationCount = ref(0);
const maritimeCount = ref(0);
const liveTargetsMap = shallowRef<Map<string, DroneTelemetryFrame>>(new Map());
const liveMavlinkDrone = shallowRef<DroneTelemetryFrame | null>(null);

// 物理图层独立显隐状态
const graphicsLayerVisible = ref(true);
const tracksLayerVisible = ref(true);

let unsubscribeStream: (() => void) | null = null;

export function useDroneTrajectory() {
  /**
   * 独立控制物理图层显隐 (标绘层与海空目标层互不干扰)
   */
  const toggleLayer = (layer: MapLayerType) => {
    if (layer === 'graphics') {
      graphicsLayerVisible.value = !graphicsLayerVisible.value;
      toggleLayerVisibilityUseCase.execute('graphics', graphicsLayerVisible.value);
    } else {
      tracksLayerVisible.value = !tracksLayerVisible.value;
      toggleLayerVisibilityUseCase.execute('tracks', tracksLayerVisible.value);
    }
  };

  /**
   * 首次通过 HTTP REST API 从 Go 后端全量拉取一次全球在航船舶与飞机
   */
  const fetchBackendTargets = async () => {
    try {
      const res = await axios.get('/api/v1/targets', {
        baseURL: appConfig.httpServiceUrl || 'http://localhost:10086',
        params: {
          category: currentFilterCategory.value !== 'all' ? currentFilterCategory.value : undefined,
        },
      });

      if (res.data?.data && Array.isArray(res.data.data)) {
        res.data.data.forEach((item: DroneTelemetryProps) => {
          const frame = new DroneTelemetryFrame(item);
          dualEngineMapAdapter.updateDroneLivePosition(frame);
          liveTargetsMap.value.set(frame.droneId, frame);
          checkMavlinkDrone(frame);
        });
        updateCounts();
      }
    } catch (err) {
      console.warn('[useDroneTrajectory] 连接 Go 后端 HTTP 接口失败 (请确认 npm run server:run 是否已启动):', err);
    }
  };

  /**
   * 开启或关闭与 Go 后端的实时 WebSocket 态势推流长连接 (ws://localhost:10086/ws/situation)
   */
  const toggleLiveStream = async () => {
    if (isLiveStreaming.value) {
      if (unsubscribeStream) {
        unsubscribeStream();
        unsubscribeStream = null;
      }
      isLiveStreaming.value = false;
      return;
    }

    try {
      // 1. 先拉取基线存量目标
      await fetchBackendTargets();

      // 2. 建立 WebSocket 长连接
      const targetWsUrl = appConfig.wsServiceUrl || 'ws://localhost:10086/ws/situation';
      unsubscribeStream = await connectTelemetryStreamUseCase.execute(
        targetWsUrl,
        (frame) => {
          liveTargetsMap.value.set(frame.droneId, frame);
          checkMavlinkDrone(frame);
          updateCounts();
        },
      );
      isLiveStreaming.value = true;
    } catch (err) {
      console.error('[useDroneTrajectory] 建立 WebSocket 长连接失败:', err);
      isLiveStreaming.value = false;
    }
  };

  /**
   * 切换海空目标类型过滤 (全部 / 仅飞机 / 仅船舶)
   */
  const setFilter = (category: 'all' | 'aviation' | 'maritime') => {
    currentFilterCategory.value = category;
    clearAllTargets();
    webSocketSituationAdapter.sendCategoryFilter(category);
    fetchBackendTargets();
  };

  const updateCounts = () => {
    let planes = 0;
    let ships = 0;
    liveTargetsMap.value.forEach((target) => {
      if (target.category === 'aviation') planes++;
      else ships++;
    });
    aviationCount.value = planes;
    maritimeCount.value = ships;
  };

  const checkMavlinkDrone = (frame: DroneTelemetryFrame) => {
    if (
      frame.droneId.toUpperCase().includes('PX4') ||
      frame.callsign.toUpperCase().includes('PX4') ||
      frame.model.toUpperCase().includes('PX4')
    ) {
      liveMavlinkDrone.value = frame;
    }
  };

  const clearAllTargets = () => {
    dualEngineMapAdapter.clearAllTrajectories();
    liveTargetsMap.value.clear();
    liveMavlinkDrone.value = null;
    aviationCount.value = 0;
    maritimeCount.value = 0;
  };

  const getTargetById = (id: string | null): DroneTelemetryFrame | null => {
    if (!id) return null;
    return liveTargetsMap.value.get(id) || null;
  };

  return {
    isLiveStreaming,
    currentFilterCategory,
    aviationCount,
    maritimeCount,
    graphicsLayerVisible,
    tracksLayerVisible,
    liveTargetsMap,
    liveMavlinkDrone,
    getTargetById,
    toggleLayer,
    fetchBackendTargets,
    toggleLiveStream,
    setFilter,
    clearAllTargets,
  };
}

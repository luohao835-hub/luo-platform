import { ref, shallowRef } from 'vue';
import type { Coordinate } from '@/domain/geometry/Coordinate';
import type { MapMode } from '@/domain/map/MapMode';
import type { MapViewState } from '@/domain/map/MapViewState';
import type { MapInitOptions } from '@/ports/map/MapPort';
import { TacticalGraphic, type DrawShapeType } from '@/domain/geometry/TacticalGraphic';
import { MilitaryPlotAlgorithms } from '@/domain/geometry/MilitaryPlotAlgorithms';
import type { SpatialMeasureResult } from '@/domain/geometry/SpatialCalculator';
import { ReconnaissanceSubTask, type MissionTaskType } from '@/domain/task/ReconnaissanceSubTask';
import { MissionRoutePlan, type RoutePlanWaypoint } from '@/domain/mission/MissionRoutePlan';
import { DroneTrajectory } from '@/domain/track/DroneTrajectory';
import type { GeofenceBreachAlert } from '@/domain/geofence/GeofenceConflictDetector';
import type { DroneTelemetryFrame } from '@/domain/telemetry/DroneTelemetryFrame';
import {
  initMapUseCase,
  switchMapModeUseCase,
  flyToLocationUseCase,
  zoomMapUseCase,
  getMapViewStateUseCase,
  startManualDrawUseCase,
  stopManualDrawUseCase,
  drawGraphicDataUseCase,
  clearGraphicsUseCase,
  getGraphicsUseCase,
  spatialMeasureUseCase,
  manageRoutePlanUseCase,
  commitMissionRouteUseCase,
  getReconnaissanceTasksUseCase,
  deleteReconnaissanceTaskUseCase,
  connectTelemetryStreamUseCase,
  dualEngineMapAdapter,
} from '@/infrastructure/bootstrap/container';

// ===== 模块级共享单例响应式状态 =====
const currentMode = ref<MapMode>('2D');
const isInitialized = ref(false);
const isLoading = ref(false);
const viewState = ref<MapViewState>({
  mode: '2D',
  center: { lng: 118.7702, lat: 32.0356 },
  zoom: 14,
});

const activeDrawType = ref<DrawShapeType | null>(null);
const graphicsList = ref<TacticalGraphic[]>([]);

// 空间分析与量测状态
const activeMeasureType = ref<'distance' | 'area' | null>(null);
const measureResult = ref<SpatialMeasureResult | null>(null);

// 航线与作战任务规划状态
const isRoutePlanning = ref(false);
const currentPlanningType = ref<MissionTaskType>('route');
const routePlanWaypoints = ref<RoutePlanWaypoint[]>([]);

export interface ActiveExecutionTask {
  taskId: string;
  taskName: string;
  taskType: MissionTaskType;
  trajectoryId: string;
  status: 'running' | 'paused';
  waypoints: RoutePlanWaypoint[];
}

const activeExecutionTask = ref<ActiveExecutionTask | null>(null);
const savedTasksList = shallowRef<ReconnaissanceSubTask[]>([]);

// 目标交互、跟随与光标态势状态
const selectedTargetId = ref<string | null>(null);
const trackedTargetId = ref<string | null>(null);
const cursorPosition = ref<{ lng: number; lat: number; alt?: number } | null>(null);

// 实时遥测流与电子围栏告警状态
const isTelemetryStreaming = ref(false);
const latestTelemetryFrame = ref<DroneTelemetryFrame | null>(null);
const currentBreachAlerts = ref<GeofenceBreachAlert[]>([]);
const is3DModelActive = ref(true);
let unsubscribeTelemetry: (() => void) | null = null;

/**
 * 统一地图核心门面 (Facade Composable)
 * 聚合视口导航、军规标绘、空间量测、航线任务规划于一体
 */
export function useMap() {
  const refreshViewState = () => {
    viewState.value = getMapViewStateUseCase.execute();
  };

  const refreshGraphics = () => {
    graphicsList.value = getGraphicsUseCase.execute();
  };

  // ===== 1. 视口与引擎操作 =====
  const init = async (
    container2D: HTMLElement,
    container3D: HTMLElement,
    options?: MapInitOptions,
  ) => {
    isLoading.value = true;
    try {
      await initMapUseCase.execute(container2D, container3D, options);
      currentMode.value = options?.mode || '2D';
      isInitialized.value = true;
      refreshViewState();
      refreshGraphics();
      await fetchSavedTasks();

      // 注册海空目标交互拾取与鼠标指针移动监听
      dualEngineMapAdapter.onTargetSelect((id) => {
        selectedTargetId.value = id;
      });
      dualEngineMapAdapter.onCursorMove((pos) => {
        cursorPosition.value = pos;
      });
    } catch (err) {
      console.error('地图引擎初始化失败:', err);
      throw err;
    } finally {
      isLoading.value = false;
    }
  };

  const switchMode = async (mode: MapMode) => {
    if (currentMode.value === mode) return;
    isLoading.value = true;
    try {
      await switchMapModeUseCase.execute(mode);
      currentMode.value = mode;
      refreshViewState();
    } catch (err) {
      console.error('切换地图模式失败:', err);
    } finally {
      isLoading.value = false;
    }
  };

  const flyTo = (coord: Coordinate, zoom?: number, durationMs = 1200) => {
    flyToLocationUseCase.execute(coord, zoom, durationMs);
    setTimeout(() => {
      refreshViewState();
    }, durationMs + 100);
  };

  const zoomIn = () => {
    zoomMapUseCase.zoomIn();
    refreshViewState();
  };

  const zoomOut = () => {
    zoomMapUseCase.zoomOut();
    refreshViewState();
  };

  // ===== 2. 战术标绘操作 (含军规箭头与扇形) =====
  const startDraw = (shapeType: DrawShapeType) => {
    activeDrawType.value = shapeType;
    startManualDrawUseCase.execute(shapeType, () => {
      activeDrawType.value = null;
      refreshGraphics();
    });
  };

  const stopDraw = () => {
    activeDrawType.value = null;
    stopManualDrawUseCase.execute();
  };

  const clearGraphics = () => {
    stopDraw();
    clearGraphicsUseCase.execute();
    refreshGraphics();
  };

  // ===== 3. 三维空间分析与战术量测 =====
  const startMeasure = (type: 'distance' | 'area') => {
    activeMeasureType.value = type;
    spatialMeasureUseCase.start(type, (res) => {
      measureResult.value = res;
    });
  };

  const clearMeasure = () => {
    activeMeasureType.value = null;
    measureResult.value = null;
    spatialMeasureUseCase.clear();
  };

  // ===== 4. 作战任务规划与业务闭环 (支持航线/区域/攻击类型) =====
  const startPlanningRoute = (type: MissionTaskType = 'route', onComplete?: (wps: RoutePlanWaypoint[]) => void) => {
    isRoutePlanning.value = true;
    currentPlanningType.value = type;
    manageRoutePlanUseCase.startPlanning(
      (wps) => {
        routePlanWaypoints.value = wps;
      },
      (finalWps) => {
        routePlanWaypoints.value = finalWps;
        isRoutePlanning.value = false;
        if (onComplete) {
          onComplete(finalWps);
        }
      },
      type,
    );
  };

  const stopPlanningRoute = () => {
    isRoutePlanning.value = false;
    manageRoutePlanUseCase.stopPlanning();
  };

  const clearRoutePlan = () => {
    isRoutePlanning.value = false;
    routePlanWaypoints.value = [];
    manageRoutePlanUseCase.clearPlan();
  };

  // 1. 区域巡检演示任务 (莫愁湖闭环防区)
  const loadDemoAreaPlan = () => {
    const demoPlan = new MissionRoutePlan({
      id: 'plan_area_demo',
      name: '莫愁湖核心防区闭环空巡任务',
      type: 'area',
      targetId: 'target_area_mochou',
      callsign: '天鹰-防区巡视',
      waypoints: [
        { id: 'wp1', name: '防区点-1', lng: 118.7520, lat: 32.0250, alt: 220, speedKmh: 160, action: 'recon' },
        { id: 'wp2', name: '防区点-2', lng: 118.7750, lat: 32.0280, alt: 220, speedKmh: 160, action: 'recon' },
        { id: 'wp3', name: '防区点-3', lng: 118.7800, lat: 32.0450, alt: 220, speedKmh: 160, action: 'recon' },
        { id: 'wp4', name: '防区点-4', lng: 118.7580, lat: 32.0480, alt: 220, speedKmh: 160, action: 'recon' },
        { id: 'wp5', name: '防区点-1', lng: 118.7520, lat: 32.0250, alt: 220, speedKmh: 160, action: 'recon' },
      ],
    });
    manageRoutePlanUseCase.renderPlan(demoPlan);
    routePlanWaypoints.value = [...demoPlan.waypoints];
    currentPlanningType.value = 'area';

    // 出动区域巡检无人机
    const trajId = 'traj_area_demo';
    const demoTrajectory = new DroneTrajectory({
      id: trajId,
      name: demoPlan.name,
      callsign: '天鹰-防区巡视',
      iconUrl: '/icons/airplane.svg',
      iconSize: [42, 42],
      waypoints: demoPlan.waypoints.map((w) => ({
        lng: w.lng,
        lat: w.lat,
        alt: w.alt ?? 220,
        actionName: w.name,
      })),
      speedMultiplier: 2.0,
      trailColor: '#00e5ff',
      trailWidth: 3.5,
      showTrail: true,
    });

    if (activeExecutionTask.value) {
      dualEngineMapAdapter.removeDroneTrajectory(activeExecutionTask.value.trajectoryId);
    }
    dualEngineMapAdapter.loadDroneTrajectory(demoTrajectory);
    dualEngineMapAdapter.startDroneTrack(trajId);

    activeExecutionTask.value = {
      taskId: demoPlan.id,
      taskName: demoPlan.name,
      taskType: 'area',
      trajectoryId: trajId,
      status: 'running',
      waypoints: [...demoPlan.waypoints],
    };

    flyTo(demoPlan.waypoints[0], currentMode.value === '3D' ? 14 : 15, 1000);
    return demoPlan;
  };

  // 2. 战术打击演示任务 (突防攻击对岸目标阵地)
  const loadDemoStrikePlan = () => {
    const demoPlan = new MissionRoutePlan({
      id: 'plan_strike_demo',
      name: '特种隐身无人机对岸阵地精确打击任务',
      type: 'strike',
      targetId: 'target_radar_bunker',
      callsign: '攻击-11 突防机',
      waypoints: [
        { id: 'wp1', name: '突防前沿', lng: 118.7450, lat: 32.0200, alt: 120, speedKmh: 300, action: 'takeoff' },
        { id: 'wp2', name: '低空穿透', lng: 118.7580, lat: 32.0310, alt: 90, speedKmh: 320, action: 'recon' },
        { id: 'wp3', name: '末端突防', lng: 118.7680, lat: 32.0390, alt: 80, speedKmh: 340, action: 'recon' },
        { id: 'wp4', name: '打击目标阵地', lng: 118.7760, lat: 32.0440, alt: 50, speedKmh: 350, action: 'strike' },
      ],
    });
    manageRoutePlanUseCase.renderPlan(demoPlan);
    routePlanWaypoints.value = [...demoPlan.waypoints];
    currentPlanningType.value = 'strike';

    // 出动高速突防攻击战机
    const trajId = 'traj_strike_demo';
    const demoTrajectory = new DroneTrajectory({
      id: trajId,
      name: demoPlan.name,
      callsign: '攻击-11 突防机',
      iconUrl: '/icons/airplane.svg',
      iconSize: [44, 44],
      waypoints: demoPlan.waypoints.map((w) => ({
        lng: w.lng,
        lat: w.lat,
        alt: w.alt ?? 90,
        actionName: w.name,
      })),
      speedMultiplier: 3.2, // 320km/h 战术高航速
      trailColor: '#ff3d00', // 橙红火焰突防尾迹
      trailWidth: 4.0,
      showTrail: true,
    });

    if (activeExecutionTask.value) {
      dualEngineMapAdapter.removeDroneTrajectory(activeExecutionTask.value.trajectoryId);
    }
    dualEngineMapAdapter.loadDroneTrajectory(demoTrajectory);
    dualEngineMapAdapter.startDroneTrack(trajId);

    activeExecutionTask.value = {
      taskId: demoPlan.id,
      taskName: demoPlan.name,
      taskType: 'strike',
      trajectoryId: trajId,
      status: 'running',
      waypoints: [...demoPlan.waypoints],
    };

    flyTo(demoPlan.waypoints[0], currentMode.value === '3D' ? 14 : 15, 1000);
    return demoPlan;
  };

  // 3. 常规航线巡航演示任务
  const loadDemoRoutePlan = () => {
    const demoPlan = new MissionRoutePlan({
      id: 'plan_demo_01',
      name: '莫愁湖空域特种侦察航线规划',
      type: 'route',
      targetId: 'target_radar_tower',
      callsign: 'UAV-PRO-01',
      waypoints: [
        { id: 'wp1', name: 'WP-1', lng: 118.7550, lat: 32.0260, alt: 80, speedKmh: 120, action: 'takeoff' },
        { id: 'wp2', name: 'WP-2', lng: 118.7630, lat: 32.0320, alt: 140, speedKmh: 150, action: 'recon' },
        { id: 'wp3', name: 'WP-3', lng: 118.7710, lat: 32.0370, alt: 200, speedKmh: 140, action: 'hover', hoverSec: 30 },
        { id: 'wp4', name: 'WP-4', lng: 118.7780, lat: 32.0430, alt: 160, speedKmh: 150, action: 'recon' },
        { id: 'wp5', name: 'WP-5', lng: 118.7680, lat: 32.0460, alt: 140, speedKmh: 150, action: 'recon' },
        { id: 'wp6', name: 'WP-6', lng: 118.7550, lat: 32.0260, alt: 80, speedKmh: 120, action: 'land' },
      ],
    });
    manageRoutePlanUseCase.renderPlan(demoPlan);
    routePlanWaypoints.value = [...demoPlan.waypoints];
    currentPlanningType.value = 'route';

    // 自动部署演示无人机飞行仿真推演
    const trajId = 'traj_demo_01';
    const demoTrajectory = new DroneTrajectory({
      id: trajId,
      name: demoPlan.name,
      callsign: '天鹰-演示机',
      iconUrl: '/icons/airplane.svg',
      iconSize: [42, 42],
      waypoints: demoPlan.waypoints.map((w) => ({
        lng: w.lng,
        lat: w.lat,
        alt: w.alt ?? 150,
        actionName: w.name,
      })),
      speedMultiplier: 2.2,
      trailColor: '#ffea00',
      trailWidth: 3.5,
      showTrail: true,
    });

    if (activeExecutionTask.value) {
      dualEngineMapAdapter.removeDroneTrajectory(activeExecutionTask.value.trajectoryId);
    }
    dualEngineMapAdapter.loadDroneTrajectory(demoTrajectory);
    dualEngineMapAdapter.startDroneTrack(trajId);

    activeExecutionTask.value = {
      taskId: demoPlan.id,
      taskName: demoPlan.name,
      taskType: 'route',
      trajectoryId: trajId,
      status: 'running',
      waypoints: [...demoPlan.waypoints],
    };

    flyTo(demoPlan.waypoints[0], currentMode.value === '3D' ? 14 : 15, 1000);
    return demoPlan;
  };

  /**
   * 业务与仿真闭环：将当前在地图上规划的航线提交至后台，并立即启动无人机沿线巡航飞行推演
   */
  const commitRouteToTask = async (taskName?: string, taskType?: MissionTaskType) => {
    if (routePlanWaypoints.value.length < 3) {
      throw new Error('规划任务至少需要 3 个坐标点构成有效航线或防区！');
    }

    const resolvedType = taskType || currentPlanningType.value || 'route';
    const finalWaypoints = [...routePlanWaypoints.value];

    // 如果是区域任务且首尾未闭合，自动首尾闭合形成防区环绕
    if (resolvedType === 'area' && finalWaypoints.length >= 3) {
      const first = finalWaypoints[0];
      const last = finalWaypoints[finalWaypoints.length - 1];
      if (Math.abs(first.lng - last.lng) > 0.0001 || Math.abs(first.lat - last.lat) > 0.0001) {
        finalWaypoints.push({ ...first, id: `wp_close_${Date.now()}`, name: `${first.name}(闭合点)` });
      }
    }

    const typePrefix = resolvedType === 'area' ? '区域巡检' : resolvedType === 'strike' ? '战术打击' : '空巡侦察';
    const finalTaskName = taskName || `${typePrefix}任务-${Date.now().toString().slice(-4)}`;

    const plan = new MissionRoutePlan({
      id: `plan_commit_${Date.now()}`,
      name: finalTaskName,
      type: resolvedType,
      targetId: 'target_auto_bound',
      callsign: resolvedType === 'strike' ? '攻击-11 突防机' : resolvedType === 'area' ? '天鹰-防区巡视' : '长鹰-巡检机',
      waypoints: finalWaypoints,
    });

    // 1. 持久化存储到后端任务仓储
    const task = await commitMissionRouteUseCase.execute(plan);

    // 2. 结束交互打点模式，并在地图上高亮保留并呈现规划航线
    stopPlanningRoute();
    manageRoutePlanUseCase.renderPlan(plan);

    // 3. 生成执行无人机并启动飞行推演 (根据任务类型配置航速与战术尾焰)
    const trajId = `uav_exec_${task.id || Date.now()}`;
    const speedMult = resolvedType === 'strike' ? 3.5 : resolvedType === 'area' ? 2.0 : 2.5;
    const trailColor = resolvedType === 'strike' ? '#ff3d00' : resolvedType === 'area' ? '#00e5ff' : '#ffea00';
    const droneCallsign = finalTaskName.length > 12 ? finalTaskName.slice(0, 12) : finalTaskName;
    const defaultAlt = resolvedType === 'strike' ? 100 : resolvedType === 'area' ? 220 : 160;

    const trajectory = new DroneTrajectory({
      id: trajId,
      name: task.name,
      callsign: droneCallsign,
      iconUrl: '/icons/airplane.svg',
      iconSize: [42, 42],
      waypoints: finalWaypoints.map((w, idx) => ({
        lng: w.lng,
        lat: w.lat,
        alt: (w.alt && w.alt > 0) ? w.alt : defaultAlt,
        actionName: w.name || `航点-${idx + 1}`,
      })),
      speedMultiplier: speedMult,
      trailColor,
      trailWidth: resolvedType === 'strike' ? 4.0 : 3.5,
      showTrail: true,
    });

    if (activeExecutionTask.value) {
      dualEngineMapAdapter.removeDroneTrajectory(activeExecutionTask.value.trajectoryId);
    }
    dualEngineMapAdapter.loadDroneTrajectory(trajectory);
    dualEngineMapAdapter.startDroneTrack(trajId);

    activeExecutionTask.value = {
      taskId: task.id || trajId,
      taskName: task.name,
      taskType: resolvedType,
      trajectoryId: trajId,
      status: 'running',
      waypoints: [...finalWaypoints],
    };

    // 4. 视角平滑飞跃至任务起始航路点
    if (finalWaypoints.length > 0) {
      flyTo(finalWaypoints[0], currentMode.value === '3D' ? 14 : 15, 1000);
    }

    // 5. 自动同步刷新后端 SQLite 数据库中的已存任务列表
    await fetchSavedTasks();

    return task;
  };

  const fetchSavedTasks = async (): Promise<ReconnaissanceSubTask[]> => {
    try {
      const list = await getReconnaissanceTasksUseCase.execute();
      savedTasksList.value = list;
      return list;
    } catch (err) {
      console.warn('[useMap] 从后端 SQLite 读取侦察任务列表失败:', err);
      return [];
    }
  };

  const deleteSavedTask = async (taskId: string) => {
    await deleteReconnaissanceTaskUseCase.execute(taskId);
    if (activeExecutionTask.value?.taskId === taskId) {
      stopExecutionTask();
    }
    await fetchSavedTasks();
  };

  const loadSavedTaskToMap = (task: ReconnaissanceSubTask) => {
    const defaultAlt = task.type === 'strike' ? 100 : task.type === 'area' ? 220 : 160;
    const speedKmh = task.type === 'strike' ? 320 : task.type === 'area' ? 160 : 200;
    const speedMult = task.type === 'strike' ? 3.5 : task.type === 'area' ? 2.0 : 2.5;
    const trailColor = task.type === 'strike' ? '#ff3d00' : task.type === 'area' ? '#00e5ff' : '#ffea00';
    const callsign = task.name.length > 12 ? task.name.slice(0, 12) : task.name;

    const plan = new MissionRoutePlan({
      id: task.id || `plan_restore_${Date.now()}`,
      name: task.name,
      type: task.type,
      targetId: task.targetId,
      callsign,
      waypoints: task.area.map((coord, idx) => ({
        lng: coord.lng,
        lat: coord.lat,
        alt: coord.alt ?? defaultAlt,
        action: task.type === 'strike' ? (idx === task.area.length - 1 ? 'strike' : 'recon') : 'recon',
        id: `wp_${idx + 1}`,
        name: `WP-${idx + 1}`,
        speedKmh,
      })),
    });

    manageRoutePlanUseCase.renderPlan(plan);
    routePlanWaypoints.value = [...plan.waypoints];
    currentPlanningType.value = task.type;

    // 部署推演无人机
    const trajId = `uav_exec_${task.id || Date.now()}`;
    const trajectory = new DroneTrajectory({
      id: trajId,
      name: task.name,
      callsign,
      iconUrl: '/icons/airplane.svg',
      iconSize: [42, 42],
      waypoints: plan.waypoints.map((w) => ({
        lng: w.lng,
        lat: w.lat,
        alt: w.alt ?? defaultAlt,
        actionName: w.name,
      })),
      speedMultiplier: speedMult,
      trailColor,
      trailWidth: task.type === 'strike' ? 4.0 : 3.5,
      showTrail: true,
    });

    if (activeExecutionTask.value) {
      dualEngineMapAdapter.removeDroneTrajectory(activeExecutionTask.value.trajectoryId);
    }
    dualEngineMapAdapter.loadDroneTrajectory(trajectory);
    dualEngineMapAdapter.startDroneTrack(trajId);

    activeExecutionTask.value = {
      taskId: task.id || trajId,
      taskName: task.name,
      taskType: task.type,
      trajectoryId: trajId,
      status: 'running',
      waypoints: [...plan.waypoints],
    };

    if (task.area.length > 0) {
      flyTo(task.area[0], currentMode.value === '3D' ? 14 : 15, 1000);
    }
  };

  const pauseExecutionTask = () => {
    if (!activeExecutionTask.value) return;
    dualEngineMapAdapter.pauseDroneTrack(activeExecutionTask.value.trajectoryId);
    activeExecutionTask.value.status = 'paused';
  };

  const resumeExecutionTask = () => {
    if (!activeExecutionTask.value) return;
    dualEngineMapAdapter.startDroneTrack(activeExecutionTask.value.trajectoryId);
    activeExecutionTask.value.status = 'running';
  };

  const stopExecutionTask = () => {
    if (activeExecutionTask.value) {
      dualEngineMapAdapter.removeDroneTrajectory(activeExecutionTask.value.trajectoryId);
      activeExecutionTask.value = null;
    }
    clearRoutePlan();
  };

  // ===== 5. 目标交互与视角锁定跟随 =====
  const selectTarget = (targetId: string | null) => {
    selectedTargetId.value = targetId;
    dualEngineMapAdapter.selectTarget(targetId);
  };

  const trackTarget = (targetId: string | null) => {
    trackedTargetId.value = targetId;
    dualEngineMapAdapter.trackTarget(targetId);
  };

  // ===== 6. 实时遥测流通信与电子围栏冲突告警 =====
  const startTelemetryStream = async (wsUrl?: string) => {
    if (isTelemetryStreaming.value) return;

    unsubscribeTelemetry = await connectTelemetryStreamUseCase.execute(
      wsUrl,
      (frame) => {
        latestTelemetryFrame.value = frame;
      },
      (alerts) => {
        currentBreachAlerts.value = alerts;
      },
    );
    isTelemetryStreaming.value = true;
  };

  const stopTelemetryStream = () => {
    if (unsubscribeTelemetry) {
      unsubscribeTelemetry();
      unsubscribeTelemetry = null;
    }
    isTelemetryStreaming.value = false;
    currentBreachAlerts.value = [];
  };

  const toggleTelemetryStream = () => {
    if (isTelemetryStreaming.value) {
      stopTelemetryStream();
    } else {
      startTelemetryStream();
    }
  };

  // ===== 6. 三维真实无人机模型控制 =====
  const toggle3DModel = (enabled?: boolean) => {
    is3DModelActive.value = enabled !== undefined ? enabled : !is3DModelActive.value;
    dualEngineMapAdapter.setDrone3DModelEnabled(is3DModelActive.value);
  };

  /**
   * 数据驱动批量绘制典型战术几何与军规标号数据
   */
  const drawPresetData = () => {
    const timestamp = Date.now();

    const sampleGraphics: TacticalGraphic[] = [
      // 军标 1: 进攻方向粗直箭头 (突击主突方向)
      new TacticalGraphic({
        id: `preset_attack_arrow_${timestamp}`,
        name: '主攻突击方向箭头',
        shapeType: 'attack_arrow',
        coordinates: MilitaryPlotAlgorithms.calculateAttackArrow(
          { lng: 118.7540, lat: 32.0220 },
          { lng: 118.7690, lat: 32.0330 },
        ),
        style: {
          strokeColor: '#ff0033',
          strokeWidth: 2.5,
          fillColor: 'rgba(255, 0, 51, 0.35)',
          label: '【主突战术箭头】突破口Alpha',
        },
      }),

      // 军标 2: 钳击双箭头 (合围钳击方向)
      new TacticalGraphic({
        id: `preset_double_arrow_${timestamp}`,
        name: '分队钳击合围箭头',
        shapeType: 'double_arrow',
        coordinates: MilitaryPlotAlgorithms.calculateDoubleArrow(
          { lng: 118.7600, lat: 32.0460 },
          { lng: 118.7750, lat: 32.0360 },
        ),
        style: {
          strokeColor: '#ffaa00',
          strokeWidth: 2.5,
          fillColor: 'rgba(255, 170, 0, 0.32)',
          label: '【双向钳击】两翼合围',
        },
      }),

      // 军标 3: 雷达波束探测扇形区
      new TacticalGraphic({
        id: `preset_radar_sector_${timestamp}`,
        name: '莫愁湖雷达视场波束',
        shapeType: 'sector',
        coordinates: MilitaryPlotAlgorithms.calculateSector(
          { lng: 118.7705, lat: 32.0415 },
          950,
          225, // 朝向西南
          70,  // 张角 70 度
        ),
        style: {
          strokeColor: '#00e5ff',
          strokeWidth: 2,
          fillColor: 'rgba(0, 229, 255, 0.25)',
          label: '【雷达波束】扫掠区(70°/950m)',
        },
      }),

      // 立体空域拦截圆柱体
      new TacticalGraphic({
        id: `preset_circle_${timestamp}`,
        name: '电磁压制核心辐射空域柱',
        shapeType: 'circle',
        coordinates: [{ lng: 118.7680, lat: 32.0310, alt: 0 }],
        radius: 650,
        height: 0,
        extrudedHeight: 800,
        style: {
          strokeColor: '#ff3366',
          strokeWidth: 2,
          fillColor: 'rgba(255, 51, 102, 0.28)',
          label: '【立体压制柱】杀伤半径 650m',
        },
      }),

      // 监视矩形空域体
      new TacticalGraphic({
        id: `preset_rect_${timestamp}`,
        name: '莫愁湖重点监视立体空域',
        shapeType: 'rectangle',
        coordinates: [
          { lng: 118.7620, lat: 32.0435 },
          { lng: 118.7785, lat: 32.0435 },
          { lng: 118.7785, lat: 32.0380 },
          { lng: 118.7620, lat: 32.0380 },
          { lng: 118.7620, lat: 32.0435 },
        ],
        height: 20,
        extrudedHeight: 500,
        style: {
          strokeColor: '#00ffcc',
          strokeWidth: 2,
          fillColor: 'rgba(0, 255, 204, 0.2)',
          label: '【立体空域】监视网格体',
        },
      }),
    ];

    drawGraphicDataUseCase.executeBatch(sampleGraphics);
    refreshGraphics();
  };

  return {
    // 视口与引擎
    currentMode,
    isInitialized,
    isLoading,
    viewState,
    init,
    switchMode,
    flyTo,
    zoomIn,
    zoomOut,
    refreshViewState,

    // 战术几何标绘 (含军规箭头与扇形)
    activeDrawType,
    graphicsList,
    startDraw,
    stopDraw,
    clearGraphics,
    drawPresetData,
    refreshGraphics,

    // 三维空间分析与量测
    activeMeasureType,
    measureResult,
    startMeasure,
    clearMeasure,

    // 交互式航线规划与业务闭环
    isRoutePlanning,
    currentPlanningType,
    routePlanWaypoints,
    activeExecutionTask,
    startPlanningRoute,
    stopPlanningRoute,
    clearRoutePlan,
    loadDemoAreaPlan,
    loadDemoStrikePlan,
    loadDemoRoutePlan,
    commitRouteToTask,
    pauseExecutionTask,
    resumeExecutionTask,
    stopExecutionTask,

    // SQLite 持久化任务库
    savedTasksList,
    fetchSavedTasks,
    deleteSavedTask,
    loadSavedTaskToMap,

    // 目标交互与视角锁定跟踪
    selectedTargetId,
    trackedTargetId,
    cursorPosition,
    selectTarget,
    trackTarget,

    // 实时遥测流与电子围栏告警
    isTelemetryStreaming,
    latestTelemetryFrame,
    currentBreachAlerts,
    startTelemetryStream,
    stopTelemetryStream,
    toggleTelemetryStream,

    // 三维精细化资产模型开关
    is3DModelActive,
    toggle3DModel,
  };
}

import type { Coordinate } from '@/domain/geometry/Coordinate';
import type { MapMode } from '@/domain/map/MapMode';
import type { MapLayerType } from '@/domain/map/LayerType';
import type { DrawShapeType, TacticalGraphic } from '@/domain/geometry/TacticalGraphic';
import type { DroneTrajectory } from '@/domain/track/DroneTrajectory';
import type { SpatialMeasureResult } from '@/domain/geometry/SpatialCalculator';
import type { MissionRoutePlan, RoutePlanWaypoint } from '@/domain/mission/MissionRoutePlan';
import type { DroneTelemetryFrame } from '@/domain/telemetry/DroneTelemetryFrame';

export interface MapInitOptions {
  center?: Coordinate;
  zoom?: number;
  mode?: MapMode;
}

export interface MapPort {
  readonly mode: MapMode;
  init(container: HTMLElement, options?: MapInitOptions): Promise<void>;
  setCenter(coord: Coordinate, zoom?: number): void;
  getCenter(): Coordinate;
  getZoom(): number;
  flyTo(coord: Coordinate, zoom?: number, durationMs?: number): void;
  zoomIn(): void;
  zoomOut(): void;
  resize(): void;
  dispose(): void;

  // 物理图层分层管理 (标绘层与飞机轨迹层相互隔离)
  setLayerVisible(layer: MapLayerType, visible: boolean): void;
  getLayerVisible(layer: MapLayerType): boolean;
  clearLayer(layer: MapLayerType): void;

  // 战术几何标绘（手动交互与数据渲染，含军标箭头与扇形）
  startManualDraw(shapeType: DrawShapeType, onComplete?: (graphic: TacticalGraphic) => void): void;
  stopManualDraw(): void;
  drawGraphic(graphic: TacticalGraphic): void;
  removeGraphic(id: string): void;
  clearAllGraphics(): void;
  getAllGraphics(): TacticalGraphic[];

  // 无人机轨迹运动与推演模拟
  loadDroneTrajectory(trajectory: DroneTrajectory): void;
  startDroneTrack(trajectoryId: string): void;
  pauseDroneTrack(trajectoryId: string): void;
  resetDroneTrack(trajectoryId: string): void;
  removeDroneTrajectory(trajectoryId: string): void;
  clearAllTrajectories(): void;

  // 三维空间分析与战术量测
  startSpatialMeasure(type: 'distance' | 'area', onUpdate?: (result: SpatialMeasureResult) => void): void;
  clearSpatialMeasure(): void;

  // 交互式航线任务规划与航点编辑 (支持区域闭合、战术打击与常规航线)
  startRoutePlanning(
    onWaypointChange?: (waypoints: RoutePlanWaypoint[]) => void,
    onComplete?: (waypoints: RoutePlanWaypoint[]) => void,
    taskType?: 'route' | 'area' | 'strike',
  ): void;
  stopRoutePlanning(): void;
  renderRoutePlan(plan: MissionRoutePlan): void;
  clearRoutePlan(): void;

  // 实时流式态势遥测与电子围栏告警
  updateDroneLivePosition(frame: DroneTelemetryFrame): void;
  highlightGeofenceAlert(geofenceId: string, isAlerting: boolean): void;

  // 目标交互与视角锁定跟随
  selectTarget(targetId: string | null): void;
  trackTarget(targetId: string | null): void;
  getSelectedTargetId(): string | null;
  getTrackedTargetId(): string | null;
  onTargetSelect(callback: (targetId: string | null) => void): () => void;

  // 鼠标移动与空间位置侦测监听
  onCursorMove(callback: (pos: { lng: number; lat: number; alt?: number } | null) => void): () => void;

  // 三维精细化资产 (GLTF 真实 3D 飞机模型开关)
  setDrone3DModelEnabled(enabled: boolean): void;
}

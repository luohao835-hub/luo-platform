import type { Coordinate } from '@/domain/geometry/Coordinate';
import type { MapMode } from '@/domain/map/MapMode';
import type { MapLayerType } from '@/domain/map/LayerType';
import type { MapViewState } from '@/domain/map/MapViewState';
import type { SpatialMeasureResult } from '@/domain/geometry/SpatialCalculator';
import type { MissionRoutePlan, RoutePlanWaypoint } from '@/domain/mission/MissionRoutePlan';
import type { DroneTelemetryFrame } from '@/domain/telemetry/DroneTelemetryFrame';
import type { MapInitOptions, MapPort } from '@/ports/map/MapPort';
import type { DualEngineMapPort } from '@/ports/map/DualEngineMapPort';
import type { DrawShapeType, TacticalGraphic } from '@/domain/geometry/TacticalGraphic';
import type { DroneTrajectory } from '@/domain/track/DroneTrajectory';
import { OpenLayersMapAdapter } from '@/adapters/map/openlayers/OpenLayersMapAdapter';
import { CesiumMapAdapter } from '@/adapters/map/cesium/CesiumMapAdapter';

/**
 * 统一多引擎 GIS 调度适配器
 * 基于【策略模式 + 注册表模式】设计，
 * 对未来新增的任意第三方或自研 GIS 渲染引擎（Mapbox, Leaflet, Three.js 等）完全开放扩展。
 */
export class DualEngineMapAdapter implements DualEngineMapPort {
  private currentMode: MapMode = '2D';
  private readonly engines: Map<MapMode, MapPort> = new Map();
  private readonly graphicsStore: Map<string, TacticalGraphic> = new Map();
  private readonly layerVisibilityMap: Map<MapLayerType, boolean> = new Map([
    ['graphics', true],
    ['tracks', true],
  ]);
  private isInitialized = false;

  constructor(
    enginesOrUrls?: MapPort[] | string[],
    initialMode: MapMode = '2D',
  ) {
    this.currentMode = initialMode;

    if (Array.isArray(enginesOrUrls) && enginesOrUrls.length > 0 && typeof enginesOrUrls[0] === 'object') {
      // 依赖注入形式：直接传入已组装的引擎列表
      for (const engine of enginesOrUrls as MapPort[]) {
        this.registerEngine(engine);
      }
    } else {
      // 默认基础装配：注册 2D (OpenLayers) 与 3D (Cesium)
      const urls = (Array.isArray(enginesOrUrls) ? enginesOrUrls : []) as string[];
      this.registerEngine(new OpenLayersMapAdapter(urls));
      this.registerEngine(new CesiumMapAdapter(urls));
    }
  }

  /**
   * 动态注册新的 GIS 引擎适配器 (面向扩展开放)
   */
  registerEngine(engine: MapPort): this {
    this.engines.set(engine.mode, engine);
    return this;
  }

  /**
   * 获取当前活动的 GIS 渲染引擎
   */
  private getActiveEngine(): MapPort {
    const active = this.engines.get(this.currentMode);
    if (active) return active;

    const fallback = this.engines.values().next().value;
    if (!fallback) {
      throw new Error(`[DualEngineMapAdapter] 当前无可用 GIS 渲染引擎，请先注册！`);
    }
    return fallback;
  }

  /**
   * 获取除当前活动引擎之外的其他已注册引擎 (用于广播同步)
   */
  private getInactiveEngines(): MapPort[] {
    const active = this.getActiveEngine();
    return Array.from(this.engines.values()).filter((engine) => engine !== active);
  }

  getCurrentMode(): MapMode {
    return this.currentMode;
  }

  async init(
    container2DOrMap: HTMLElement | Record<string, HTMLElement>,
    container3DOrOptions?: HTMLElement | MapInitOptions,
    options?: MapInitOptions,
  ): Promise<void> {
    let initOptions: MapInitOptions | undefined;
    const initPromises: Promise<void>[] = [];

    const isDomElement =
      typeof HTMLElement !== 'undefined'
        ? container2DOrMap instanceof HTMLElement
        : (container2DOrMap && typeof container2DOrMap === 'object' && 'nodeType' in container2DOrMap);

    if (isDomElement) {
      // 兼容参数序列: (container2D, container3D, options)
      const c2D = container2DOrMap as HTMLElement;
      const c3D = container3DOrOptions as HTMLElement;
      initOptions = options;

      const ol = this.engines.get('2D');
      const cesium = this.engines.get('3D');
      if (ol && c2D) initPromises.push(ol.init(c2D, initOptions));
      if (cesium && c3D) initPromises.push(cesium.init(c3D, initOptions));
    } else {
      // 容器映射字典形态: { '2D': el1, '3D': el2, ...otherEngines }
      initOptions = container3DOrOptions as MapInitOptions;
      for (const [mode, container] of Object.entries(container2DOrMap)) {
        const engine = this.engines.get(mode as MapMode);
        if (engine && container) {
          initPromises.push(engine.init(container, initOptions));
        }
      }
    }

    if (initOptions?.mode) {
      this.currentMode = initOptions.mode;
    }

    await Promise.all(initPromises);
    this.isInitialized = true;
    this.resize();
  }

  /**
   * 引擎视口平滑切换 (自动在任意已注册引擎间迁移视口坐标与层级)
   */
  async switchMode(targetMode: MapMode): Promise<void> {
    if (!this.isInitialized || this.currentMode === targetMode) return;
    const targetEngine = this.engines.get(targetMode);
    if (!targetEngine) {
      console.warn(`[DualEngineMapAdapter] 目标 GIS 引擎未注册: ${targetMode}`);
      return;
    }

    const currentEngine = this.getActiveEngine();
    const center = currentEngine.getCenter();
    const zoom = currentEngine.getZoom();

    this.currentMode = targetMode;
    targetEngine.setCenter(center, zoom);
    targetEngine.resize();
  }

  getViewState(): MapViewState {
    const active = this.getActiveEngine();
    const center = active.getCenter();
    return {
      mode: this.currentMode,
      center,
      zoom: active.getZoom(),
      cameraAltitude: center.alt,
    };
  }

  setCenter(coord: Coordinate, zoom?: number): void {
    this.getActiveEngine().setCenter(coord, zoom);
  }

  flyTo(coord: Coordinate, zoom?: number, durationMs = 1200): void {
    this.getActiveEngine().flyTo(coord, zoom, durationMs);
  }

  zoomIn(): void {
    this.getActiveEngine().zoomIn();
  }

  zoomOut(): void {
    this.getActiveEngine().zoomOut();
  }

  resize(): void {
    for (const engine of this.engines.values()) {
      engine.resize();
    }
  }

  dispose(): void {
    for (const engine of this.engines.values()) {
      engine.dispose();
    }
    this.graphicsStore.clear();
    this.isInitialized = false;
  }

  startManualDraw(shapeType: DrawShapeType, onComplete?: (graphic: TacticalGraphic) => void): void {
    const activeEngine = this.getActiveEngine();
    const inactiveEngines = this.getInactiveEngines();

    activeEngine.startManualDraw(shapeType, (graphic) => {
      // 1. 存入多引擎中心仓储
      this.graphicsStore.set(graphic.id, graphic);

      // 2. 自动广播同步给所有非活动引擎 (无论有多少个引擎均无缝镜像)
      for (const engine of inactiveEngines) {
        engine.drawGraphic(graphic);
      }

      // 3. 向上回传
      if (onComplete) {
        onComplete(graphic);
      }
    });
  }

  stopManualDraw(): void {
    for (const engine of this.engines.values()) {
      engine.stopManualDraw();
    }
  }

  drawGraphic(graphic: TacticalGraphic): void {
    this.graphicsStore.set(graphic.id, graphic);
    // 广播渲染给所有已注册引擎
    for (const engine of this.engines.values()) {
      engine.drawGraphic(graphic);
    }
  }

  removeGraphic(id: string): void {
    this.graphicsStore.delete(id);
    for (const engine of this.engines.values()) {
      engine.removeGraphic(id);
    }
  }

  clearAllGraphics(): void {
    this.graphicsStore.clear();
    for (const engine of this.engines.values()) {
      engine.clearAllGraphics();
    }
  }

  getAllGraphics(): TacticalGraphic[] {
    return Array.from(this.graphicsStore.values());
  }

  // ================= 无人机轨迹运动多引擎广播实现 =================

  loadDroneTrajectory(trajectory: DroneTrajectory): void {
    for (const engine of this.engines.values()) {
      engine.loadDroneTrajectory(trajectory);
    }
  }

  startDroneTrack(trajectoryId: string): void {
    for (const engine of this.engines.values()) {
      engine.startDroneTrack(trajectoryId);
    }
  }

  pauseDroneTrack(trajectoryId: string): void {
    for (const engine of this.engines.values()) {
      engine.pauseDroneTrack(trajectoryId);
    }
  }

  resetDroneTrack(trajectoryId: string): void {
    for (const engine of this.engines.values()) {
      engine.resetDroneTrack(trajectoryId);
    }
  }

  removeDroneTrajectory(trajectoryId: string): void {
    for (const engine of this.engines.values()) {
      engine.removeDroneTrajectory(trajectoryId);
    }
  }

  clearAllTrajectories(): void {
    for (const engine of this.engines.values()) {
      engine.clearAllTrajectories();
    }
  }

  // ================= 物理图层多引擎调度广播实现 =================

  setLayerVisible(layer: MapLayerType, visible: boolean): void {
    this.layerVisibilityMap.set(layer, visible);
    for (const engine of this.engines.values()) {
      engine.setLayerVisible(layer, visible);
    }
  }

  getLayerVisible(layer: MapLayerType): boolean {
    return this.layerVisibilityMap.get(layer) ?? true;
  }

  clearLayer(layer: MapLayerType): void {
    for (const engine of this.engines.values()) {
      engine.clearLayer(layer);
    }
  }

  // ================= 三维空间分析与量测广播实现 =================

  startSpatialMeasure(type: 'distance' | 'area', onUpdate?: (result: SpatialMeasureResult) => void): void {
    this.getActiveEngine().startSpatialMeasure(type, onUpdate);
  }

  clearSpatialMeasure(): void {
    for (const engine of this.engines.values()) {
      engine.clearSpatialMeasure();
    }
  }

  // ================= 交互式航线任务规划广播实现 =================

  startRoutePlanning(
    onWaypointChange?: (waypoints: RoutePlanWaypoint[]) => void,
    onComplete?: (waypoints: RoutePlanWaypoint[]) => void,
    taskType?: 'route' | 'area' | 'strike',
  ): void {
    this.getActiveEngine().startRoutePlanning(onWaypointChange, onComplete, taskType);
  }

  stopRoutePlanning(): void {
    for (const engine of this.engines.values()) {
      engine.stopRoutePlanning();
    }
  }

  renderRoutePlan(plan: MissionRoutePlan): void {
    for (const engine of this.engines.values()) {
      engine.renderRoutePlan(plan);
    }
  }

  clearRoutePlan(): void {
    for (const engine of this.engines.values()) {
      engine.clearRoutePlan();
    }
  }

  // ================= 实时流式态势遥测与电子围栏告警广播 =================

  updateDroneLivePosition(frame: DroneTelemetryFrame): void {
    for (const engine of this.engines.values()) {
      engine.updateDroneLivePosition(frame);
    }
  }

  highlightGeofenceAlert(geofenceId: string, isAlerting: boolean): void {
    for (const engine of this.engines.values()) {
      engine.highlightGeofenceAlert(geofenceId, isAlerting);
    }
  }

  // ================= 目标交互与视角锁定跟随广播实现 =================

  selectTarget(targetId: string | null): void {
    for (const engine of this.engines.values()) {
      engine.selectTarget(targetId);
    }
  }

  getSelectedTargetId(): string | null {
    return this.getActiveEngine().getSelectedTargetId();
  }

  getTrackedTargetId(): string | null {
    return this.getActiveEngine().getTrackedTargetId();
  }

  trackTarget(targetId: string | null): void {
    for (const engine of this.engines.values()) {
      engine.trackTarget(targetId);
    }
  }

  onTargetSelect(callback: (targetId: string | null) => void): () => void {
    const unsubs = Array.from(this.engines.values()).map((e) => e.onTargetSelect(callback));
    return () => unsubs.forEach((u) => u());
  }

  onCursorMove(callback: (pos: { lng: number; lat: number; alt?: number } | null) => void): () => void {
    const unsubs = Array.from(this.engines.values()).map((e) => e.onCursorMove(callback));
    return () => unsubs.forEach((u) => u());
  }

  setDrone3DModelEnabled(enabled: boolean): void {
    for (const engine of this.engines.values()) {
      engine.setDrone3DModelEnabled(enabled);
    }
  }
}

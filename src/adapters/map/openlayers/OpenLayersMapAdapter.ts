import OlMap from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import OSM from 'ol/source/OSM';
import XYZ from 'ol/source/XYZ';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import LineString from 'ol/geom/LineString';
import Polygon from 'ol/geom/Polygon';
import CircleGeom from 'ol/geom/Circle';
import Draw, { createBox, createRegularPolygon, type GeometryFunction } from 'ol/interaction/Draw';
import { Style, Fill, Stroke, Circle as CircleStyle, Text, Icon } from 'ol/style';
import { fromLonLat, toLonLat } from 'ol/proj';
import type { Coordinate } from '@/domain/geometry/Coordinate';
import type { MapMode } from '@/domain/map/MapMode';
import type { MapLayerType } from '@/domain/map/LayerType';
import type { MapInitOptions, MapPort } from '@/ports/map/MapPort';
import { TacticalGraphic, type DrawShapeType } from '@/domain/geometry/TacticalGraphic';
import type { DroneTrajectory } from '@/domain/track/DroneTrajectory';
import { MilitaryPlotAlgorithms } from '@/domain/geometry/MilitaryPlotAlgorithms';
import { SpatialCalculator, type SpatialMeasureResult } from '@/domain/geometry/SpatialCalculator';
import type { MissionRoutePlan, RoutePlanWaypoint } from '@/domain/mission/MissionRoutePlan';
import type { DroneTelemetryFrame } from '@/domain/telemetry/DroneTelemetryFrame';

/**
 * 将配置的原始切片 URL 规整为 OpenLayers XYZ 格式
 * 自动识别 TMS 格式并追加 {-y} 坐标翻转
 */
function resolveOlTileUrl(rawUrl: string): string {
  let url = rawUrl.trim();
  if (!url) return '';
  if (url.includes('{z}')) {
    return url;
  }
  url = url.replace(/\/+$/, '');
  if (/:\d+$/.test(url)) {
    url += '/map';
  }
  return `${url}/{z}/{x}/{-y}.png`;
}

export class OpenLayersMapAdapter implements MapPort {
  public readonly mode: MapMode = '2D';
  private map: OlMap | null = null;
  private view: View | null = null;
  private defaultCenter: Coordinate = { lng: 118.7702, lat: 32.0356 }; // 默认莫愁湖切片中心坐标
  private defaultZoom = 14;

  private readonly customMapUrls: string[];

  // 物理分层 1: 战术标绘图层 (点、线、圆、矩形、多边形等态势几何图元)
  private readonly graphicsSource: VectorSource;
  private graphicsLayer: VectorLayer | null = null;

  // 物理分层 2: 飞机航迹动态图层 (无人机、飞行航线与动态尾迹)
  private readonly tracksSource: VectorSource;
  private tracksLayer: VectorLayer | null = null;

  // 物理分层 3: 空间量测图层 (zIndex: 110)
  private readonly measureSource: VectorSource;
  private measureLayer: VectorLayer | null = null;
  private currentMeasureInteraction: Draw | null = null;

  // 物理分层 4: 航线任务规划图层 (zIndex: 120)
  private readonly routePlanSource: VectorSource;
  private routePlanLayer: VectorLayer | null = null;
  private currentRoutePlanningInteraction: Draw | null = null;
  private activeRoutePlanWaypoints: RoutePlanWaypoint[] = [];
  private routePlanContextMenuHandler: ((e: MouseEvent) => void) | null = null;
  private routePlanDblClickHandler: (() => void) | null = null;

  private currentDrawInteraction: Draw | null = null;
  private readonly graphicsMap: Map<string, TacticalGraphic> = new Map();
  private readonly trajectoryMap: Map<string, DroneTrajectory> = new Map();
  private readonly trajectoryFeatures: Map<
    string,
    { drone: Feature<Point>; trail: Feature<LineString>; plan: Feature<LineString> }
  > = new Map();
  private readonly liveDroneFeatures: Map<string, Feature<Point>> = new Map();
  private readonly liveDroneTrailFeatures: Map<string, Feature<LineString>> = new Map();
  private readonly liveDroneRouteFeatures: Map<string, Feature<LineString>> = new Map();
  private readonly liveDroneHistoryCoords: Map<string, Coordinate[]> = new Map();
  private selectedTargetId: string | null = null;
  private trackedTargetId: string | null = null;
  private readonly targetSelectCallbacks: Set<(id: string | null) => void> = new Set();
  private readonly cursorMoveCallbacks: Set<(pos: { lng: number; lat: number; alt?: number } | null) => void> = new Set();
  private animTimer: number | null = null;

  constructor(customMapUrls: string[] = []) {
    this.customMapUrls = customMapUrls;
    this.graphicsSource = new VectorSource();
    this.tracksSource = new VectorSource();
    this.measureSource = new VectorSource();
    this.routePlanSource = new VectorSource();
  }

  async init(container: HTMLElement, options?: MapInitOptions): Promise<void> {
    const centerCoord = options?.center || this.defaultCenter;
    const initialZoom = options?.zoom ?? this.defaultZoom;

    this.view = new View({
      center: fromLonLat([centerCoord.lng, centerCoord.lat]),
      zoom: initialZoom,
      maxZoom: 19,
      minZoom: 2,
    });

    // 1. 基础底层底图 (OSM 作为兜底背景)
    const layers: (TileLayer | VectorLayer)[] = [
      new TileLayer({
        source: new OSM(),
      }),
    ];

    // 2. 叠加自定义切片图层 (如本地 gisServer 服务的 TMS 切片)
    for (const rawUrl of this.customMapUrls) {
      const tileUrl = resolveOlTileUrl(rawUrl);
      if (tileUrl) {
        layers.push(
          new TileLayer({
            source: new XYZ({
              url: tileUrl,
              crossOrigin: 'anonymous',
              maxZoom: 19,
              minZoom: 0,
            }),
          }),
        );
      }
    }

    // 3. 战术标绘独立矢量图层 (zIndex: 80)
    this.graphicsLayer = new VectorLayer({
      source: this.graphicsSource,
      zIndex: 80,
    });
    layers.push(this.graphicsLayer);

    // 4. 飞机动态航迹独立矢量图层 (zIndex: 100，置于最顶层)
    this.tracksLayer = new VectorLayer({
      source: this.tracksSource,
      zIndex: 100,
    });
    layers.push(this.tracksLayer);

    // 5. 空间量测独立矢量图层 (zIndex: 110)
    this.measureLayer = new VectorLayer({
      source: this.measureSource,
      zIndex: 110,
    });
    layers.push(this.measureLayer);

    // 6. 交互式航线任务规划图层 (zIndex: 120)
    this.routePlanLayer = new VectorLayer({
      source: this.routePlanSource,
      zIndex: 120,
    });
    layers.push(this.routePlanLayer);

    this.map = new OlMap({
      target: container,
      layers,
      view: this.view,
      controls: [], // 禁用原生控件，由上层统一定制战术 HUD 控件
    });

    // 鼠标指针移动事件：实时侦测经纬度与悬停光标状态
    this.map.on('pointermove', (evt) => {
      if (evt.dragging) return;
      const coord = toLonLat(evt.coordinate);
      const pos = { lng: Number(coord[0].toFixed(5)), lat: Number(coord[1].toFixed(5)), alt: 0 };
      this.cursorMoveCallbacks.forEach((cb) => cb(pos));

      if (this.map && !this.currentDrawInteraction && !this.currentMeasureInteraction && !this.currentRoutePlanningInteraction) {
        const hasTarget = this.map.hasFeatureAtPixel(evt.pixel, {
          layerFilter: (layer) => layer === this.tracksLayer,
        });
        const targetEl = this.map.getTargetElement();
        if (targetEl) {
          targetEl.style.cursor = hasTarget ? 'pointer' : '';
        }
      }
    });

    // 鼠标单击事件：在浏览状态下拾取海空目标
    this.map.on('singleclick', (evt) => {
      if (this.currentDrawInteraction || this.currentMeasureInteraction || this.currentRoutePlanningInteraction) {
        return;
      }
      let pickedId: string | null = null;
      this.map?.forEachFeatureAtPixel(evt.pixel, (feature) => {
        const featId = String(feature.getId() || '');
        if (featId.startsWith('live_')) {
          pickedId = featId.replace('live_', '');
          return true;
        }
        return false;
      });

      this.selectTarget(pickedId);
    });

    // 触发首次渲染自适应
    this.map.updateSize();
  }

  setCenter(coord: Coordinate, zoom?: number): void {
    if (!this.view) return;
    this.view.setCenter(fromLonLat([coord.lng, coord.lat]));
    if (typeof zoom === 'number') {
      this.view.setZoom(zoom);
    }
  }

  getCenter(): Coordinate {
    if (!this.view) return this.defaultCenter;
    const center = this.view.getCenter();
    if (!center) return this.defaultCenter;
    const [lng, lat] = toLonLat(center);
    return { lng, lat };
  }

  getZoom(): number {
    return this.view?.getZoom() ?? this.defaultZoom;
  }

  flyTo(coord: Coordinate, zoom?: number, durationMs = 1000): void {
    if (!this.view) return;
    this.view.animate({
      center: fromLonLat([coord.lng, coord.lat]),
      zoom: zoom ?? this.getZoom(),
      duration: durationMs,
    });
  }

  zoomIn(): void {
    if (!this.view) return;
    const current = this.getZoom();
    this.view.animate({ zoom: Math.min(current + 1, 19), duration: 250 });
  }

  zoomOut(): void {
    if (!this.view) return;
    const current = this.getZoom();
    this.view.animate({ zoom: Math.max(current - 1, 2), duration: 250 });
  }

  resize(): void {
    if (this.map) {
      this.map.updateSize();
    }
  }

  dispose(): void {
    this.stopManualDraw();
    this.clearAllTrajectories();
    this.clearSpatialMeasure();
    this.clearRoutePlan();
    if (this.map) {
      this.map.setTarget(undefined);
      this.map = null;
      this.view = null;
      this.graphicsLayer = null;
      this.tracksLayer = null;
      this.measureLayer = null;
      this.routePlanLayer = null;
    }
  }

  // ================= 物理图层分层管理实现 =================

  setLayerVisible(layer: MapLayerType, visible: boolean): void {
    if (layer === 'graphics') {
      this.graphicsLayer?.setVisible(visible);
    } else {
      this.tracksLayer?.setVisible(visible);
    }
  }

  getLayerVisible(layer: MapLayerType): boolean {
    if (layer === 'graphics') {
      return this.graphicsLayer?.getVisible() ?? true;
    }
    return this.tracksLayer?.getVisible() ?? true;
  }

  clearLayer(layer: MapLayerType): void {
    if (layer === 'graphics') {
      this.clearAllGraphics();
    } else {
      this.clearAllTrajectories();
    }
  }

  // ================= 战术几何标绘（手动交互与数据渲染） =================

  startManualDraw(shapeType: DrawShapeType, onComplete?: (graphic: TacticalGraphic) => void): void {
    if (!this.map) return;
    this.stopManualDraw();

    let drawType: 'Point' | 'LineString' | 'Polygon' | 'Circle';
    let geometryFunction: GeometryFunction | undefined;
    let maxPoints: number | undefined;

    switch (shapeType) {
      case 'point':
        drawType = 'Point';
        break;
      case 'line':
        drawType = 'LineString';
        break;
      case 'circle':
        drawType = 'Circle';
        break;
      case 'rectangle':
        drawType = 'Circle';
        geometryFunction = createBox();
        break;
      case 'square':
        drawType = 'Circle';
        geometryFunction = createRegularPolygon(4);
        break;
      case 'attack_arrow': {
        drawType = 'LineString';
        maxPoints = 2;
        geometryFunction = (coords, opt_geom) => {
          const polyGeom = (opt_geom as Polygon) || new Polygon([]);
          const ptsArray = coords as number[][];
          if (!ptsArray || ptsArray.length < 2) return polyGeom;
          const p1 = toLonLat(ptsArray[0]);
          const p2 = toLonLat(ptsArray[1]);
          const pts = MilitaryPlotAlgorithms.calculateAttackArrow(
            { lng: p1[0], lat: p1[1] },
            { lng: p2[0], lat: p2[1] },
          );
          const ring = pts.map((p) => fromLonLat([p.lng, p.lat]));
          polyGeom.setCoordinates([ring]);
          return polyGeom;
        };
        break;
      }
      case 'double_arrow': {
        drawType = 'LineString';
        maxPoints = 2;
        geometryFunction = (coords, opt_geom) => {
          const polyGeom = (opt_geom as Polygon) || new Polygon([]);
          const ptsArray = coords as number[][];
          if (!ptsArray || ptsArray.length < 2) return polyGeom;
          const p1 = toLonLat(ptsArray[0]);
          const p2 = toLonLat(ptsArray[1]);
          const pts = MilitaryPlotAlgorithms.calculateDoubleArrow(
            { lng: p1[0], lat: p1[1] },
            { lng: p2[0], lat: p2[1] },
          );
          const ring = pts.map((p) => fromLonLat([p.lng, p.lat]));
          polyGeom.setCoordinates([ring]);
          return polyGeom;
        };
        break;
      }
      case 'sector': {
        drawType = 'LineString';
        maxPoints = 2;
        geometryFunction = (coords, opt_geom) => {
          const polyGeom = (opt_geom as Polygon) || new Polygon([]);
          const ptsArray = coords as number[][];
          if (!ptsArray || ptsArray.length < 2) return polyGeom;
          const p1 = toLonLat(ptsArray[0]);
          const p2 = toLonLat(ptsArray[1]);
          const center = { lng: p1[0], lat: p1[1] };
          const tip = { lng: p2[0], lat: p2[1] };
          const dist = MilitaryPlotAlgorithms.distance(center, tip);
          const headingRad = MilitaryPlotAlgorithms.getBearingRad(center, tip);
          const headingDeg = (headingRad * 180) / Math.PI;
          const pts = MilitaryPlotAlgorithms.calculateSector(center, dist, headingDeg, 65);
          const ring = pts.map((p) => fromLonLat([p.lng, p.lat]));
          polyGeom.setCoordinates([ring]);
          return polyGeom;
        };
        break;
      }
      case 'polygon':
      default:
        drawType = 'Polygon';
        break;
    }

    this.currentDrawInteraction = new Draw({
      source: this.graphicsSource,
      type: drawType,
      geometryFunction,
      maxPoints,
    });

    this.currentDrawInteraction.on('drawend', (event) => {
      const feature = event.feature;
      const geom = feature.getGeometry();
      if (!geom) return;

      let coordinates: Coordinate[];
      let radius: number | undefined;

      if (shapeType === 'point') {
        const p = geom as Point;
        const [lng, lat] = toLonLat(p.getCoordinates());
        coordinates = [{ lng, lat }];
      } else if (shapeType === 'line') {
        const line = geom as LineString;
        coordinates = line.getCoordinates().map((c) => {
          const [lng, lat] = toLonLat(c);
          return { lng, lat };
        });
      } else if (shapeType === 'circle') {
        const circle = geom as CircleGeom;
        const [lng, lat] = toLonLat(circle.getCenter());
        coordinates = [{ lng, lat }];
        // 墨卡托投影真实地面半径换算 (米)
        const metersPerUnit = Math.cos((lat * Math.PI) / 180);
        radius = Math.round(circle.getRadius() * metersPerUnit);
      } else {
        // attack_arrow / double_arrow / sector / polygon / rectangle / square
        const poly = geom as Polygon;
        const ring = poly.getCoordinates()[0] || [];
        coordinates = ring.map((c) => {
          const [lng, lat] = toLonLat(c);
          return { lng, lat };
        });
      }

      const id = `manual_${shapeType}_${Date.now()}`;
      const name = `标绘_${shapeType}_${this.graphicsMap.size + 1}`;

      let customStyle = {
        strokeColor: 'rgba(0, 229, 255, 0.95)',
        strokeWidth: 2.5,
        fillColor: 'rgba(0, 229, 255, 0.25)',
        pointSize: 7,
        label: name,
      };

      if (shapeType === 'attack_arrow') {
        customStyle = {
          strokeColor: '#ff0033',
          strokeWidth: 2.5,
          fillColor: 'rgba(255, 0, 51, 0.35)',
          pointSize: 7,
          label: `【突击箭头】${name}`,
        };
      } else if (shapeType === 'double_arrow') {
        customStyle = {
          strokeColor: '#ff8800',
          strokeWidth: 2.5,
          fillColor: 'rgba(255, 136, 0, 0.35)',
          pointSize: 7,
          label: `【钳击双箭】${name}`,
        };
      } else if (shapeType === 'sector') {
        customStyle = {
          strokeColor: '#00e5ff',
          strokeWidth: 2,
          fillColor: 'rgba(0, 229, 255, 0.28)',
          pointSize: 7,
          label: `【雷达波束】${name}`,
        };
      }

      const graphic = new TacticalGraphic({
        id,
        name,
        shapeType,
        coordinates,
        radius,
        style: customStyle,
      });

      feature.setId(id);
      feature.setStyle(this.createOlStyle(graphic));
      this.graphicsMap.set(id, graphic);

      if (onComplete) {
        onComplete(graphic);
      }
    });

    this.map.addInteraction(this.currentDrawInteraction);
  }

  stopManualDraw(): void {
    if (this.currentDrawInteraction && this.map) {
      this.map.removeInteraction(this.currentDrawInteraction);
      this.currentDrawInteraction = null;
    }
  }

  drawGraphic(graphic: TacticalGraphic): void {
    const existing = this.graphicsSource.getFeatureById(graphic.id);
    if (existing) {
      this.graphicsSource.removeFeature(existing);
    }

    let geom: Point | LineString | CircleGeom | Polygon | null = null;
    switch (graphic.shapeType) {
      case 'point': {
        const coord = graphic.coordinates[0];
        geom = new Point(fromLonLat([coord.lng, coord.lat]));
        break;
      }
      case 'line': {
        const points = graphic.coordinates.map((c) => fromLonLat([c.lng, c.lat]));
        geom = new LineString(points);
        break;
      }
      case 'circle': {
        const center = graphic.coordinates[0];
        const centerMercator = fromLonLat([center.lng, center.lat]);
        const metersPerUnit = Math.cos((center.lat * Math.PI) / 180);
        const radiusMeters = (graphic.radius || 500) / metersPerUnit;
        geom = new CircleGeom(centerMercator, radiusMeters);
        break;
      }
      case 'attack_arrow':
      case 'double_arrow':
      case 'sector':
      case 'rectangle':
      case 'square':
      case 'polygon': {
        const ring = graphic.coordinates.map((c) => fromLonLat([c.lng, c.lat]));
        // 保证环闭合
        if (
          ring.length > 2 &&
          (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])
        ) {
          ring.push([...ring[0]]);
        }
        geom = new Polygon([ring]);
        break;
      }
    }

    if (!geom) return;

    const feature = new Feature({
      geometry: geom,
      name: graphic.name,
    });
    feature.setId(graphic.id);
    feature.setStyle(this.createOlStyle(graphic));

    this.graphicsSource.addFeature(feature);
    this.graphicsMap.set(graphic.id, graphic);
  }

  removeGraphic(id: string): void {
    const feature = this.graphicsSource.getFeatureById(id);
    if (feature) {
      this.graphicsSource.removeFeature(feature);
    }
    this.graphicsMap.delete(id);
  }

  clearAllGraphics(): void {
    this.stopManualDraw();
    this.graphicsSource.clear();
    this.graphicsMap.clear();
  }

  getAllGraphics(): TacticalGraphic[] {
    return Array.from(this.graphicsMap.values());
  }

  /**
   * 构造 OpenLayers 战术视觉样式 (支持自定义图片图标及机头旋转)
   */
  private createOlStyle(graphic: TacticalGraphic): Style {
    const strokeColor = graphic.style.strokeColor || 'rgba(0, 229, 255, 0.9)';
    const strokeWidth = graphic.style.strokeWidth || 2;
    const fillColor = graphic.style.fillColor || 'rgba(0, 229, 255, 0.2)';
    const pointSize = graphic.style.pointSize || 6;
    const label = graphic.style.label || graphic.name;

    // 自定义图片点图标支持 (如无人机、侦察车等)，统一约束为 38 像素精致战术尺寸
    if (graphic.style.iconUrl) {
      const targetSize = Math.round(38 * (graphic.style.iconScale || 1));
      return new Style({
        image: new Icon({
          src: graphic.style.iconUrl,
          width: targetSize,
          height: targetSize,
          rotation: graphic.style.rotation || 0,
          rotateWithView: true,
        }),
        text: label
          ? new Text({
              text: label,
              font: 'bold 12px "Helvetica Neue", Arial, sans-serif',
              fill: new Fill({ color: '#ffffff' }),
              backgroundFill: new Fill({ color: 'rgba(10, 25, 45, 0.88)' }),
              padding: [2, 6, 2, 6],
              offsetY: -26,
            })
          : undefined,
      });
    }

    return new Style({
      stroke: new Stroke({
        color: strokeColor,
        width: strokeWidth,
      }),
      fill: new Fill({
        color: fillColor,
      }),
      image: new CircleStyle({
        radius: pointSize,
        fill: new Fill({ color: strokeColor }),
        stroke: new Stroke({ color: '#ffffff', width: 1.5 }),
      }),
      text: label
        ? new Text({
            text: label,
            font: '12px "Helvetica Neue", Arial, sans-serif',
            fill: new Fill({ color: '#ffffff' }),
            backgroundFill: new Fill({ color: 'rgba(10, 25, 45, 0.85)' }),
            padding: [2, 6, 2, 6],
            offsetY: -14,
          })
        : undefined,
    });
  }

  // ================= 无人机飞行轨迹加载与平滑推演动画 =================

  loadDroneTrajectory(trajectory: DroneTrajectory): void {
    this.removeDroneTrajectory(trajectory.id);
    this.trajectoryMap.set(trajectory.id, trajectory);

    // 1. 计划航线 Feature (青色虚线)
    const planCoords = trajectory.waypoints.map((w) => fromLonLat([w.lng, w.lat]));
    const planFeature = new Feature({
      geometry: new LineString(planCoords),
      name: `${trajectory.name}_计划航线`,
    });
    planFeature.setStyle(
      new Style({
        stroke: new Stroke({
          color: 'rgba(0, 229, 255, 0.4)',
          width: 2,
          lineDash: [6, 6],
        }),
      }),
    );

    // 2. 实际飞行动态尾迹线 Feature (发光实线)
    const trailFeature = new Feature({
      geometry: new LineString([planCoords[0]]),
      name: `${trajectory.name}_飞行尾迹`,
    });
    trailFeature.setStyle(
      new Style({
        stroke: new Stroke({
          color: trajectory.trailColor,
          width: trajectory.trailWidth,
        }),
      }),
    );

    // 3. 无人机实体图标 Feature (严格对齐 42 像素标准尺寸)
    const droneWidth = trajectory.iconSize?.[0] || 42;
    const droneHeight = trajectory.iconSize?.[1] || 42;
    const initData = trajectory.interpolateAtProgress(trajectory.getProgress());
    const droneFeature = new Feature({
      geometry: new Point(fromLonLat([initData.coordinate.lng, initData.coordinate.lat])),
      name: trajectory.callsign,
    });
    droneFeature.setStyle(
      new Style({
        image: new Icon({
          src: trajectory.iconUrl,
          width: droneWidth,
          height: droneHeight,
          rotation: initData.bearingRad,
          rotateWithView: true,
        }),
        text: new Text({
          text: `✈ ${trajectory.callsign}`,
          font: 'bold 12px monospace',
          fill: new Fill({ color: '#00e5ff' }),
          backgroundFill: new Fill({ color: 'rgba(10, 25, 45, 0.88)' }),
          padding: [2, 6, 2, 6],
          offsetY: -28,
        }),
      }),
    );

    this.tracksSource.addFeature(planFeature);
    if (trajectory.showTrail) {
      this.tracksSource.addFeature(trailFeature);
    }
    this.tracksSource.addFeature(droneFeature);

    this.trajectoryFeatures.set(trajectory.id, {
      drone: droneFeature as Feature<Point>,
      trail: trailFeature as Feature<LineString>,
      plan: planFeature as Feature<LineString>,
    });
  }

  startDroneTrack(trajectoryId: string): void {
    const trajectory = this.trajectoryMap.get(trajectoryId);
    if (!trajectory) return;
    trajectory.setStatus('running');

    if (!this.animTimer) {
      this.startAnimationLoop();
    }
  }

  pauseDroneTrack(trajectoryId: string): void {
    const trajectory = this.trajectoryMap.get(trajectoryId);
    if (trajectory) {
      trajectory.setStatus('paused');
    }
  }

  resetDroneTrack(trajectoryId: string): void {
    const trajectory = this.trajectoryMap.get(trajectoryId);
    if (!trajectory) return;
    trajectory.setStatus('idle');
    trajectory.setProgress(0);
    this.updateTrajectoryRender(trajectory);
  }

  removeDroneTrajectory(trajectoryId: string): void {
    const features = this.trajectoryFeatures.get(trajectoryId);
    if (features) {
      this.tracksSource.removeFeature(features.drone);
      this.tracksSource.removeFeature(features.trail);
      this.tracksSource.removeFeature(features.plan);
      this.trajectoryFeatures.delete(trajectoryId);
    }
    this.trajectoryMap.delete(trajectoryId);

    // 同步移除海空实时目标、航线与尾迹 Feature
    const liveFeat = this.liveDroneFeatures.get(trajectoryId);
    if (liveFeat) {
      this.tracksSource.removeFeature(liveFeat);
      this.liveDroneFeatures.delete(trajectoryId);
    }
    const liveTrailFeat = this.liveDroneTrailFeatures.get(trajectoryId);
    if (liveTrailFeat) {
      this.tracksSource.removeFeature(liveTrailFeat);
      this.liveDroneTrailFeatures.delete(trajectoryId);
    }
    const liveRouteFeat = this.liveDroneRouteFeatures.get(trajectoryId);
    if (liveRouteFeat) {
      this.tracksSource.removeFeature(liveRouteFeat);
      this.liveDroneRouteFeatures.delete(trajectoryId);
    }
    this.liveDroneHistoryCoords.delete(trajectoryId);
  }

  clearAllTrajectories(): void {
    if (this.animTimer) {
      clearInterval(this.animTimer);
      this.animTimer = null;
    }
    for (const id of Array.from(this.trajectoryMap.keys())) {
      this.removeDroneTrajectory(id);
    }
    this.tracksSource.clear();
    this.liveDroneFeatures.clear();
    this.liveDroneTrailFeatures.clear();
    this.liveDroneRouteFeatures.clear();
    this.liveDroneHistoryCoords.clear();
    this.selectedTargetId = null;
    this.trackedTargetId = null;
  }

  private startAnimationLoop(): void {
    const intervalMs = 50; // 20 FPS 稳定定时器，与视口解耦
    this.animTimer = window.setInterval(() => {
      let activeCount = 0;

      for (const trajectory of this.trajectoryMap.values()) {
        if (trajectory.getStatus() === 'running') {
          activeCount++;
          // 步进前进 (基于速度倍率)
          const currentProgress = trajectory.getProgress();
          const step = 0.003 * trajectory.speedMultiplier;
          const nextProgress = currentProgress + step;

          if (nextProgress >= 1.0) {
            trajectory.setProgress(0); // 循环巡逻侦察飞行
          } else {
            trajectory.setProgress(nextProgress);
          }
          this.updateTrajectoryRender(trajectory);
        }
      }

      if (activeCount === 0 && this.animTimer) {
        clearInterval(this.animTimer);
        this.animTimer = null;
      }
    }, intervalMs);
  }

  private updateTrajectoryRender(trajectory: DroneTrajectory): void {
    const features = this.trajectoryFeatures.get(trajectory.id);
    if (!features) return;

    const progress = trajectory.getProgress();
    const currentData = trajectory.interpolateAtProgress(progress);
    const mercatorCoord = fromLonLat([currentData.coordinate.lng, currentData.coordinate.lat]);

    // 更新无人机位置与切线机头朝向角
    const droneWidth = trajectory.iconSize?.[0] || 42;
    const droneHeight = trajectory.iconSize?.[1] || 42;
    features.drone.getGeometry()?.setCoordinates(mercatorCoord);
    features.drone.setStyle(
      new Style({
        image: new Icon({
          src: trajectory.iconUrl,
          width: droneWidth,
          height: droneHeight,
          rotation: currentData.bearingRad,
          rotateWithView: true,
        }),
        text: new Text({
          text: `✈ ${trajectory.callsign} [高程:${currentData.coordinate.alt ?? 0}m]`,
          font: 'bold 12px monospace',
          fill: new Fill({ color: '#00e5ff' }),
          backgroundFill: new Fill({ color: 'rgba(10, 25, 45, 0.88)' }),
          padding: [2, 6, 2, 6],
          offsetY: -28,
        }),
      }),
    );

    // 更新尾迹线
    if (trajectory.showTrail) {
      const trailCoords: [number, number][] = [];
      const totalPoints = trajectory.waypoints.length;
      const reachedCount = Math.min(
        Math.floor(progress * (totalPoints - 1)) + 1,
        totalPoints,
      );

      for (let i = 0; i < reachedCount; i++) {
        trailCoords.push(fromLonLat([trajectory.waypoints[i].lng, trajectory.waypoints[i].lat]) as [number, number]);
      }
      trailCoords.push(mercatorCoord as [number, number]);
      features.trail.getGeometry()?.setCoordinates(trailCoords);
    }
  }

  // ================= 三维空间分析与战术量测实现 =================

  startSpatialMeasure(type: 'distance' | 'area', onUpdate?: (result: SpatialMeasureResult) => void): void {
    if (!this.map) return;
    this.stopManualDraw();
    if (this.currentMeasureInteraction) {
      this.map.removeInteraction(this.currentMeasureInteraction);
    }

    const drawType = type === 'distance' ? 'LineString' : 'Polygon';
    this.currentMeasureInteraction = new Draw({
      source: this.measureSource,
      type: drawType,
    });

    this.currentMeasureInteraction.on('drawend', (event) => {
      const feature = event.feature;
      const geom = feature.getGeometry();
      if (!geom) return;

      let result: SpatialMeasureResult;

      if (type === 'distance') {
        const line = geom as LineString;
        const coords = line.getCoordinates().map((c) => {
          const [lng, lat] = toLonLat(c);
          return { lng, lat };
        });
        const totalDist = SpatialCalculator.calculatePolylineDistance(coords);
        result = {
          totalDistanceMeters: totalDist,
          formattedDistance: SpatialCalculator.formatDistance(totalDist),
        };

        feature.setStyle(
          new Style({
            stroke: new Stroke({ color: '#ffaa00', width: 3 }),
            text: new Text({
              text: `总里程: ${result.formattedDistance}`,
              font: 'bold 13px monospace',
              fill: new Fill({ color: '#ffffff' }),
              backgroundFill: new Fill({ color: 'rgba(10, 25, 45, 0.9)' }),
              padding: [4, 8, 4, 8],
              offsetY: -15,
            }),
          }),
        );
      } else {
        const poly = geom as Polygon;
        const ring = (poly.getCoordinates()[0] || []).map((c) => {
          const [lng, lat] = toLonLat(c);
          return { lng, lat };
        });
        const area = SpatialCalculator.calculatePolygonArea(ring);
        result = {
          totalDistanceMeters: 0,
          areaSquareMeters: area,
          formattedDistance: '',
          formattedArea: SpatialCalculator.formatArea(area),
        };

        feature.setStyle(
          new Style({
            stroke: new Stroke({ color: '#00ffcc', width: 2.5 }),
            fill: new Fill({ color: 'rgba(0, 255, 204, 0.25)' }),
            text: new Text({
              text: `测算面积: ${result.formattedArea}`,
              font: 'bold 13px monospace',
              fill: new Fill({ color: '#ffffff' }),
              backgroundFill: new Fill({ color: 'rgba(10, 25, 45, 0.9)' }),
              padding: [4, 8, 4, 8],
            }),
          }),
        );
      }

      if (onUpdate) onUpdate(result);
    });

    this.map.addInteraction(this.currentMeasureInteraction);
  }

  clearSpatialMeasure(): void {
    if (this.currentMeasureInteraction && this.map) {
      this.map.removeInteraction(this.currentMeasureInteraction);
      this.currentMeasureInteraction = null;
    }
    this.measureSource.clear();
  }

  // ================= 交互式航线任务规划与航点编辑实现 =================

  startRoutePlanning(
    onWaypointChange?: (waypoints: RoutePlanWaypoint[]) => void,
    onComplete?: (waypoints: RoutePlanWaypoint[]) => void,
    taskType?: 'route' | 'area' | 'strike',
  ): void {
    if (!this.map) return;
    this.stopRoutePlanning();

    const resolvedType = taskType || 'route';

    // 结束与闭合判定逻辑 (支持鼠标右键 contextmenu 或鼠标左键双击 dblclick)
    const finishPlanning = () => {
      const minRequired = resolvedType === 'area' ? 3 : 2;
      if (this.activeRoutePlanWaypoints.length < minRequired) {
        return;
      }

      // 如果是区域任务 (area)，自动连接首尾形成闭合多边形防区
      if (resolvedType === 'area' && this.activeRoutePlanWaypoints.length >= 3) {
        const first = this.activeRoutePlanWaypoints[0];
        const last = this.activeRoutePlanWaypoints[this.activeRoutePlanWaypoints.length - 1];
        if (Math.abs(first.lng - last.lng) > 0.0001 || Math.abs(first.lat - last.lat) > 0.0001) {
          const closeWp: RoutePlanWaypoint = {
            id: `wp_close_${Date.now()}`,
            name: `${first.name}(闭合)`,
            lng: first.lng,
            lat: first.lat,
            alt: first.alt,
            speedKmh: first.speedKmh,
            action: 'recon',
          };
          this.activeRoutePlanWaypoints.push(closeWp);
        }

        // 绘制半透明多边形防区面
        const polyCoords = this.activeRoutePlanWaypoints.map((w) => fromLonLat([w.lng, w.lat]));
        const polyFeature = new Feature({
          geometry: new Polygon([polyCoords]),
          name: '闭合防区多边形',
        });
        polyFeature.setStyle(
          new Style({
            fill: new Fill({ color: 'rgba(0, 229, 255, 0.2)' }),
            stroke: new Stroke({ color: '#00e5ff', width: 2.5, lineDash: [6, 4] }),
          }),
        );
        this.routePlanSource.addFeature(polyFeature);
      } else if (resolvedType === 'strike' && this.activeRoutePlanWaypoints.length >= 2) {
        // 如果是攻击任务 (strike)，终点绘制红色目标标靶
        const targetWp = this.activeRoutePlanWaypoints[this.activeRoutePlanWaypoints.length - 1];
        const targetFeature = new Feature({
          geometry: new Point(fromLonLat([targetWp.lng, targetWp.lat])),
          name: '🎯 打击目标阵地',
        });
        targetFeature.setStyle(
          new Style({
            image: new CircleStyle({
              radius: 9,
              fill: new Fill({ color: 'rgba(255, 61, 0, 0.85)' }),
              stroke: new Stroke({ color: '#ffffff', width: 2.5 }),
            }),
            text: new Text({
              text: '🎯 打击目标阵地',
              font: 'bold 12px monospace',
              fill: new Fill({ color: '#ff3d00' }),
              backgroundFill: new Fill({ color: 'rgba(20, 10, 10, 0.9)' }),
              padding: [2, 6, 2, 6],
              offsetY: -24,
            }),
          }),
        );
        this.routePlanSource.addFeature(targetFeature);
      }

      this.stopRoutePlanning();
      if (onComplete) {
        onComplete([...this.activeRoutePlanWaypoints]);
      }
    };

    // 绑定右键与双击事件
    const mapViewport = this.map.getViewport();
    this.routePlanContextMenuHandler = (e: MouseEvent) => {
      e.preventDefault();
      finishPlanning();
    };
    mapViewport.addEventListener('contextmenu', this.routePlanContextMenuHandler);

    this.routePlanDblClickHandler = () => {
      finishPlanning();
    };
    this.map.on('dblclick', this.routePlanDblClickHandler);

    this.currentRoutePlanningInteraction = new Draw({
      source: this.routePlanSource,
      type: 'Point',
    });

    this.currentRoutePlanningInteraction.on('drawend', (event) => {
      const feature = event.feature;
      const geom = feature.getGeometry() as Point;
      if (!geom) return;

      const [lng, lat] = toLonLat(geom.getCoordinates());
      const seq = this.activeRoutePlanWaypoints.length + 1;
      const defaultAlt = resolvedType === 'area' ? 220 : resolvedType === 'strike' ? (seq === 1 ? 120 : 70) : 150;
      const prefix = resolvedType === 'area' ? '防区点' : resolvedType === 'strike' ? (seq === 1 ? '突防始发' : '进击点') : 'WP';

      const wp: RoutePlanWaypoint = {
        id: `wp_${seq}_${Date.now()}`,
        name: `${prefix}-${seq}`,
        lng,
        lat,
        alt: defaultAlt,
        speedKmh: resolvedType === 'strike' ? 320 : 160,
        action: seq === 1 ? 'takeoff' : (resolvedType === 'strike' ? 'strike' : 'recon'),
      };

      this.activeRoutePlanWaypoints.push(wp);

      const themeColor = resolvedType === 'strike' ? '#ff3d00' : resolvedType === 'area' ? '#00e5ff' : '#ffaa00';

      feature.setStyle(
        new Style({
          image: new CircleStyle({
            radius: 7,
            fill: new Fill({ color: themeColor }),
            stroke: new Stroke({ color: '#ffffff', width: 2 }),
          }),
          text: new Text({
            text: `${wp.name} (${wp.alt}m)`,
            font: 'bold 12px monospace',
            fill: new Fill({ color: themeColor }),
            backgroundFill: new Fill({ color: 'rgba(10, 25, 45, 0.88)' }),
            padding: [2, 6, 2, 6],
            offsetY: -22,
          }),
        }),
      );

      // 自动连接航线
      if (this.activeRoutePlanWaypoints.length >= 2) {
        const lineCoords = this.activeRoutePlanWaypoints.map((w) => fromLonLat([w.lng, w.lat]));
        const lineFeature = new Feature({
          geometry: new LineString(lineCoords),
        });
        lineFeature.setStyle(
          new Style({
            stroke: new Stroke({
              color: themeColor,
              width: 3,
              lineDash: resolvedType === 'strike' ? [10, 4] : [8, 6],
            }),
          }),
        );
        this.routePlanSource.addFeature(lineFeature);
      }

      if (onWaypointChange) onWaypointChange([...this.activeRoutePlanWaypoints]);
    });

    this.map.addInteraction(this.currentRoutePlanningInteraction);
  }

  stopRoutePlanning(): void {
    if (this.currentRoutePlanningInteraction && this.map) {
      this.map.removeInteraction(this.currentRoutePlanningInteraction);
      this.currentRoutePlanningInteraction = null;
    }
    if (this.map && this.routePlanContextMenuHandler) {
      this.map.getViewport().removeEventListener('contextmenu', this.routePlanContextMenuHandler);
      this.routePlanContextMenuHandler = null;
    }
    if (this.map && this.routePlanDblClickHandler) {
      this.map.un('dblclick', this.routePlanDblClickHandler);
      this.routePlanDblClickHandler = null;
    }
  }

  renderRoutePlan(plan: MissionRoutePlan): void {
    this.clearRoutePlan();
    this.activeRoutePlanWaypoints = [...plan.waypoints];

    const resolvedType = plan.type || 'route';
    const themeColor = resolvedType === 'strike' ? '#ff3d00' : resolvedType === 'area' ? '#00e5ff' : '#ffaa00';

    if (plan.waypoints.length >= 2) {
      const lineCoords = plan.waypoints.map((w) => fromLonLat([w.lng, w.lat]));
      const lineFeature = new Feature({
        geometry: new LineString(lineCoords),
      });
      lineFeature.setStyle(
        new Style({
          stroke: new Stroke({
            color: themeColor,
            width: 3,
            lineDash: resolvedType === 'strike' ? [10, 4] : [8, 6],
          }),
        }),
      );
      this.routePlanSource.addFeature(lineFeature);

      // 如果是区域任务 (area)，并且首尾闭合，渲染半透明闭合多边形
      if (resolvedType === 'area' && plan.waypoints.length >= 3) {
        const polyFeature = new Feature({
          geometry: new Polygon([lineCoords]),
        });
        polyFeature.setStyle(
          new Style({
            fill: new Fill({ color: 'rgba(0, 229, 255, 0.2)' }),
            stroke: new Stroke({ color: '#00e5ff', width: 2.5, lineDash: [6, 4] }),
          }),
        );
        this.routePlanSource.addFeature(polyFeature);
      }
    }

    plan.waypoints.forEach((wp, idx) => {
      const isTarget = resolvedType === 'strike' && idx === plan.waypoints.length - 1;
      const feat = new Feature({
        geometry: new Point(fromLonLat([wp.lng, wp.lat])),
      });
      feat.setStyle(
        new Style({
          image: new CircleStyle({
            radius: isTarget ? 10 : 7,
            fill: new Fill({ color: isTarget ? '#ff0000' : themeColor }),
            stroke: new Stroke({ color: '#ffffff', width: 2 }),
          }),
          text: new Text({
            text: isTarget ? '🎯 打击目标' : `${wp.name} [${wp.alt}m]`,
            font: 'bold 12px monospace',
            fill: new Fill({ color: isTarget ? '#ff5252' : themeColor }),
            backgroundFill: new Fill({ color: 'rgba(10, 25, 45, 0.88)' }),
            padding: [2, 6, 2, 6],
            offsetY: -22,
          }),
        }),
      );
      this.routePlanSource.addFeature(feat);
    });
  }

  clearRoutePlan(): void {
    this.stopRoutePlanning();
    this.activeRoutePlanWaypoints = [];
    this.routePlanSource.clear();
  }

  // ================= 实时流式态势遥测与电子围栏告警实现 =================

  updateDroneLivePosition(frame: DroneTelemetryFrame): void {
    const mercator = fromLonLat([frame.coordinate.lng, frame.coordinate.lat]);
    let feat = this.liveDroneFeatures.get(frame.droneId);

    const headingRad = (frame.headingDeg * Math.PI) / 180;
    const isShip = frame.category === 'maritime';
    const iconSrc = isShip ? '/icons/ship.svg' : '/icons/airplane.svg';
    const iconWidth = isShip ? 22 : 36;
    const iconHeight = isShip ? 44 : 36;

    const labelTitle = isShip ? `🚢 ${frame.callsign}` : `✈ ${frame.callsign}`;
    const speedUnit = isShip ? '节' : 'km/h';
    const altText = isShip ? '' : `高度:${frame.coordinate.alt ?? 0}m | `;
    const routeText = frame.origin && frame.destination ? `\n${frame.origin} ➔ ${frame.destination}` : '';
    const labelFull = `${labelTitle}\n[${altText}${frame.speedKmh}${speedUnit} | 航向:${Math.round(frame.headingDeg)}°]${routeText}`;

    // 1. 更新或创建飞机/船舶目标本体 Feature
    if (!feat) {
      feat = new Feature({
        geometry: new Point(mercator),
        name: frame.callsign,
      });
      feat.setId(`live_${frame.droneId}`);
      this.tracksSource.addFeature(feat);
      this.liveDroneFeatures.set(frame.droneId, feat);
    } else {
      feat.getGeometry()?.setCoordinates(mercator);
    }

    feat.setStyle(
      new Style({
        image: new Icon({
          src: iconSrc,
          width: iconWidth,
          height: iconHeight,
          rotation: headingRad,
          rotateWithView: true,
        }),
        text: new Text({
          text: labelFull,
          font: 'bold 11px monospace',
          fill: new Fill({ color: isShip ? '#00ffff' : '#ffea00' }),
          backgroundFill: new Fill({ color: 'rgba(10, 25, 45, 0.9)' }),
          padding: [3, 6, 3, 6],
          offsetY: isShip ? -30 : -26,
        }),
      }),
    );

    // 2. 绘制或更新全程计划航线/航道 (Route)
    if (frame.route && frame.route.length >= 2) {
      const routeMercatorCoords = frame.route.map((p) => fromLonLat([p.lng, p.lat]) as [number, number]);
      let routeFeat = this.liveDroneRouteFeatures.get(frame.droneId);

      if (!routeFeat) {
        routeFeat = new Feature({
          geometry: new LineString(routeMercatorCoords),
          name: `${frame.callsign}_计划航线`,
        });
        routeFeat.setId(`route_${frame.droneId}`);
        routeFeat.setStyle(
          new Style({
            stroke: new Stroke({
              color: isShip ? 'rgba(30, 144, 255, 0.75)' : 'rgba(0, 229, 255, 0.65)',
              width: 2.2,
              lineDash: isShip ? [6, 6] : [8, 6],
            }),
          }),
        );
        this.tracksSource.addFeature(routeFeat);
        this.liveDroneRouteFeatures.set(frame.droneId, routeFeat);
      } else {
        (routeFeat.getGeometry() as LineString).setCoordinates(routeMercatorCoords);
      }
    }

    // 3. 绘制或更新飞行尾迹 / 航行航迹 (Trail)
    let trailPoints: Coordinate[];
    if (frame.trail && frame.trail.length > 0) {
      trailPoints = [...frame.trail];
      const last = trailPoints[trailPoints.length - 1];
      if (Math.abs(last.lng - frame.coordinate.lng) > 0.0001 || Math.abs(last.lat - frame.coordinate.lat) > 0.0001) {
        trailPoints.push({ ...frame.coordinate });
      }
      this.liveDroneHistoryCoords.set(frame.droneId, trailPoints);
    } else {
      let history = this.liveDroneHistoryCoords.get(frame.droneId) || [];
      const last = history[history.length - 1];
      if (!last || Math.abs(last.lng - frame.coordinate.lng) > 0.0001 || Math.abs(last.lat - frame.coordinate.lat) > 0.0001) {
        history.push({ ...frame.coordinate });
        if (history.length > 50) {
          history = history.slice(-50);
        }
        this.liveDroneHistoryCoords.set(frame.droneId, history);
      }
      trailPoints = history;
    }

    if (trailPoints.length >= 2) {
      const trailMercatorCoords = trailPoints.map((p) => fromLonLat([p.lng, p.lat]) as [number, number]);
      let trailFeat = this.liveDroneTrailFeatures.get(frame.droneId);

      if (!trailFeat) {
        trailFeat = new Feature({
          geometry: new LineString(trailMercatorCoords),
          name: `${frame.callsign}_动态尾迹`,
        });
        trailFeat.setId(`trail_${frame.droneId}`);
        trailFeat.setStyle(
          new Style({
            stroke: new Stroke({
              color: isShip ? '#00ffff' : '#ffea00',
              width: isShip ? 2.8 : 3.2,
              lineCap: 'round',
              lineJoin: 'round',
            }),
          }),
        );
        this.tracksSource.addFeature(trailFeat);
        this.liveDroneTrailFeatures.set(frame.droneId, trailFeat);
      } else {
        (trailFeat.getGeometry() as LineString).setCoordinates(trailMercatorCoords);
      }
    }

    // 4. 视角锁定平滑居中跟随
    if (this.trackedTargetId === frame.droneId && this.view) {
      this.view.setCenter(mercator);
    }
  }

  highlightGeofenceAlert(geofenceId: string, isAlerting: boolean): void {
    const feat = this.graphicsSource.getFeatureById(geofenceId);
    if (!feat) return;

    if (isAlerting) {
      // 警报高亮红色闪烁描边
      feat.setStyle(
        new Style({
          stroke: new Stroke({ color: '#ff0033', width: 4.5 }),
          fill: new Fill({ color: 'rgba(255, 0, 51, 0.45)' }),
          text: new Text({
            text: '⚠️【禁飞入侵告警】',
            font: 'bold 13px sans-serif',
            fill: new Fill({ color: '#ffffff' }),
            backgroundFill: new Fill({ color: '#ff0033' }),
            padding: [4, 8, 4, 8],
            offsetY: -15,
          }),
        }),
      );
    } else {
      // 恢复原样
      const graphic = this.graphicsMap.get(geofenceId);
      if (graphic) {
        feat.setStyle(this.createOlStyle(graphic));
      }
    }
  }

  // ================= 目标交互与视角锁定跟随实现 =================

  selectTarget(targetId: string | null): void {
    this.selectedTargetId = targetId;
    this.targetSelectCallbacks.forEach((cb) => cb(targetId));
  }

  getSelectedTargetId(): string | null {
    return this.selectedTargetId;
  }

  getTrackedTargetId(): string | null {
    return this.trackedTargetId;
  }

  trackTarget(targetId: string | null): void {
    this.trackedTargetId = targetId;
    if (targetId) {
      const feat = this.liveDroneFeatures.get(targetId);
      if (feat) {
        const geom = feat.getGeometry();
        if (geom) {
          this.view?.animate({ center: geom.getCoordinates(), duration: 500 });
        }
      }
    }
  }

  onTargetSelect(callback: (targetId: string | null) => void): () => void {
    this.targetSelectCallbacks.add(callback);
    return () => this.targetSelectCallbacks.delete(callback);
  }

  onCursorMove(callback: (pos: { lng: number; lat: number; alt?: number } | null) => void): () => void {
    this.cursorMoveCallbacks.add(callback);
    return () => this.cursorMoveCallbacks.delete(callback);
  }

  setDrone3DModelEnabled(): void {
    // 2D OpenLayers 视口采用超清图片图标渲染，不加载三维 GLTF 网格
  }
}

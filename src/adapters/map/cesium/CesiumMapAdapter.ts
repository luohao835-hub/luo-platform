import {
    CallbackProperty,
    CallbackPositionProperty,
    ConstantProperty,
    ConstantPositionProperty,
    ColorMaterialProperty,
    Cartesian2,
    Cartesian3,
    Cartographic,
    CesiumTerrainProvider,
    createWorldTerrainAsync,
    CustomDataSource,
    Ion,
    IonImageryProvider,
    ClassificationType,
    Color,
    type Entity,
    HeightReference,
    HeadingPitchRoll,
    Transforms,
    LabelStyle,
    PolylineDashMaterialProperty,
    PolylineGlowMaterialProperty,
    ModelGraphics,
    BillboardGraphics,
    ImageryLayer,
    Math as CesiumMath,
    PolygonHierarchy,
    ScreenSpaceEventHandler,
    ScreenSpaceEventType,
    UrlTemplateImageryProvider,
    Viewer,
} from 'cesium';
import type {Coordinate} from '@/domain/geometry/Coordinate';
import type {MapMode} from '@/domain/map/MapMode';
import type {MapLayerType} from '@/domain/map/LayerType';
import type {MapInitOptions, MapPort} from '@/ports/map/MapPort';
import {type DrawShapeType, TacticalGraphic} from '@/domain/geometry/TacticalGraphic';
import type { DroneTrajectory } from '@/domain/track/DroneTrajectory';
import type { DroneTelemetryFrame } from '@/domain/telemetry/DroneTelemetryFrame';
import { MilitaryPlotAlgorithms } from '@/domain/geometry/MilitaryPlotAlgorithms';
import { SpatialCalculator, type SpatialMeasureResult } from '@/domain/geometry/SpatialCalculator';
import type { MissionRoutePlan, RoutePlanWaypoint } from '@/domain/mission/MissionRoutePlan';

/**
 * 将配置的原始切片 URL 规整为 Cesium UrlTemplate 格式
 * 自动识别 TMS 格式并追加 {reverseY} 翻转
 */
function resolveCesiumTileUrl(rawUrl: string): string {
  let url = rawUrl.trim();
  if (!url) return '';
  if (url.includes('{z}')) {
    return url;
  }
  url = url.replace(/\/+$/, '');
  if (/:\d+$/.test(url)) {
    url += '/map';
  }
  return `${url}/{z}/{x}/{reverseY}.png`;
}

function parseCesiumColor(colorStr?: string, defaultColor = Color.CYAN): Color {
  if (!colorStr) return defaultColor;
  try {
    return Color.fromCssColorString(colorStr);
  } catch {
    return defaultColor;
  }
}

/**
 * 构造视网膜高清文字标签参数
 * 利用 2 倍大字号离屏绘制 + 0.5 采样缩放与描边，彻底解决 Cesium 字体发糊发虚问题
 */
function createHdLabelOptions(props: {
  text: string | CallbackProperty;
  pixelOffset?: Cartesian2;
  fillColor?: Color;
  showBackground?: boolean;
  backgroundColor?: Color;
  disableDepthTestDistance?: number;
  heightReference?: HeightReference;
}) {
  return {
    text: props.text,
    font: 'bold 26px -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
    scale: 0.5,
    style: LabelStyle.FILL_AND_OUTLINE,
    fillColor: props.fillColor || Color.WHITE,
    outlineColor: new Color(0, 0, 0, 0.85),
    outlineWidth: 3,
    showBackground: props.showBackground ?? true,
    backgroundColor: props.backgroundColor || new Color(0.04, 0.1, 0.18, 0.88),
    backgroundPadding: new Cartesian2(8, 5),
    pixelOffset: props.pixelOffset || new Cartesian2(0, -32),
    heightReference: props.heightReference ?? HeightReference.CLAMP_TO_GROUND,
    disableDepthTestDistance: props.disableDepthTestDistance ?? Number.POSITIVE_INFINITY,
  };
}

interface TrajectoryRuntimeState {
  drone?: Entity;
  trail?: Entity;
  plan: Entity;
  trailCoords: Cartesian3[];
  currentPos: Cartesian3;
  currentBearingRad: number;
  currentAlt: number;
}

export class CesiumMapAdapter implements MapPort {
  public readonly mode: MapMode = '3D';
  private viewer: Viewer | null = null;
  private defaultCenter: Coordinate = { lng: 118.7702, lat: 32.0356 }; // 默认莫愁湖切片中心坐标
  private defaultZoom = 14;

  private readonly customMapUrls: string[];
  private readonly terrainUrl?: string;
  private readonly ionToken?: string;

  // 物理分层 1: 战术标绘独立数据源图层
  private readonly graphicsDataSource: CustomDataSource;

  // 物理分层 2: 飞机航迹独立数据源图层
  private readonly tracksDataSource: CustomDataSource;

  // 物理分层 3: 空间量测独立数据源图层
  private readonly measureDataSource: CustomDataSource;

  // 物理分层 4: 航线任务规划独立数据源图层
  private readonly routePlanDataSource: CustomDataSource;

  private readonly graphicsMap: Map<string, TacticalGraphic> = new Map();
  private readonly entitiesMap: Map<string, Entity> = new Map();
  private readonly trajectoryMap: Map<string, DroneTrajectory> = new Map();
  private readonly trajectoryEntities: Map<string, TrajectoryRuntimeState> = new Map();
  private readonly liveDroneEntities: Map<string, Entity> = new Map();
  private readonly liveDroneTrailEntities: Map<string, Entity> = new Map();
  private readonly liveDroneRouteEntities: Map<string, Entity> = new Map();
  private readonly liveDroneHistoryCoords: Map<string, Coordinate[]> = new Map();
  private globalEventHandler: ScreenSpaceEventHandler | null = null;
  private selectedTargetId: string | null = null;
  private trackedTargetId: string | null = null;
  private readonly targetSelectCallbacks: Set<(id: string | null) => void> = new Set();
  private readonly cursorMoveCallbacks: Set<(pos: { lng: number; lat: number; alt?: number } | null) => void> = new Set();
  private is3DModelEnabled = true;
  private animTimer: number | null = null;
  private drawEventHandler: ScreenSpaceEventHandler | null = null;
  private measureEventHandler: ScreenSpaceEventHandler | null = null;
  private routePlanEventHandler: ScreenSpaceEventHandler | null = null;
  private activeRoutePlanWaypoints: RoutePlanWaypoint[] = [];
  private tempEntities: Entity[] = [];

  constructor(customMapUrls: string[] = [], terrainUrl?: string, ionToken?: string) {
    this.customMapUrls = customMapUrls;
    this.terrainUrl = terrainUrl;
    this.ionToken = ionToken;
    this.graphicsDataSource = new CustomDataSource('tactical-graphics-layer');
    this.tracksDataSource = new CustomDataSource('drone-tracks-layer');
    this.measureDataSource = new CustomDataSource('spatial-measure-layer');
    this.routePlanDataSource = new CustomDataSource('mission-route-plan-layer');
  }

  private zoomToAltitude(zoom: number): number {
    const clampedZoom = Math.max(2, Math.min(zoom, 19));
    return 40075016.68557849 / Math.pow(2, clampedZoom);
  }

  private altitudeToZoom(height: number): number {
    const safeHeight = Math.max(10, height);
    const zoom = Math.log2(40075016.68557849 / safeHeight);
    return Math.max(2, Math.min(Math.round(zoom), 19));
  }

  async init(container: HTMLElement, options?: MapInitOptions): Promise<void> {
    if (this.ionToken) {
      Ion.defaultAccessToken = this.ionToken;
    }

    const centerCoord = options?.center || this.defaultCenter;
    const initialZoom = options?.zoom ?? this.defaultZoom;
    const initialHeight = this.zoomToAltitude(initialZoom);

    // 1. 设置基础瓦片底图（使用用户 Cesium Ion Token 授权的官方高精卫星图，或免 Key 全球高精底图，彻底清除 api key 错误水印）
    let baseImageryLayer: ImageryLayer | undefined;

    if (this.ionToken) {
      try {
        const ionProvider = await IonImageryProvider.fromAssetId(2);
        baseImageryLayer = new ImageryLayer(ionProvider);
      } catch (err) {
        console.warn('[CesiumMapAdapter] 官方 Ion 卫星底图加载异常，启用公共高精卫星底图兜底:', err);
      }
    }

    if (!baseImageryLayer) {
      // 永久免费、免 API Key、高清晰度的全球卫星遥感底图 (ArcGIS World Imagery)
      const freeSatelliteProvider = new UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 19,
      });
      baseImageryLayer = new ImageryLayer(freeSatelliteProvider);
    }

    const hiddenCredit = document.createElement('div');
    hiddenCredit.style.display = 'none';

    this.viewer = new Viewer(container, {
      baseLayer: baseImageryLayer,
      animation: false,
      timeline: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      baseLayerPicker: false,
      navigationHelpButton: false,
      infoBox: false,
      selectionIndicator: false,
      fullscreenButton: false,
      creditContainer: hiddenCredit,
    });

    // 2. 叠加自定义切片图层 (如本地 gisServer 服务的切片)
    for (const rawUrl of this.customMapUrls) {
      const tileUrl = resolveCesiumTileUrl(rawUrl);
      if (tileUrl) {
        const customProvider = new UrlTemplateImageryProvider({
          url: tileUrl,
          maximumLevel: 19,
        });
        this.viewer.imageryLayers.addImageryProvider(customProvider);
      }
    }

    // 3. 接入三维数字高程地形模型 (DEM Terrain)
    let terrainLoaded = false;
    if (this.terrainUrl) {
      try {
        this.viewer.terrainProvider = await CesiumTerrainProvider.fromUrl(this.terrainUrl, {
          requestVertexNormals: true,
          requestWaterMask: true,
        });
        terrainLoaded = true;
      } catch (err) {
        console.warn('[CesiumMapAdapter] 自定义高程地形加载失败，尝试官方 Ion 回退:', err);
      }
    }

    // 若本地地形不可用，且配置了官方 Cesium Ion Token，则无缝启用官方全球 World Terrain
    if (!terrainLoaded && this.ionToken) {
      try {
        this.viewer.terrainProvider = await createWorldTerrainAsync({
          requestWaterMask: true,
          requestVertexNormals: true,
        });
      } catch (err) {
        console.warn('[CesiumMapAdapter] Cesium World Terrain 加载失败:', err);
      }
    }

    // 开启高程地形深度检测，保证地表起伏与三维空间高度遮挡真实呈现
    this.viewer.scene.globe.depthTestAgainstTerrain = true;

    // 禁用默认大气光照以提升帧率
    this.viewer.scene.globe.enableLighting = false;

    // 定位到初始视口 (倾角 -45 度展示 3D 透视效果)
    this.viewer.camera.setView({
      destination: Cartesian3.fromDegrees(centerCoord.lng, centerCoord.lat - 0.03, initialHeight),
      orientation: {
        heading: CesiumMath.toRadians(0),
        pitch: CesiumMath.toRadians(-50),
        roll: 0,
      },
    });

    // 4. 视网膜高清屏渲染优化 (Retina / 4K 对齐物理硬件像素)
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1.0 : 1.0;
    this.viewer.resolutionScale = Math.min(dpr, 2.0);

    // 关闭 FXAA 快速模糊滤镜 (FXAA 边缘模糊算法会造成高频小文字和图标发糊)，启用硬件多重采样抗锯齿
    if (this.viewer.scene.postProcessStages?.fxaa) {
      this.viewer.scene.postProcessStages.fxaa.enabled = false;
    }
    this.viewer.scene.msaaSamples = 4;

    // 提高地表瓦片清晰度 (适度降低误差阈值，请求更精细瓦片)
    this.viewer.scene.globe.maximumScreenSpaceError = 1.33;

    // 注册独立物理图层数据源 (标绘层、飞机轨迹层、量测层、航线规划层彻底解耦隔离)
    await this.viewer.dataSources.add(this.graphicsDataSource);
    await this.viewer.dataSources.add(this.tracksDataSource);
    await this.viewer.dataSources.add(this.measureDataSource);
    await this.viewer.dataSources.add(this.routePlanDataSource);

    // 初始化全局鼠标移动侦测与浏览状态下的目标拾取事件
    this.globalEventHandler = new ScreenSpaceEventHandler(this.viewer.scene.canvas);

    // 1. 鼠标移动监听：实时提取三维高程与地理经纬度
    this.globalEventHandler.setInputAction((movement: { endPosition: Cartesian2 }) => {
      if (!this.viewer) return;
      let cartesian: Cartesian3 | undefined;
      if (this.viewer.scene.pickPositionSupported) {
        cartesian = this.viewer.scene.pickPosition(movement.endPosition);
      }
      if (!cartesian) {
        cartesian = this.viewer.camera.pickEllipsoid(movement.endPosition, this.viewer.scene.globe.ellipsoid);
      }
      if (cartesian) {
        const cartographic = Cartographic.fromCartesian(cartesian);
        const lng = Number(CesiumMath.toDegrees(cartographic.longitude).toFixed(5));
        const lat = Number(CesiumMath.toDegrees(cartographic.latitude).toFixed(5));
        const alt = Math.max(0, Math.round(cartographic.height));
        this.cursorMoveCallbacks.forEach((cb) => cb({ lng, lat, alt }));
      }
    }, ScreenSpaceEventType.MOUSE_MOVE);

    // 2. 鼠标单击监听：浏览状态下点击拾取海空目标
    this.globalEventHandler.setInputAction((click: { position: Cartesian2 }) => {
      if (this.drawEventHandler || this.measureEventHandler || this.routePlanEventHandler) {
        return;
      }
      if (!this.viewer) return;
      const picked = this.viewer.scene.pick(click.position);
      let pickedId: string | null = null;

      if (picked && picked.id) {
        const entity = picked.id as Entity;
        for (const [droneId, ent] of this.liveDroneEntities.entries()) {
          if (ent === entity || ent.id === entity.id) {
            pickedId = droneId;
            break;
          }
        }
      }

      this.selectTarget(pickedId);
    }, ScreenSpaceEventType.LEFT_CLICK);

    this.viewer.resize();
  }

  setCenter(coord: Coordinate, zoom?: number): void {
    if (!this.viewer) return;
    const height = this.zoomToAltitude(zoom ?? this.getZoom());
    this.viewer.camera.setView({
      destination: Cartesian3.fromDegrees(coord.lng, coord.lat, height),
    });
  }

  getCenter(): Coordinate {
    if (!this.viewer) return this.defaultCenter;
    const cartographic = this.viewer.camera.positionCartographic;
    return {
      lng: CesiumMath.toDegrees(cartographic.longitude),
      lat: CesiumMath.toDegrees(cartographic.latitude),
      alt: Math.round(cartographic.height),
    };
  }

  getZoom(): number {
    if (!this.viewer) return this.defaultZoom;
    const height = this.viewer.camera.positionCartographic.height;
    return this.altitudeToZoom(height);
  }

  flyTo(coord: Coordinate, zoom?: number, durationMs = 1200): void {
    if (!this.viewer) return;
    const height = this.zoomToAltitude(zoom ?? this.getZoom());
    this.viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(coord.lng, coord.lat, height),
      duration: durationMs / 1000,
    });
  }

  zoomIn(): void {
    if (!this.viewer) return;
    const height = this.viewer.camera.positionCartographic.height;
    this.viewer.camera.zoomIn(height * 0.35);
  }

  zoomOut(): void {
    if (!this.viewer) return;
    const height = this.viewer.camera.positionCartographic.height;
    this.viewer.camera.zoomOut(height * 0.35);
  }

  resize(): void {
    if (this.viewer && !this.viewer.isDestroyed()) {
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1.0 : 1.0;
      this.viewer.resolutionScale = Math.min(dpr, 2.0);
      this.viewer.resize();
    }
  }

  dispose(): void {
    this.stopManualDraw();
    this.clearAllTrajectories();
    this.clearSpatialMeasure();
    this.clearRoutePlan();
    if (this.globalEventHandler) {
      this.globalEventHandler.destroy();
      this.globalEventHandler = null;
    }
    if (this.viewer && !this.viewer.isDestroyed()) {
      this.viewer.dataSources.remove(this.graphicsDataSource);
      this.viewer.dataSources.remove(this.tracksDataSource);
      this.viewer.dataSources.remove(this.measureDataSource);
      this.viewer.dataSources.remove(this.routePlanDataSource);
      this.viewer.destroy();
      this.viewer = null;
    }
  }

  // ================= 物理图层分层管理实现 =================

  setLayerVisible(layer: MapLayerType, visible: boolean): void {
    if (layer === 'graphics') {
      this.graphicsDataSource.show = visible;
    } else {
      this.tracksDataSource.show = visible;
    }
  }

  getLayerVisible(layer: MapLayerType): boolean {
    if (layer === 'graphics') {
      return this.graphicsDataSource.show;
    }
    return this.tracksDataSource.show;
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
    if (!this.viewer) return;
    this.stopManualDraw();

    this.drawEventHandler = new ScreenSpaceEventHandler(this.viewer.scene.canvas);
    const collectedCoords: Coordinate[] = [];
    let currentMoveCoord: Coordinate | null = null;
    let currentRadius = 10;

    const pickCoord = (screenPosition: Cartesian2): Coordinate | null => {
      if (!this.viewer) return null;
      let cartesian: Cartesian3 | undefined;

      if (this.viewer.scene.pickPositionSupported) {
        cartesian = this.viewer.scene.pickPosition(screenPosition);
      }
      if (!cartesian) {
        const ray = this.viewer.camera.getPickRay(screenPosition);
        if (ray) {
          cartesian = this.viewer.scene.globe.pick(ray, this.viewer.scene);
        }
      }
      if (!cartesian) {
        cartesian = this.viewer.camera.pickEllipsoid(screenPosition, this.viewer.scene.globe.ellipsoid);
      }
      if (!cartesian) return null;

      const cartographic = this.viewer.scene.globe.ellipsoid.cartesianToCartographic(cartesian);
      if (!cartographic) return null;
      return {
        lng: CesiumMath.toDegrees(cartographic.longitude),
        lat: CesiumMath.toDegrees(cartographic.latitude),
        alt: Math.round(cartographic.height),
      };
    };

    const addAnchor = (coord: Coordinate, color = Color.YELLOW): Entity => {
      const entity = this.viewer!.entities.add({
        position: Cartesian3.fromDegrees(coord.lng, coord.lat),
        point: {
          pixelSize: 10,
          color,
          outlineColor: Color.WHITE,
          outlineWidth: 2,
          heightReference: HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
      this.tempEntities.push(entity);
      return entity;
    };

    const finishDraw = (coords: Coordinate[], radius?: number) => {
      this.stopManualDraw();
      if (!coords || coords.length === 0) return;

      const id = `manual_${shapeType}_${Date.now()}`;
      const baseAlt = coords[0]?.alt;
      const name = `3D标绘_${shapeType}_${this.graphicsMap.size + 1}`;

      const graphic = new TacticalGraphic({
        id,
        name,
        shapeType,
        coordinates: coords,
        radius,
        height: baseAlt,
        style: {
          strokeColor: 'rgba(0, 229, 255, 0.95)',
          strokeWidth: 3,
          fillColor: 'rgba(0, 229, 255, 0.3)',
          pointSize: 8,
          label: baseAlt ? `${name} [高程:${baseAlt}m]` : name,
        },
      });

      this.drawGraphic(graphic);
      if (onComplete) {
        onComplete(graphic);
      }
    };

    // 1. 点标绘：单次左键点击立即完成
    if (shapeType === 'point') {
      this.drawEventHandler.setInputAction((event: { position: Cartesian2 }) => {
        const coord = pickCoord(event.position);
        if (coord) {
          finishDraw([coord]);
        }
      }, ScreenSpaceEventType.LEFT_CLICK);
      return;
    }

    // 2. 鼠标移动全局监听：实时更新动态预览坐标
    this.drawEventHandler.setInputAction((event: { endPosition: Cartesian2 }) => {
      const coord = pickCoord(event.endPosition);
      if (!coord) return;
      currentMoveCoord = coord;

      if (shapeType === 'circle' && collectedCoords.length > 0) {
        const center = collectedCoords[0];
        const p1 = Cartesian3.fromDegrees(center.lng, center.lat);
        const p2 = Cartesian3.fromDegrees(coord.lng, coord.lat);
        currentRadius = Math.round(Cartesian3.distance(p1, p2)) || 10;
      }
    }, ScreenSpaceEventType.MOUSE_MOVE);

    // 3. 圆标绘：点击圆心立刻出现黄色圆心锚点 + 动态随鼠标缩放的半径圆与文本
    if (shapeType === 'circle') {
      this.drawEventHandler.setInputAction((event: { position: Cartesian2 }) => {
        const coord = pickCoord(event.position);
        if (!coord) return;

        if (collectedCoords.length === 0) {
          collectedCoords.push(coord);
          addAnchor(coord, Color.YELLOW);

          const previewCircle = this.viewer!.entities.add({
            position: Cartesian3.fromDegrees(coord.lng, coord.lat),
            ellipse: {
              semiMinorAxis: new CallbackProperty(() => Math.max(1, currentRadius), false),
              semiMajorAxis: new CallbackProperty(() => Math.max(1, currentRadius), false),
              heightReference: HeightReference.CLAMP_TO_GROUND,
              material: new Color(0, 0.9, 1, 0.28),
              outline: true,
              outlineColor: Color.CYAN,
              outlineWidth: 2.5,
            },
            label: createHdLabelOptions({
              text: new CallbackProperty(
                () =>
                  `圆心已锁定 | 地表高程: ${coord.alt ?? 0}m\n当前半径: ${Math.round(currentRadius)} 米\n(单击左键完成绘制)`,
                false,
              ),
              pixelOffset: new Cartesian2(0, -34),
            }),
          });
          this.tempEntities.push(previewCircle);
        } else {
          finishDraw([collectedCoords[0]], Math.max(1, currentRadius));
        }
      }, ScreenSpaceEventType.LEFT_CLICK);
      return;
    }

    // 4. 折线标绘：每次点击出锚点并动态拉线，双击或右键完成
    if (shapeType === 'line') {
      this.drawEventHandler.setInputAction((event: { position: Cartesian2 }) => {
        const coord = pickCoord(event.position);
        if (!coord) return;

        collectedCoords.push(coord);
        addAnchor(coord, Color.YELLOW);

        if (collectedCoords.length === 1) {
          currentMoveCoord = coord;
          const previewLine = this.viewer!.entities.add({
            polyline: {
              positions: new CallbackProperty(() => {
                const all = [...collectedCoords];
                if (currentMoveCoord) {
                  all.push(currentMoveCoord);
                }
                const flat: number[] = [];
                for (const p of all) flat.push(p.lng, p.lat);
                return Cartesian3.fromDegreesArray(flat);
              }, false),
              width: 3,
              material: Color.YELLOW,
              clampToGround: true,
            },
            label: createHdLabelOptions({
              text: new CallbackProperty(
                () => `已标绘 ${collectedCoords.length} 个航路点 | 当前高程: ${coord.alt ?? 0}m\n(双击左键或右键完成)`,
                false,
              ),
              pixelOffset: new Cartesian2(0, -34),
            }),
          });
          this.tempEntities.push(previewLine);
        }
      }, ScreenSpaceEventType.LEFT_CLICK);

      const completeLine = () => {
        if (collectedCoords.length >= 2) {
          finishDraw(collectedCoords);
        }
      };
      this.drawEventHandler.setInputAction(completeLine, ScreenSpaceEventType.RIGHT_CLICK);
      this.drawEventHandler.setInputAction(completeLine, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
      return;
    }

    // 5. 多边形标绘：动态呈现面与轮廓线，双击或右键闭合
    if (shapeType === 'polygon') {
      this.drawEventHandler.setInputAction((event: { position: Cartesian2 }) => {
        const coord = pickCoord(event.position);
        if (!coord) return;

        collectedCoords.push(coord);
        addAnchor(coord, Color.YELLOW);

        if (collectedCoords.length === 1) {
          currentMoveCoord = coord;
          const previewPoly = this.viewer!.entities.add({
            polygon: {
              hierarchy: new CallbackProperty(() => {
                const all = [...collectedCoords];
                if (currentMoveCoord) {
                  all.push(currentMoveCoord);
                }
                if (all.length < 3) return new PolygonHierarchy([]);
                const flat: number[] = [];
                for (const p of all) flat.push(p.lng, p.lat);
                return new PolygonHierarchy(Cartesian3.fromDegreesArray(flat));
              }, false),
              classificationType: ClassificationType.BOTH,
              material: new Color(0, 0.9, 1, 0.25),
              outline: true,
              outlineColor: Color.CYAN,
              outlineWidth: 2,
            },
            polyline: {
              positions: new CallbackProperty(() => {
                const all = [...collectedCoords];
                if (currentMoveCoord) {
                  all.push(currentMoveCoord);
                }
                if (all.length < 2) return [];
                const flat: number[] = [];
                for (const p of all) flat.push(p.lng, p.lat);
                return Cartesian3.fromDegreesArray(flat);
              }, false),
              width: 2.5,
              material: Color.YELLOW,
              clampToGround: true,
            },
            label: createHdLabelOptions({
              text: new CallbackProperty(
                () => `多边形顶点: ${collectedCoords.length} 个 | 当前高程: ${coord.alt ?? 0}m\n(双击左键或右键完成闭合)`,
                false,
              ),
              pixelOffset: new Cartesian2(0, -34),
            }),
          });
          this.tempEntities.push(previewPoly);
        }
      }, ScreenSpaceEventType.LEFT_CLICK);

      const completePolygon = () => {
        if (collectedCoords.length >= 3) {
          finishDraw([...collectedCoords, collectedCoords[0]]);
        }
      };
      this.drawEventHandler.setInputAction(completePolygon, ScreenSpaceEventType.RIGHT_CLICK);
      this.drawEventHandler.setInputAction(completePolygon, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
      return;
    }

    // 6. 矩形、正方形与军规标号箭头/扇形标绘
    if (
      shapeType === 'rectangle' ||
      shapeType === 'square' ||
      shapeType === 'attack_arrow' ||
      shapeType === 'double_arrow' ||
      shapeType === 'sector'
    ) {
      this.drawEventHandler.setInputAction((event: { position: Cartesian2 }) => {
        const coord = pickCoord(event.position);
        if (!coord) return;

        if (collectedCoords.length === 0) {
          collectedCoords.push(coord);
          addAnchor(coord, Color.YELLOW);
          currentMoveCoord = coord;

          const previewBox = this.viewer!.entities.add({
            polygon: {
              hierarchy: new CallbackProperty(() => {
                const start = collectedCoords[0];
                const cur = currentMoveCoord || start;
                let ring: Coordinate[];

                if (shapeType === 'attack_arrow') {
                  ring = MilitaryPlotAlgorithms.calculateAttackArrow(start, cur);
                } else if (shapeType === 'double_arrow') {
                  ring = MilitaryPlotAlgorithms.calculateDoubleArrow(start, cur);
                } else if (shapeType === 'sector') {
                  const dist = MilitaryPlotAlgorithms.distance(start, cur);
                  const heading = (MilitaryPlotAlgorithms.getBearingRad(start, cur) * 180) / Math.PI;
                  ring = MilitaryPlotAlgorithms.calculateSector(start, dist, heading, 60);
                } else if (shapeType === 'rectangle') {
                  ring = [
                    { lng: start.lng, lat: start.lat },
                    { lng: cur.lng, lat: start.lat },
                    { lng: cur.lng, lat: cur.lat },
                    { lng: start.lng, lat: cur.lat },
                    { lng: start.lng, lat: start.lat },
                  ];
                } else {
                  const delta = Math.max(Math.abs(cur.lng - start.lng), Math.abs(cur.lat - start.lat));
                  const signLng = cur.lng >= start.lng ? 1 : -1;
                  const signLat = cur.lat >= start.lat ? 1 : -1;
                  ring = [
                    { lng: start.lng, lat: start.lat },
                    { lng: start.lng + delta * signLng, lat: start.lat },
                    { lng: start.lng + delta * signLng, lat: start.lat + delta * signLat },
                    { lng: start.lng, lat: start.lat + delta * signLat },
                    { lng: start.lng, lat: start.lat },
                  ];
                }

                const flat: number[] = [];
                ring.forEach((p) => flat.push(p.lng, p.lat));
                return new PolygonHierarchy(Cartesian3.fromDegreesArray(flat));
              }, false),
              classificationType: ClassificationType.BOTH,
              material: new Color(0, 0.9, 1, 0.25),
              outline: true,
              outlineColor: Color.CYAN,
              outlineWidth: 2,
            },
            label: createHdLabelOptions({
              text: new CallbackProperty(
                () => `已锁定基准点 | 高程: ${coord.alt ?? 0}m\n拉伸确定方向与范围 (单击完成)`,
                false,
              ),
              pixelOffset: new Cartesian2(0, -34),
            }),
          });
          this.tempEntities.push(previewBox);
        } else {
          const start = collectedCoords[0];
          let ringCoords: Coordinate[];

          if (shapeType === 'attack_arrow') {
            ringCoords = MilitaryPlotAlgorithms.calculateAttackArrow(start, coord);
          } else if (shapeType === 'double_arrow') {
            ringCoords = MilitaryPlotAlgorithms.calculateDoubleArrow(start, coord);
          } else if (shapeType === 'sector') {
            const dist = MilitaryPlotAlgorithms.distance(start, coord);
            const heading = (MilitaryPlotAlgorithms.getBearingRad(start, coord) * 180) / Math.PI;
            ringCoords = MilitaryPlotAlgorithms.calculateSector(start, dist, heading, 60);
          } else if (shapeType === 'rectangle') {
            ringCoords = [
              { lng: start.lng, lat: start.lat },
              { lng: coord.lng, lat: start.lat },
              { lng: coord.lng, lat: coord.lat },
              { lng: start.lng, lat: coord.lat },
              { lng: start.lng, lat: start.lat },
            ];
          } else {
            const delta = Math.max(Math.abs(coord.lng - start.lng), Math.abs(coord.lat - start.lat));
            const signLng = coord.lng >= start.lng ? 1 : -1;
            const signLat = coord.lat >= start.lat ? 1 : -1;
            const endLng = start.lng + delta * signLng;
            const endLat = start.lat + delta * signLat;
            ringCoords = [
              { lng: start.lng, lat: start.lat },
              { lng: endLng, lat: start.lat },
              { lng: endLng, lat: endLat },
              { lng: start.lng, lat: endLat },
              { lng: start.lng, lat: start.lat },
            ];
          }
          finishDraw(ringCoords);
        }
      }, ScreenSpaceEventType.LEFT_CLICK);
    }
  }

  stopManualDraw(): void {
    if (this.drawEventHandler) {
      this.drawEventHandler.destroy();
      this.drawEventHandler = null;
    }
    if (this.viewer && this.tempEntities.length > 0) {
      for (const entity of this.tempEntities) {
        this.viewer.entities.remove(entity);
      }
      this.tempEntities = [];
    }
  }

  drawGraphic(graphic: TacticalGraphic): void {
    if (!this.viewer) return;

    this.removeGraphic(graphic.id);

    const strokeColor = parseCesiumColor(graphic.style.strokeColor, Color.CYAN);
    const fillColor = parseCesiumColor(graphic.style.fillColor, new Color(0, 0.9, 1, 0.25));
    const labelText = graphic.style.label || graphic.name;

    let entity: Entity | null = null;

    switch (graphic.shapeType) {
      case 'point': {
        const coord = graphic.coordinates[0];
        const alt = coord.alt ?? graphic.height ?? 0;

        if (graphic.style.iconUrl) {
          // 自定义图片图标点 (如无人机、侦察车等)
          entity = this.graphicsDataSource.entities.add({
            id: graphic.id,
            name: graphic.name,
            position: Cartesian3.fromDegrees(coord.lng, coord.lat, alt),
            billboard: {
              image: graphic.style.iconUrl,
              width: Math.round(38 * (graphic.style.iconScale || 1)),
              height: Math.round(38 * (graphic.style.iconScale || 1)),
              rotation: -(graphic.style.rotation || 0),
              heightReference: alt > 0 ? HeightReference.NONE : HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            label: labelText
              ? createHdLabelOptions({
                  text: `${labelText}\n[高程: ${alt}m]`,
                  pixelOffset: new Cartesian2(0, -32),
                  heightReference: alt > 0 ? HeightReference.NONE : HeightReference.CLAMP_TO_GROUND,
                })
              : undefined,
          });
        } else {
          // 默认矢量点
          entity = this.graphicsDataSource.entities.add({
            id: graphic.id,
            name: graphic.name,
            position: Cartesian3.fromDegrees(coord.lng, coord.lat, alt),
            point: {
              pixelSize: graphic.style.pointSize || 8,
              color: strokeColor,
              outlineColor: Color.WHITE,
              outlineWidth: 1.5,
              heightReference: HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            },
            label: labelText
              ? createHdLabelOptions({
                  text: `${labelText}\n[高程: ${alt}m]`,
                  pixelOffset: new Cartesian2(0, -24),
                })
              : undefined,
          });
        }
        break;
      }
      case 'line': {
        // 仅当所有点都有正高程时才作为空中悬浮航线，否则采用贴地模式避免负高程陷入地下
        const isAirRoute = graphic.coordinates.some((c) => c.alt != null && c.alt > 0);
        const flatArray: number[] = [];
        if (isAirRoute) {
          graphic.coordinates.forEach((c) =>
            flatArray.push(c.lng, c.lat, Math.max(0, c.alt ?? graphic.height ?? 100)),
          );
        } else {
          graphic.coordinates.forEach((c) => flatArray.push(c.lng, c.lat));
        }

        entity = this.graphicsDataSource.entities.add({
          id: graphic.id,
          name: graphic.name,
          polyline: {
            positions: isAirRoute
              ? Cartesian3.fromDegreesArrayHeights(flatArray)
              : Cartesian3.fromDegreesArray(flatArray),
            width: graphic.style.strokeWidth || 3,
            material: strokeColor,
            clampToGround: !isAirRoute,
          },
        });
        break;
      }
      case 'circle': {
        const center = graphic.coordinates[0];
        const radius = graphic.radius || 500;
        const rawHeight = graphic.height ?? center.alt ?? 0;

        // 如果没有拉伸，采用贴地模式 CLAMP_TO_GROUND，彻底解决负高程被地表遮挡问题
        const isExtruded = !!graphic.extrudedHeight;
        const safeBaseHeight = Math.max(0, rawHeight);
        const extrudedHeight = isExtruded ? safeBaseHeight + graphic.extrudedHeight! : undefined;

        entity = this.graphicsDataSource.entities.add({
          id: graphic.id,
          name: graphic.name,
          position: Cartesian3.fromDegrees(center.lng, center.lat, isExtruded ? safeBaseHeight : 0),
          ellipse: isExtruded
            ? {
                semiMinorAxis: radius,
                semiMajorAxis: radius,
                height: safeBaseHeight,
                extrudedHeight,
                material: fillColor,
                outline: true,
                outlineColor: strokeColor,
                outlineWidth: graphic.style.strokeWidth || 2,
              }
            : {
                semiMinorAxis: radius,
                semiMajorAxis: radius,
                heightReference: HeightReference.CLAMP_TO_GROUND,
                material: fillColor,
                outline: true,
                outlineColor: strokeColor,
                outlineWidth: graphic.style.strokeWidth || 2,
              },
          label: labelText
            ? createHdLabelOptions({
                text: isExtruded
                  ? `${labelText}\n[底高: ${safeBaseHeight}m 顶高: ${extrudedHeight}m]`
                  : `${labelText}\n[高程: ${rawHeight}m]`,
                pixelOffset: new Cartesian2(0, -24),
              })
            : undefined,
        });
        break;
      }
      case 'attack_arrow':
      case 'double_arrow':
      case 'sector':
      case 'rectangle':
      case 'square':
      case 'polygon': {
        const flatDegrees: number[] = [];
        graphic.coordinates.forEach((c) => flatDegrees.push(c.lng, c.lat));
        const rawHeight = graphic.height ?? 0;

        const isExtruded = !!graphic.extrudedHeight;
        const safeBaseHeight = Math.max(0, rawHeight);
        const extrudedHeight = isExtruded ? safeBaseHeight + graphic.extrudedHeight! : undefined;

        entity = this.graphicsDataSource.entities.add({
          id: graphic.id,
          name: graphic.name,
          polygon: isExtruded
            ? {
                hierarchy: Cartesian3.fromDegreesArray(flatDegrees),
                height: safeBaseHeight,
                extrudedHeight,
                material: fillColor,
                outline: true,
                outlineColor: strokeColor,
                outlineWidth: graphic.style.strokeWidth || 2,
                closeTop: true,
                closeBottom: true,
              }
            : {
                hierarchy: Cartesian3.fromDegreesArray(flatDegrees),
                classificationType: ClassificationType.BOTH,
                material: fillColor,
                outline: true,
                outlineColor: strokeColor,
                outlineWidth: graphic.style.strokeWidth || 2,
              },
          label:
            labelText && isExtruded
              ? createHdLabelOptions({
                  text: `${labelText}\n[空域拉伸: ${extrudedHeight}m]`,
                  pixelOffset: new Cartesian2(0, -24),
                })
              : undefined,
        });
        break;
      }
    }

    if (entity) {
      this.graphicsMap.set(graphic.id, graphic);
      this.entitiesMap.set(graphic.id, entity);
    }
  }

  removeGraphic(id: string): void {
    this.graphicsDataSource.entities.removeById(id);
    this.entitiesMap.delete(id);
    this.graphicsMap.delete(id);
  }

  clearAllGraphics(): void {
    this.stopManualDraw();
    this.graphicsDataSource.entities.removeAll();
    this.entitiesMap.clear();
    this.graphicsMap.clear();
  }

  getAllGraphics(): TacticalGraphic[] {
    return Array.from(this.graphicsMap.values());
  }

  // ================= 3D 无人机轨迹运动与空间推演模拟 =================

  loadDroneTrajectory(trajectory: DroneTrajectory): void {
    if (!this.viewer) return;
    this.removeDroneTrajectory(trajectory.id);
    this.trajectoryMap.set(trajectory.id, trajectory);

    // 1. 计划航线 (空间高度折线)
    const planFlat: number[] = [];
    trajectory.waypoints.forEach((w) => {
      planFlat.push(w.lng, w.lat, w.alt ?? 60);
    });

    const planEntity = this.tracksDataSource.entities.add({
      name: `${trajectory.name}_计划航线`,
      polyline: {
        positions: Cartesian3.fromDegreesArrayHeights(planFlat),
        width: 2,
        material: new Color(0, 0.9, 1, 0.4),
      },
    });

    // 2. 动态飞行尾迹线 (实线光带，稍微抬高 1.5 米彻底消除与计划线的 Z-Fighting 深度冲突)
    const initData = trajectory.interpolateAtProgress(trajectory.getProgress());
    const initAlt = initData.coordinate.alt ?? 60;
    const initialPos = Cartesian3.fromDegrees(
      initData.coordinate.lng,
      initData.coordinate.lat,
      initAlt,
    );

    const runtimeState: TrajectoryRuntimeState = {
      plan: planEntity,
      trailCoords: [
        Cartesian3.fromDegrees(
          trajectory.waypoints[0].lng,
          trajectory.waypoints[0].lat,
          (trajectory.waypoints[0].alt ?? 60) + 1.5,
        ),
      ],
      currentPos: initialPos,
      currentBearingRad: initData.bearingRad,
      currentAlt: initAlt,
    };

    const trailEntity = this.tracksDataSource.entities.add({
      name: `${trajectory.name}_飞行尾迹`,
      polyline: {
        // 核心技术：持有 runtimeState.trailCoords 数组引用，原地更新绝不销毁重建 Geometry
        positions: new CallbackProperty(() => runtimeState.trailCoords, false),
        width: trajectory.trailWidth || 3.5,
        material: parseCesiumColor(trajectory.trailColor, Color.CYAN),
      },
    });

    // 3. 无人机三维空间实体 (自定义图标 Billboard + 真实 3D GLB 模型 + 实时高度航向标签)
    const droneEntity = this.tracksDataSource.entities.add({
      name: trajectory.callsign,
      position: new CallbackPositionProperty(() => runtimeState.currentPos, false),
      orientation: new CallbackProperty(() => {
        const hpr = new HeadingPitchRoll(runtimeState.currentBearingRad, 0, 0);
        return Transforms.headingPitchRollQuaternion(runtimeState.currentPos, hpr);
      }, false),
      model: this.is3DModelEnabled
        ? {
            uri: '/models/drone.glb',
            minimumPixelSize: 64,
            maximumScale: 200,
            scale: 0.18,
            runAnimations: true,
          }
        : undefined,
      billboard: !this.is3DModelEnabled
        ? {
            image: trajectory.iconUrl,
            width: trajectory.iconSize?.[0] || 42,
            height: trajectory.iconSize?.[1] || 42,
            rotation: new CallbackProperty(() => -runtimeState.currentBearingRad, false),
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          }
        : undefined,
      label: createHdLabelOptions({
        text: new CallbackProperty(
          () =>
            `✈ ${trajectory.callsign}\n[高度: ${runtimeState.currentAlt}m | 航向: ${Math.round(
              (runtimeState.currentBearingRad * 180) / Math.PI,
            )}°]`,
          false,
        ),
        pixelOffset: new Cartesian2(0, -34),
      }),
    });

    runtimeState.drone = droneEntity;
    runtimeState.trail = trailEntity;

    this.trajectoryEntities.set(trajectory.id, runtimeState);
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
    const state = this.trajectoryEntities.get(trajectoryId);
    if (state) {
      if (state.drone) this.tracksDataSource.entities.remove(state.drone);
      if (state.trail) this.tracksDataSource.entities.remove(state.trail);
      this.tracksDataSource.entities.remove(state.plan);
      this.trajectoryEntities.delete(trajectoryId);
    }
    this.trajectoryMap.delete(trajectoryId);

    // 同步移除海空实时目标、航线与尾迹 Entity
    const liveDrone = this.liveDroneEntities.get(trajectoryId);
    if (liveDrone) {
      this.tracksDataSource.entities.remove(liveDrone);
      this.liveDroneEntities.delete(trajectoryId);
    }
    const liveTrail = this.liveDroneTrailEntities.get(trajectoryId);
    if (liveTrail) {
      this.tracksDataSource.entities.remove(liveTrail);
      this.liveDroneTrailEntities.delete(trajectoryId);
    }
    const liveRoute = this.liveDroneRouteEntities.get(trajectoryId);
    if (liveRoute) {
      this.tracksDataSource.entities.remove(liveRoute);
      this.liveDroneRouteEntities.delete(trajectoryId);
    }
    this.liveDroneHistoryCoords.delete(trajectoryId);
  }

  clearAllTrajectories(): void {
    if (this.animTimer) {
      clearInterval(this.animTimer);
      this.animTimer = null;
    }
    if (this.viewer) {
      this.viewer.trackedEntity = undefined;
    }
    this.tracksDataSource.entities.removeAll();
    this.trajectoryEntities.clear();
    this.trajectoryMap.clear();
    this.liveDroneEntities.clear();
    this.liveDroneTrailEntities.clear();
    this.liveDroneRouteEntities.clear();
    this.liveDroneHistoryCoords.clear();
    this.selectedTargetId = null;
    this.trackedTargetId = null;
  }

  private startAnimationLoop(): void {
    const intervalMs = 25; // 40 FPS 平滑时钟推进
    this.animTimer = window.setInterval(() => {
      let activeCount = 0;

      for (const trajectory of this.trajectoryMap.values()) {
        if (trajectory.getStatus() === 'running') {
          activeCount++;
          const currentProgress = trajectory.getProgress();
          const step = 0.0015 * trajectory.speedMultiplier;
          const nextProgress = currentProgress + step;

          if (nextProgress >= 1.0) {
            trajectory.setProgress(0); // 循环巡逻侦察飞行
            const state = this.trajectoryEntities.get(trajectory.id);
            if (state && trajectory.waypoints.length > 0) {
              state.trailCoords = [
                Cartesian3.fromDegrees(
                  trajectory.waypoints[0].lng,
                  trajectory.waypoints[0].lat,
                  (trajectory.waypoints[0].alt ?? 60) + 1.5,
                ),
              ];
            }
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
    const state = this.trajectoryEntities.get(trajectory.id);
    if (!state) return;

    const progress = trajectory.getProgress();
    const currentData = trajectory.interpolateAtProgress(progress);
    const alt = currentData.coordinate.alt ?? 60;
    const pos = Cartesian3.fromDegrees(
      currentData.coordinate.lng,
      currentData.coordinate.lat,
      alt,
    );

    // 原地更新内存状态，CallbackProperty 自动取值，零重建、零丢帧
    state.currentPos = pos;
    state.currentBearingRad = currentData.bearingRad;
    state.currentAlt = alt;

    // 动态更新尾迹折线坐标点集合 (稍微抬高 1.5 米彻底消除深度冲突)
    if (trajectory.showTrail) {
      const trailPoints: Cartesian3[] = [];
      const totalPoints = trajectory.waypoints.length;
      const reachedCount = Math.min(
        Math.floor(progress * (totalPoints - 1)) + 1,
        totalPoints,
      );

      for (let i = 0; i < reachedCount; i++) {
        const w = trajectory.waypoints[i];
        trailPoints.push(Cartesian3.fromDegrees(w.lng, w.lat, (w.alt ?? 60) + 1.5));
      }
      trailPoints.push(Cartesian3.fromDegrees(
        currentData.coordinate.lng,
        currentData.coordinate.lat,
        alt + 1.5,
      ));

      state.trailCoords = trailPoints;
    }
  }

  // ================= 三维空间分析与战术量测实现 =================

  startSpatialMeasure(type: 'distance' | 'area', onUpdate?: (result: SpatialMeasureResult) => void): void {
    if (!this.viewer) return;
    this.stopManualDraw();
    this.clearSpatialMeasure();

    this.measureEventHandler = new ScreenSpaceEventHandler(this.viewer.scene.canvas);
    const measuredCoords: Coordinate[] = [];
    let currentMoveCoord: Coordinate | null = null;

    const pickCoord = (screenPosition: Cartesian2): Coordinate | null => {
      if (!this.viewer) return null;
      let cartesian: Cartesian3 | undefined;
      if (this.viewer.scene.pickPositionSupported) {
        cartesian = this.viewer.scene.pickPosition(screenPosition);
      }
      if (!cartesian) {
        const ray = this.viewer.camera.getPickRay(screenPosition);
        if (ray) cartesian = this.viewer.scene.globe.pick(ray, this.viewer.scene);
      }
      if (!cartesian) {
        cartesian = this.viewer.camera.pickEllipsoid(screenPosition, this.viewer.scene.globe.ellipsoid);
      }
      if (!cartesian) return null;
      const carto = this.viewer.scene.globe.ellipsoid.cartesianToCartographic(cartesian);
      if (!carto) return null;
      return {
        lng: CesiumMath.toDegrees(carto.longitude),
        lat: CesiumMath.toDegrees(carto.latitude),
        alt: Math.round(carto.height),
      };
    };

    // 鼠标移动动态橡皮筋预览
    this.measureEventHandler.setInputAction((event: { endPosition: Cartesian2 }) => {
      const coord = pickCoord(event.endPosition);
      if (coord) currentMoveCoord = coord;
    }, ScreenSpaceEventType.MOUSE_MOVE);

    // 鼠标点击添加测量节点
    this.measureEventHandler.setInputAction((event: { position: Cartesian2 }) => {
      const coord = pickCoord(event.position);
      if (!coord) return;

      measuredCoords.push(coord);

      // 添加节点小黄点
      this.measureDataSource.entities.add({
        position: Cartesian3.fromDegrees(coord.lng, coord.lat, coord.alt || 0),
        point: {
          pixelSize: 8,
          color: Color.YELLOW,
          outlineColor: Color.WHITE,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
          heightReference: HeightReference.CLAMP_TO_GROUND,
        },
      });

      if (type === 'distance' && measuredCoords.length === 1) {
        // 创建动态测距线
        this.measureDataSource.entities.add({
          polyline: {
            positions: new CallbackProperty(() => {
              const all = [...measuredCoords];
              if (currentMoveCoord) all.push(currentMoveCoord);
              const flat: number[] = [];
              all.forEach((p) => flat.push(p.lng, p.lat, p.alt || 0));
              return Cartesian3.fromDegreesArrayHeights(flat);
            }, false),
            width: 3,
            material: Color.YELLOW,
            clampToGround: true,
          },
        });
      } else if (type === 'area' && measuredCoords.length === 1) {
        // 创建动态测面
        this.measureDataSource.entities.add({
          polygon: {
            hierarchy: new CallbackProperty(() => {
              const all = [...measuredCoords];
              if (currentMoveCoord) all.push(currentMoveCoord);
              if (all.length < 3) return new PolygonHierarchy([]);
              const flat: number[] = [];
              all.forEach((p) => flat.push(p.lng, p.lat));
              return new PolygonHierarchy(Cartesian3.fromDegreesArray(flat));
            }, false),
            classificationType: ClassificationType.BOTH,
            material: new Color(0, 1, 0.8, 0.25),
            outline: true,
            outlineColor: Color.CYAN,
            outlineWidth: 2,
          },
        });
      }
    }, ScreenSpaceEventType.LEFT_CLICK);

    // 双击或右键完成量测
    const finishMeasure = () => {
      if (this.measureEventHandler) {
        this.measureEventHandler.destroy();
        this.measureEventHandler = null;
      }

      let result: SpatialMeasureResult;

      if (type === 'distance' && measuredCoords.length >= 2) {
        const totalDist = SpatialCalculator.calculatePolylineDistance(measuredCoords);
        const spatialInfo = SpatialCalculator.calculateSpatialDistance(
          measuredCoords[0],
          measuredCoords[measuredCoords.length - 1],
        );

        result = {
          totalDistanceMeters: totalDist,
          spatialDistanceMeters: Math.round(spatialInfo.spatialDistance),
          horizontalDistanceMeters: Math.round(spatialInfo.horizontalDistance),
          heightDifferenceMeters: Math.round(spatialInfo.heightDiff),
          formattedDistance: SpatialCalculator.formatDistance(totalDist),
        };

        const last = measuredCoords[measuredCoords.length - 1];
        this.measureDataSource.entities.add({
          position: Cartesian3.fromDegrees(last.lng, last.lat, last.alt || 0),
          label: createHdLabelOptions({
            text: `地表总长: ${result.formattedDistance}\n空间直线: ${SpatialCalculator.formatDistance(
              result.spatialDistanceMeters!,
            )}\n垂直高差: ${result.heightDifferenceMeters}米`,
            pixelOffset: new Cartesian2(0, -36),
          }),
        });
      } else {
        const area = SpatialCalculator.calculatePolygonArea(measuredCoords);
        result = {
          totalDistanceMeters: 0,
          areaSquareMeters: area,
          formattedDistance: '',
          formattedArea: SpatialCalculator.formatArea(area),
        };

        const center = measuredCoords[0];
        this.measureDataSource.entities.add({
          position: Cartesian3.fromDegrees(center.lng, center.lat, center.alt || 0),
          label: createHdLabelOptions({
            text: `三维测算面积:\n${result.formattedArea}`,
            pixelOffset: new Cartesian2(0, -28),
          }),
        });
      }

      if (onUpdate) onUpdate(result);
    };

    this.measureEventHandler.setInputAction(finishMeasure, ScreenSpaceEventType.RIGHT_CLICK);
    this.measureEventHandler.setInputAction(finishMeasure, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  }

  clearSpatialMeasure(): void {
    if (this.measureEventHandler) {
      this.measureEventHandler.destroy();
      this.measureEventHandler = null;
    }
    this.measureDataSource.entities.removeAll();
  }

  // ================= 交互式航线任务规划与航点编辑实现 =================

  startRoutePlanning(
    onWaypointChange?: (waypoints: RoutePlanWaypoint[]) => void,
    onComplete?: (waypoints: RoutePlanWaypoint[]) => void,
    taskType?: 'route' | 'area' | 'strike',
  ): void {
    if (!this.viewer) return;
    this.stopRoutePlanning();

    this.routePlanEventHandler = new ScreenSpaceEventHandler(this.viewer.scene.canvas);

    const resolvedType = taskType || 'route';

    const pickCoord = (screenPosition: Cartesian2): Coordinate | null => {
      if (!this.viewer) return null;
      let cartesian: Cartesian3 | undefined;
      if (this.viewer.scene.pickPositionSupported) {
        cartesian = this.viewer.scene.pickPosition(screenPosition);
      }
      if (!cartesian) {
        const ray = this.viewer.camera.getPickRay(screenPosition);
        if (ray) cartesian = this.viewer.scene.globe.pick(ray, this.viewer.scene);
      }
      if (!cartesian) {
        cartesian = this.viewer.camera.pickEllipsoid(screenPosition, this.viewer.scene.globe.ellipsoid);
      }
      if (!cartesian) return null;
      const carto = this.viewer.scene.globe.ellipsoid.cartesianToCartographic(cartesian);
      if (!carto) return null;
      return {
        lng: CesiumMath.toDegrees(carto.longitude),
        lat: CesiumMath.toDegrees(carto.latitude),
        alt: Math.round(carto.height),
      };
    };

    // 结束与闭合判定逻辑 (支持鼠标右键 RIGHT_CLICK 或鼠标左键双击 LEFT_DOUBLE_CLICK)
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

        const flatArray: number[] = [];
        this.activeRoutePlanWaypoints.forEach((w) => flatArray.push(w.lng, w.lat, w.alt ?? 160));

        this.routePlanDataSource.entities.add({
          name: '闭合防区多边形面',
          polygon: {
            hierarchy: new PolygonHierarchy(Cartesian3.fromDegreesArrayHeights(flatArray)),
            material: new Color(0, 0.9, 1, 0.22),
            outline: true,
            outlineColor: Color.CYAN,
            outlineWidth: 2.5,
          },
        });
      } else if (resolvedType === 'strike' && this.activeRoutePlanWaypoints.length >= 2) {
        // 如果是攻击任务 (strike)，终点绘制红色目标标靶
        const targetWp = this.activeRoutePlanWaypoints[this.activeRoutePlanWaypoints.length - 1];
        this.routePlanDataSource.entities.add({
          name: '🎯 打击目标阵地',
          position: Cartesian3.fromDegrees(targetWp.lng, targetWp.lat, targetWp.alt ?? 50),
          point: {
            pixelSize: 14,
            color: Color.RED,
            outlineColor: Color.WHITE,
            outlineWidth: 3,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
          label: createHdLabelOptions({
            text: '🎯 打击目标阵地',
            pixelOffset: new Cartesian2(0, -32),
            heightReference: HeightReference.NONE,
          }),
        });
      }

      this.stopRoutePlanning();
      if (onComplete) {
        onComplete([...this.activeRoutePlanWaypoints]);
      }
    };

    // 绑定左键连续加点
    this.routePlanEventHandler.setInputAction((event: { position: Cartesian2 }) => {
      const coord = pickCoord(event.position);
      if (!coord) return;

      const seq = this.activeRoutePlanWaypoints.length + 1;
      const defaultAlt = resolvedType === 'area' ? 220 : resolvedType === 'strike' ? (seq === 1 ? 120 : 70) : 150;
      const prefix = resolvedType === 'area' ? '防区点' : resolvedType === 'strike' ? (seq === 1 ? '突防始发' : '进击点') : 'WP';
      const themeColor = resolvedType === 'strike' ? Color.fromCssColorString('#ff3d00') : resolvedType === 'area' ? Color.CYAN : Color.YELLOW;

      const wp: RoutePlanWaypoint = {
        id: `wp_${seq}_${Date.now()}`,
        name: `${prefix}-${seq}`,
        lng: coord.lng,
        lat: coord.lat,
        alt: Math.max(80, (coord.alt || 0) + defaultAlt),
        speedKmh: resolvedType === 'strike' ? 320 : 160,
        action: seq === 1 ? 'takeoff' : (resolvedType === 'strike' ? 'strike' : 'recon'),
      };

      this.activeRoutePlanWaypoints.push(wp);

      // 实时增量渲染航点
      this.routePlanDataSource.entities.add({
        position: Cartesian3.fromDegrees(wp.lng, wp.lat, wp.alt),
        point: {
          pixelSize: 10,
          color: themeColor,
          outlineColor: Color.WHITE,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: createHdLabelOptions({
          text: `${wp.name}\n[高度: ${wp.alt}m]`,
          pixelOffset: new Cartesian2(0, -32),
          heightReference: HeightReference.NONE,
        }),
      });

      // 自动绘制/更新航线段
      if (this.activeRoutePlanWaypoints.length >= 2) {
        const flatArray: number[] = [];
        this.activeRoutePlanWaypoints.forEach((w) => flatArray.push(w.lng, w.lat, w.alt ?? 120));

        this.routePlanDataSource.entities.add({
          polyline: {
            positions: Cartesian3.fromDegreesArrayHeights(flatArray),
            width: 3,
            material: themeColor.withAlpha(0.85),
          },
        });
      }

      if (onWaypointChange) onWaypointChange([...this.activeRoutePlanWaypoints]);
    }, ScreenSpaceEventType.LEFT_CLICK);

    // 绑定右键与双击触发结束与闭合
    this.routePlanEventHandler.setInputAction(finishPlanning, ScreenSpaceEventType.RIGHT_CLICK);
    this.routePlanEventHandler.setInputAction(finishPlanning, ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  }

  stopRoutePlanning(): void {
    if (this.routePlanEventHandler) {
      this.routePlanEventHandler.destroy();
      this.routePlanEventHandler = null;
    }
  }

  renderRoutePlan(plan: MissionRoutePlan): void {
    this.clearRoutePlan();
    this.activeRoutePlanWaypoints = [...plan.waypoints];

    const resolvedType = plan.type || 'route';
    const themeColor = resolvedType === 'strike' ? Color.fromCssColorString('#ff3d00') : resolvedType === 'area' ? Color.CYAN : Color.YELLOW;

    if (plan.waypoints.length >= 2) {
      const flatArray: number[] = [];
      plan.waypoints.forEach((w) => flatArray.push(w.lng, w.lat, w.alt ?? 120));

      this.routePlanDataSource.entities.add({
        name: `${plan.name}_规划连线`,
        polyline: {
          positions: Cartesian3.fromDegreesArrayHeights(flatArray),
          width: 3,
          material: themeColor.withAlpha(0.85),
        },
      });

      // 如果是区域任务 (area)，并且首尾闭合，渲染三维多边形防区面
      if (resolvedType === 'area' && plan.waypoints.length >= 3) {
        this.routePlanDataSource.entities.add({
          name: '闭合防区多边形面',
          polygon: {
            hierarchy: new PolygonHierarchy(Cartesian3.fromDegreesArrayHeights(flatArray)),
            material: new Color(0, 0.9, 1, 0.22),
            outline: true,
            outlineColor: Color.CYAN,
            outlineWidth: 2.5,
          },
        });
      }
    }

    plan.waypoints.forEach((wp, idx) => {
      const isTarget = resolvedType === 'strike' && idx === plan.waypoints.length - 1;
      this.routePlanDataSource.entities.add({
        name: wp.name,
        position: Cartesian3.fromDegrees(wp.lng, wp.lat, wp.alt),
        point: {
          pixelSize: isTarget ? 14 : 10,
          color: isTarget ? Color.RED : themeColor,
          outlineColor: Color.WHITE,
          outlineWidth: 2,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: createHdLabelOptions({
          text: isTarget ? '🎯 打击目标' : `${wp.name}\n[高度: ${wp.alt}m]`,
          pixelOffset: new Cartesian2(0, -32),
          heightReference: HeightReference.NONE,
        }),
      });
    });
  }

  clearRoutePlan(): void {
    this.stopRoutePlanning();
    this.activeRoutePlanWaypoints = [];
    this.routePlanDataSource.entities.removeAll();
  }

  // ================= 实时流式态势遥测与三维模型姿态解算实现 =================

  updateDroneLivePosition(frame: DroneTelemetryFrame): void {
    if (!this.viewer) return;

    const isShip = frame.category === 'maritime';
    const alt = isShip ? 0 : (frame.coordinate.alt ?? 120);
    const pos = Cartesian3.fromDegrees(frame.coordinate.lng, frame.coordinate.lat, alt);

    // 三维空间姿态解算 (航向 Heading、俯仰 Pitch、横滚 Roll 转换为姿态四元数)
    const heading = CesiumMath.toRadians(frame.headingDeg);
    const pitch = CesiumMath.toRadians(frame.pitchDeg);
    const roll = CesiumMath.toRadians(frame.rollDeg);
    const hpr = new HeadingPitchRoll(heading, pitch, roll);
    const orientation = Transforms.headingPitchRollQuaternion(pos, hpr);

    const labelTitle = isShip ? `🚢 ${frame.callsign}` : `✈ ${frame.callsign}`;
    const speedUnit = isShip ? '节' : 'km/h';
    const altText = isShip ? '' : `FL:${Math.round(alt / 100)} (${alt}m) | `;
    const routeText = frame.origin && frame.destination ? `\n${frame.origin} ➔ ${frame.destination}` : '';
    const labelFull = `${labelTitle}\n[${altText}${frame.speedKmh}${speedUnit} | 航向:${Math.round(frame.headingDeg)}°]${routeText}`;

    // 1. 更新或创建目标模型 / Billboard 图标与高清文字标签
    let entity = this.liveDroneEntities.get(frame.droneId);

    if (!entity) {
      const iconSrc = isShip ? '/icons/ship.svg' : '/icons/airplane.svg';
      const iconWidth = isShip ? 24 : 38;
      const iconHeight = isShip ? 48 : 38;

      const isUav = frame.model.includes('无人机') || frame.model.includes('UAV') || frame.droneId.includes('UAV');
      const planeModelUri = isUav ? '/models/drone.glb' : '/models/airplane.glb';
      const planeScale = isUav ? 0.16 : 4.0;

      const modelUri = isShip ? '/models/ship.glb' : planeModelUri;
      const modelScale = isShip ? 1.0 : planeScale;

      entity = this.tracksDataSource.entities.add({
        name: frame.callsign,
        position: pos,
        orientation,
        // 三维精细模型 (飞机为客机/无人机模型，船舶为货轮模型)
        model: this.is3DModelEnabled
          ? {
              uri: modelUri,
              minimumPixelSize: 64,
              maximumScale: 350,
              scale: modelScale,
              runAnimations: true,
              heightReference: isShip ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE,
            }
          : undefined,
        billboard: !this.is3DModelEnabled
          ? {
              image: iconSrc,
              width: iconWidth,
              height: iconHeight,
              rotation: -CesiumMath.toRadians(frame.headingDeg),
              heightReference: isShip ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
            }
          : undefined,
        label: createHdLabelOptions({
          text: labelFull,
          pixelOffset: new Cartesian2(0, isShip ? -34 : -30),
          heightReference: isShip ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE,
        }),
      });
      this.liveDroneEntities.set(frame.droneId, entity);
    } else {
      entity.position = new ConstantPositionProperty(pos);
      entity.orientation = new ConstantProperty(orientation);
      if (entity.billboard) {
        entity.billboard.rotation = new ConstantProperty(-CesiumMath.toRadians(frame.headingDeg));
      }
      if (entity.label) {
        entity.label.text = new ConstantProperty(labelFull);
      }
    }

    // 2. 绘制或更新全程计划航线/航道 (Route)
    if (frame.route && frame.route.length >= 2) {
      let routeEntity = this.liveDroneRouteEntities.get(frame.droneId);
      const positions: Cartesian3[] = [];

      if (isShip) {
        const flat: number[] = [];
        frame.route.forEach((w) => flat.push(w.lng, w.lat));
        positions.push(...Cartesian3.fromDegreesArray(flat));
      } else {
        const flat: number[] = [];
        frame.route.forEach((w) => flat.push(w.lng, w.lat, (w.alt && w.alt > 0) ? w.alt : 8000));
        positions.push(...Cartesian3.fromDegreesArrayHeights(flat));
      }

      if (!routeEntity) {
        routeEntity = this.tracksDataSource.entities.add({
          name: `${frame.callsign}_计划航线`,
          polyline: {
            positions: new ConstantProperty(positions),
            width: 2.2,
            material: new PolylineDashMaterialProperty({
              color: isShip
                ? Color.fromCssColorString('rgba(30, 144, 255, 0.75)')
                : Color.fromCssColorString('rgba(0, 240, 255, 0.65)'),
              dashLength: isShip ? 14.0 : 16.0,
            }),
            clampToGround: isShip,
          },
        });
        this.liveDroneRouteEntities.set(frame.droneId, routeEntity);
      } else if (routeEntity.polyline) {
        routeEntity.polyline.positions = new ConstantProperty(positions);
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
      let trailEntity = this.liveDroneTrailEntities.get(frame.droneId);
      const positions: Cartesian3[] = [];

      if (isShip) {
        const flat: number[] = [];
        trailPoints.forEach((p) => flat.push(p.lng, p.lat));
        positions.push(...Cartesian3.fromDegreesArray(flat));
      } else {
        const flat: number[] = [];
        trailPoints.forEach((p) => flat.push(p.lng, p.lat, (p.alt && p.alt > 0) ? p.alt : alt));
        positions.push(...Cartesian3.fromDegreesArrayHeights(flat));
      }

      if (!trailEntity) {
        trailEntity = this.tracksDataSource.entities.add({
          name: `${frame.callsign}_动态尾迹`,
          polyline: {
            positions: new ConstantProperty(positions),
            width: isShip ? 3.0 : 3.5,
            material: isShip
              ? Color.fromCssColorString('rgba(0, 255, 200, 0.85)')
              : new PolylineGlowMaterialProperty({
                  glowPower: 0.25,
                  color: Color.fromCssColorString('#ffd700'),
                }),
            clampToGround: isShip,
          },
        });
        this.liveDroneTrailEntities.set(frame.droneId, trailEntity);
      } else if (trailEntity.polyline) {
        trailEntity.polyline.positions = new ConstantProperty(positions);
      }
    }
  }

  highlightGeofenceAlert(geofenceId: string, isAlerting: boolean): void {
    const entity = this.entitiesMap.get(geofenceId);
    if (!entity) return;

    if (isAlerting) {
      // 警报触发：边框与材质变亮红并加粗
      if (entity.ellipse) {
        entity.ellipse.outlineColor = new ConstantProperty(Color.RED);
        entity.ellipse.outlineWidth = new ConstantProperty(4.5);
        entity.ellipse.material = new ColorMaterialProperty(new Color(1, 0, 0, 0.45));
      }
      if (entity.polygon) {
        entity.polygon.outlineColor = new ConstantProperty(Color.RED);
        entity.polygon.outlineWidth = new ConstantProperty(4.5);
        entity.polygon.material = new ColorMaterialProperty(new Color(1, 0, 0, 0.45));
      }
    } else {
      // 恢复原图形样式
      const graphic = this.graphicsMap.get(geofenceId);
      if (graphic) {
        const stroke = parseCesiumColor(graphic.style.strokeColor, Color.CYAN);
        const fill = parseCesiumColor(graphic.style.fillColor, new Color(0, 0.9, 1, 0.25));
        if (entity.ellipse) {
          entity.ellipse.outlineColor = new ConstantProperty(stroke);
          entity.ellipse.outlineWidth = new ConstantProperty(graphic.style.strokeWidth || 2);
          entity.ellipse.material = new ColorMaterialProperty(fill);
        }
        if (entity.polygon) {
          entity.polygon.outlineColor = new ConstantProperty(stroke);
          entity.polygon.outlineWidth = new ConstantProperty(graphic.style.strokeWidth || 2);
          entity.polygon.material = new ColorMaterialProperty(fill);
        }
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
    if (!this.viewer) return;

    if (targetId) {
      const entity = this.liveDroneEntities.get(targetId);
      if (entity) {
        this.viewer.trackedEntity = entity;
      }
    } else {
      this.viewer.trackedEntity = undefined;
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

  setDrone3DModelEnabled(enabled: boolean): void {
    this.is3DModelEnabled = enabled;
    // 动态刷新存量实时海空目标 (飞机与轮船自适应模型)
    this.liveDroneEntities.forEach((entity, id) => {
      const isShip = id.startsWith('MMSI');
      const isUav = id.includes('UAV') || id.includes('TY');
      const planeModel = isUav ? '/models/drone.glb' : '/models/airplane.glb';
      const planeScale = isUav ? 0.16 : 4.0;

      if (enabled) {
        entity.billboard = undefined;
        entity.model = new ModelGraphics({
          uri: isShip ? '/models/ship.glb' : planeModel,
          minimumPixelSize: 64,
          maximumScale: 350,
          scale: isShip ? 1.0 : planeScale,
          runAnimations: true,
          heightReference: isShip ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE,
        });
      } else {
        entity.model = undefined;
        entity.billboard = new BillboardGraphics({
          image: isShip ? '/icons/ship.svg' : '/icons/airplane.svg',
          width: isShip ? 24 : 38,
          height: isShip ? 48 : 38,
          heightReference: isShip ? HeightReference.CLAMP_TO_GROUND : HeightReference.NONE,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        });
      }
    });
  }
}

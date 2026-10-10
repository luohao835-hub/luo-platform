import type { Coordinate } from '@/domain/geometry/Coordinate';

/**
 * 轨迹航路点定义
 */
export interface TrajectoryWaypoint extends Coordinate {
  speed?: number;          // 巡航速度 (km/h)
  hoverDurationSec?: number;// 悬停时间 (秒)
  actionName?: string;     // 该航路点战术动作 (例如: 拍照、侦察、俯冲投送)
}

/**
 * 航迹运动状态
 */
export type TrajectoryPlayStatus = 'idle' | 'running' | 'paused' | 'completed';

/**
 * 轨迹创建属性
 */
export interface DroneTrajectoryProps {
  id: string;
  name: string;
  callsign: string;               // 无人机战术呼号 (如: UAV-Recon-01)
  iconUrl: string;                // 无人机自定义图标 (如: /icons/drone.png)
  iconSize?: [number, number];    // 渲染像素尺寸 [宽, 高]
  waypoints: TrajectoryWaypoint[];// 航路点序列 (按先后时序排列，至少 2 个点)
  speedMultiplier?: number;       // 飞行速度倍率 (默认 1)
  trailColor?: string;            // 航迹光带尾焰颜色
  trailWidth?: number;            // 尾迹线宽度
  showTrail?: boolean;            // 是否显示飞行尾迹
}

/**
 * 无人机轨迹运动领域实体 (DroneTrajectory)
 * 纯 TypeScript 业务模型，封装航向方位角与几何插值算法
 */
export class DroneTrajectory {
  public readonly id: string;
  public readonly name: string;
  public readonly callsign: string;
  public readonly iconUrl: string;
  public readonly iconSize: [number, number];
  public readonly waypoints: TrajectoryWaypoint[];
  public readonly speedMultiplier: number;
  public readonly trailColor: string;
  public readonly trailWidth: number;
  public readonly showTrail: boolean;

  private status: TrajectoryPlayStatus = 'idle';
  private currentProgress: number = 0; // 0.0 ~ 1.0 航程完成进度

  constructor(props: DroneTrajectoryProps) {
    this.id = props.id || `track_${Date.now()}`;
    this.name = props.name || '无人机巡航轨迹';
    this.callsign = props.callsign || 'UAV-01';
    this.iconUrl = props.iconUrl || '/icons/drone.png';
    this.iconSize = props.iconSize || [42, 42];
    this.waypoints = props.waypoints;
    this.speedMultiplier = props.speedMultiplier ?? 1;
    this.trailColor = props.trailColor || '#00e5ff';
    this.trailWidth = props.trailWidth || 3;
    this.showTrail = props.showTrail ?? true;

    this.validate();
  }

  private validate(): void {
    if (!this.waypoints || this.waypoints.length < 2) {
      throw new Error('无人机飞行轨迹至少需要 2 个航路点');
    }
    if (!this.iconUrl) {
      throw new Error('无人机自定义图标地址不能为空');
    }
  }

  getStatus(): TrajectoryPlayStatus {
    return this.status;
  }

  setStatus(status: TrajectoryPlayStatus): void {
    this.status = status;
  }

  getProgress(): number {
    return this.currentProgress;
  }

  setProgress(progress: number): void {
    this.currentProgress = Math.max(0, Math.min(1, progress));
  }

  /**
   * 计算两个坐标点之间的方位角 (机头朝向角，单位：弧度，顺时针以正北为0)
   */
  public static calculateBearingRad(p1: Coordinate, p2: Coordinate): number {
    const deg2rad = Math.PI / 180;
    const rad2deg = 180 / Math.PI;

    const lat1 = p1.lat * deg2rad;
    const lat2 = p2.lat * deg2rad;
    const dLon = (p2.lng - p1.lng) * deg2rad;

    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

    let bearing = Math.atan2(y, x) * rad2deg;
    bearing = (bearing + 360) % 360;
    return bearing * deg2rad;
  }

  /**
   * 沿航线按进度比率 [0.0 ~ 1.0] 插值计算当前空间坐标与机头朝向
   */
  public interpolateAtProgress(progress: number): {
    coordinate: Coordinate;
    bearingRad: number;
    segmentIndex: number;
  } {
    const clampedProgress = Math.max(0, Math.min(1, progress));
    const totalSegments = this.waypoints.length - 1;
    const rawIndex = clampedProgress * totalSegments;
    const segmentIndex = Math.min(Math.floor(rawIndex), totalSegments - 1);
    const segmentRatio = rawIndex - segmentIndex;

    const p1 = this.waypoints[segmentIndex];
    const p2 = this.waypoints[segmentIndex + 1];

    const lng = p1.lng + (p2.lng - p1.lng) * segmentRatio;
    const lat = p1.lat + (p2.lat - p1.lat) * segmentRatio;
    const alt1 = p1.alt ?? 0;
    const alt2 = p2.alt ?? 0;
    const alt = alt1 + (alt2 - alt1) * segmentRatio;

    const bearingRad = DroneTrajectory.calculateBearingRad(p1, p2);

    return {
      coordinate: { lng, lat, alt: Math.round(alt) },
      bearingRad,
      segmentIndex,
    };
  }

  /**
   * 从网络通用标准 GeoJSON (LineString) 实体解析生成 DroneTrajectory
   */
  public static fromGeoJson(
    geoJson: {
      properties?: Record<string, unknown>;
      geometry?: { type: string; coordinates: number[][] };
    },
    overrides?: Partial<DroneTrajectoryProps>,
  ): DroneTrajectory {
    const props = geoJson.properties || {};
    const rawCoords = geoJson.geometry?.coordinates || [];

    const waypoints: TrajectoryWaypoint[] = rawCoords.map((c) => ({
      lng: c[0],
      lat: c[1],
      alt: c[2] ?? 0,
    }));

    return new DroneTrajectory({
      id:
        overrides?.id ||
        (typeof props.id === 'string' ? props.id : `flight_${Date.now()}`),
      name:
        overrides?.name ||
        (typeof props.name === 'string' ? props.name : '网络仿真飞行航线'),
      callsign:
        overrides?.callsign ||
        (typeof props.callsign === 'string' ? props.callsign : 'UAV-NET'),
      iconUrl:
        overrides?.iconUrl ||
        (typeof props.iconUrl === 'string' ? props.iconUrl : '/icons/drone.png'),
      iconSize:
        overrides?.iconSize ||
        (Array.isArray(props.iconSize) && props.iconSize.length === 2
          ? (props.iconSize as [number, number])
          : [42, 42]),
      waypoints,
      speedMultiplier:
        overrides?.speedMultiplier ??
        (typeof props.speedMultiplier === 'number' ? props.speedMultiplier : 1.2),
      trailColor:
        overrides?.trailColor ||
        (typeof props.trailColor === 'string' ? props.trailColor : '#00e5ff'),
      trailWidth:
        overrides?.trailWidth ||
        (typeof props.trailWidth === 'number' ? props.trailWidth : 3),
      showTrail:
        overrides?.showTrail ??
        (typeof props.showTrail === 'boolean' ? props.showTrail : true),
    });
  }
}

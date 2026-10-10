import type { Coordinate } from '@/domain/geometry/Coordinate';

export type TargetCategory = 'aviation' | 'maritime';

export interface DroneTelemetryProps {
  id?: string;
  droneId?: string;
  callsign: string;
  category?: TargetCategory;
  model?: string;
  coord?: Coordinate;
  coordinate?: Coordinate;
  speed?: number;
  speedKmh?: number;
  heading?: number;
  headingDeg?: number;
  pitch?: number;
  pitchDeg?: number;
  roll?: number;
  rollDeg?: number;
  origin?: string;
  destination?: string;
  status?: string;
  batteryPct?: number;
  timestamp?: number;
  trail?: Coordinate[];
  route?: Coordinate[];
}

/**
 * 全球海空目标动态位姿与机载遥测领域实体
 * 覆盖飞机 (Aviation) 与船舶 (Maritime)
 */
export class DroneTelemetryFrame {
  public readonly droneId: string;
  public readonly callsign: string;
  public readonly category: TargetCategory;
  public readonly model: string;
  public readonly coordinate: Coordinate;
  public readonly speedKmh: number;
  public readonly headingDeg: number;
  public readonly pitchDeg: number;
  public readonly rollDeg: number;
  public readonly origin: string;
  public readonly destination: string;
  public readonly status: string;
  public readonly batteryPct: number;
  public readonly timestamp: number;
  public readonly trail: Coordinate[];
  public readonly route: Coordinate[];

  constructor(props: DroneTelemetryProps) {
    this.droneId = props.id || props.droneId || `target_${Date.now()}`;
    this.callsign = props.callsign || this.droneId;
    this.category = props.category || 'aviation';
    this.model = props.model || (this.category === 'maritime' ? '远洋货轮' : '客机/无人机');
    this.coordinate = props.coord || props.coordinate || { lng: 0, lat: 0, alt: 0 };
    this.speedKmh = props.speed ?? props.speedKmh ?? 0;
    this.headingDeg = props.heading ?? props.headingDeg ?? 0;
    this.pitchDeg = props.pitch ?? props.pitchDeg ?? 0;
    this.rollDeg = props.roll ?? props.rollDeg ?? 0;
    this.origin = props.origin || '';
    this.destination = props.destination || '';
    this.status = props.status || 'cruising';
    this.batteryPct = props.batteryPct ?? 100;
    this.timestamp = props.timestamp || Date.now();
    this.trail = props.trail || [];
    this.route = props.route || [];

    this.validate();
  }

  private validate(): void {
    if (!this.droneId) {
      throw new Error('海空目标唯一标识不能为空');
    }
    if (this.coordinate.lng == null || this.coordinate.lat == null) {
      throw new Error('海空目标缺少有效经纬度坐标');
    }
  }
}

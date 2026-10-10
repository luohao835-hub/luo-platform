import type { Coordinate } from '@/domain/geometry/Coordinate';
import { SpatialCalculator } from '@/domain/geometry/SpatialCalculator';
import { ReconnaissanceSubTask, type MissionTaskType } from '@/domain/task/ReconnaissanceSubTask';

/**
 * 规划航路点任务动作
 */
export type WaypointActionType = 'takeoff' | 'recon' | 'hover' | 'strike' | 'land';

export interface RoutePlanWaypoint extends Coordinate {
  id: string;
  name: string;
  action: WaypointActionType;
  speedKmh: number;      // 设定巡航速度 (km/h)
  hoverSec?: number;     // 悬停时间 (秒)
}

export interface MissionRoutePlanProps {
  id: string;
  name: string;
  type?: MissionTaskType;
  targetId: string;
  callsign: string;
  waypoints: RoutePlanWaypoint[];
  description?: string;
  createdAt?: number;
}

/**
 * 航线与作战任务规划领域实体 (MissionRoutePlan)
 * 支持航线巡航、区域防区巡逻、战术突防打击多种任务类型
 */
export class MissionRoutePlan {
  public readonly id: string;
  public name: string;
  public type: MissionTaskType;
  public targetId: string;
  public callsign: string;
  public waypoints: RoutePlanWaypoint[];
  public description?: string;
  public readonly createdAt: number;

  constructor(props: MissionRoutePlanProps) {
    this.id = props.id || `route_plan_${Date.now()}`;
    this.name = props.name || '新建作战任务';
    this.type = props.type ?? 'route';
    this.targetId = props.targetId || 'target_default_01';
    this.callsign = props.callsign || 'UAV-PLAN-01';
    this.waypoints = props.waypoints || [];
    this.description = props.description;
    this.createdAt = props.createdAt || Date.now();

    this.validate();
  }

  private validate(): void {
    if (!this.name.trim()) {
      throw new Error('航线规划任务名称不能为空');
    }
  }

  /**
   * 添加航路点
   */
  public addWaypoint(wp: RoutePlanWaypoint): void {
    this.waypoints.push(wp);
  }

  /**
   * 更新特定航路点坐标与高度
   */
  public updateWaypointCoord(id: string, coord: Coordinate): void {
    const target = this.waypoints.find((w) => w.id === id);
    if (target) {
      target.lng = coord.lng;
      target.lat = coord.lat;
      if (coord.alt != null) {
        target.alt = coord.alt;
      }
    }
  }

  /**
   * 移除航路点
   */
  public removeWaypoint(id: string): void {
    this.waypoints = this.waypoints.filter((w) => w.id !== id);
  }

  /**
   * 计算航线总里程 (米)
   */
  public getTotalDistance(): number {
    return SpatialCalculator.calculatePolylineDistance(this.waypoints);
  }

  /**
   * 估算航线飞行总耗时 (秒)
   */
  public estimateDurationSeconds(): number {
    if (this.waypoints.length < 2) return 0;
    let totalSec = 0;
    for (let i = 1; i < this.waypoints.length; i++) {
      const p1 = this.waypoints[i - 1];
      const p2 = this.waypoints[i];
      const distMeters = SpatialCalculator.calculateGroundDistance(p1, p2);
      const speedMs = (p2.speedKmh || 120) / 3.6;
      totalSec += distMeters / speedMs;
      if (p2.hoverSec) totalSec += p2.hoverSec;
    }
    return Math.round(totalSec);
  }

  /**
   * 业务闭环：转换为侦察子任务领域实体 (ReconnaissanceSubTask)
   * 以航路点生成的包络凸多边形或控制区域作为侦察区域
   */
  public toReconnaissanceSubTask(): ReconnaissanceSubTask {
    if (this.waypoints.length < 3) {
      throw new Error('规划航线至少需要 3 个航路点方可生成任务侦察闭环区域');
    }

    const areaCoords: Coordinate[] = this.waypoints.map((w) => ({
      lng: w.lng,
      lat: w.lat,
      alt: w.alt,
    }));

    return new ReconnaissanceSubTask({
      name: `[${this.type === 'area' ? '防区巡检' : this.type === 'strike' ? '战术打击' : '航线巡逻'}] ${this.name}`,
      type: this.type,
      targetId: this.targetId,
      area: areaCoords,
    });
  }
}

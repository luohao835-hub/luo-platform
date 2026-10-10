import type { Coordinate } from '@/domain/geometry/Coordinate';
import { SpatialCalculator } from '@/domain/geometry/SpatialCalculator';
import type { TacticalGraphic } from '@/domain/geometry/TacticalGraphic';

/**
 * 电子围栏入侵告警事件值对象
 */
export interface GeofenceBreachAlert {
  droneId: string;
  callsign: string;
  geofenceId: string;
  geofenceName: string;
  breachType: 'circle_breach' | 'polygon_breach';
  currentCoord: Coordinate;
  timestamp: number;
  message: string;
}

/**
 * 纯 TypeScript 空间几何电子围栏冲突与越界检测引擎
 * 严格遵从六边形架构 Domain 层原则，零第三方库依赖
 */
export class GeofenceConflictDetector {
  /**
   * 判定点是否在多边形内部 (经典射线交叉奇偶法 Ray-Casting Algorithm)
   */
  public static isPointInPolygon(point: Coordinate, polygon: Coordinate[]): boolean {
    if (polygon.length < 3) return false;

    let inside = false;
    const x = point.lng;
    const y = point.lat;
    const n = polygon.length;

    for (let i = 0, j = n - 1; i < n; j = i++) {
      const xi = polygon[i].lng;
      const yi = polygon[i].lat;
      const xj = polygon[j].lng;
      const yj = polygon[j].lat;

      const intersect =
        yi > y !== yj > y &&
        x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;

      if (intersect) {
        inside = !inside;
      }
    }

    return inside;
  }

  /**
   * 判定无人机当前位置是否侵入某个战术标绘围栏 (圆、矩形、多边形等)
   */
  public static checkBreach(
    coord: Coordinate,
    droneId: string,
    callsign: string,
    graphic: TacticalGraphic,
  ): GeofenceBreachAlert | null {
    // 1. 圆形禁飞区/电磁杀伤圈检测
    if (graphic.shapeType === 'circle') {
      const center = graphic.coordinates[0];
      const radius = graphic.radius || 500;
      const groundDist = SpatialCalculator.calculateGroundDistance(coord, center);

      if (groundDist <= radius) {
        return {
          droneId,
          callsign,
          geofenceId: graphic.id,
          geofenceName: graphic.name,
          breachType: 'circle_breach',
          currentCoord: coord,
          timestamp: Date.now(),
          message: `【电子围栏告警】无人机 [${callsign}] 侵入禁飞圆区 [${graphic.name}]！侵入深度: ${Math.round(radius - groundDist)} 米`,
        };
      }
      return null;
    }

    // 2. 矩形、多边形禁飞区检测
    if (
      graphic.shapeType === 'polygon' ||
      graphic.shapeType === 'rectangle' ||
      graphic.shapeType === 'square' ||
      graphic.shapeType === 'sector'
    ) {
      const isInside = this.isPointInPolygon(coord, graphic.coordinates);
      if (isInside) {
        return {
          droneId,
          callsign,
          geofenceId: graphic.id,
          geofenceName: graphic.name,
          breachType: 'polygon_breach',
          currentCoord: coord,
          timestamp: Date.now(),
          message: `【电子围栏告警】无人机 [${callsign}] 侵入封闭禁飞空域 [${graphic.name}]！`,
        };
      }
    }

    return null;
  }
}

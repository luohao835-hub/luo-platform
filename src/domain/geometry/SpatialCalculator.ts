import type { Coordinate } from '@/domain/geometry/Coordinate';

/**
 * 空间量测计算结果值对象
 */
export interface SpatialMeasureResult {
  totalDistanceMeters: number;     // 折线/航线总距离 (米)
  spatialDistanceMeters?: number;  // 空间直线三维距离 (米)
  horizontalDistanceMeters?: number;// 水平投影距离 (米)
  heightDifferenceMeters?: number; // 两点垂直高差 (米)
  areaSquareMeters?: number;       // 多边形面积 (平方米)
  formattedDistance: string;       // 格式化文本 (例如: "1.45 km" 或 "320 m")
  formattedArea?: string;          // 格式化面积 (例如: "2.35 km²" 或 "4,500 m²")
}

/**
 * 纯 TypeScript 三维空间与大地坐标系计算引擎
 * 严格遵循六边形架构 Domain 层无框架依赖规则
 */
export class SpatialCalculator {
  private static readonly DEG2RAD = Math.PI / 180;
  private static readonly R = 6378137; // WGS84 椭球体长半轴 (米)

  /**
   * 计算两点间的地表大圆距离 (Haversine 公式)
   */
  public static calculateGroundDistance(p1: Coordinate, p2: Coordinate): number {
    const lat1 = p1.lat * this.DEG2RAD;
    const lat2 = p2.lat * this.DEG2RAD;
    const dLat = (p2.lat - p1.lat) * this.DEG2RAD;
    const dLon = (p2.lng - p1.lng) * this.DEG2RAD;

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return this.R * c;
  }

  /**
   * 计算两点间的三维空间几何距离 (含高度差)
   */
  public static calculateSpatialDistance(p1: Coordinate, p2: Coordinate): {
    spatialDistance: number;
    horizontalDistance: number;
    heightDiff: number;
  } {
    const horizontalDistance = this.calculateGroundDistance(p1, p2);
    const alt1 = p1.alt ?? 0;
    const alt2 = p2.alt ?? 0;
    const heightDiff = alt2 - alt1;
    const spatialDistance = Math.sqrt(horizontalDistance * horizontalDistance + heightDiff * heightDiff);

    return {
      spatialDistance,
      horizontalDistance,
      heightDiff,
    };
  }

  /**
   * 计算折线连续航段的总地表距离 (米)
   */
  public static calculatePolylineDistance(points: Coordinate[]): number {
    if (points.length < 2) return 0;
    let sum = 0;
    for (let i = 1; i < points.length; i++) {
      sum += this.calculateGroundDistance(points[i - 1], points[i]);
    }
    return sum;
  }

  /**
   * 计算球面多边形面积 (基于球面过剩算法 / 球面三角积分)
   * 返回平方米 (m²)
   */
  public static calculatePolygonArea(ring: Coordinate[]): number {
    if (ring.length < 3) return 0;

    let totalAngle = 0;
    const len = ring.length;

    for (let i = 0; i < len; i++) {
      const p1 = ring[i];
      const p2 = ring[(i + 1) % len];
      const p3 = ring[(i + 2) % len];

      // 球面角过剩求和
      const bearing1 = this.calculateBearing(p2, p1);
      const bearing2 = this.calculateBearing(p2, p3);
      let diff = bearing2 - bearing1;
      if (diff < 0) diff += 360;
      totalAngle += diff;
    }

    const excess = Math.abs(totalAngle - (len - 2) * 180);
    const area = (excess * this.DEG2RAD) * this.R * this.R;
    return Math.round(area);
  }

  private static calculateBearing(p1: Coordinate, p2: Coordinate): number {
    const lat1 = p1.lat * this.DEG2RAD;
    const lat2 = p2.lat * this.DEG2RAD;
    const dLon = (p2.lng - p1.lng) * this.DEG2RAD;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  }

  /**
   * 格式化输出距离文本 (自适应 m 与 km)
   */
  public static formatDistance(meters: number): string {
    if (meters >= 1000) {
      return `${(meters / 1000).toFixed(2)} km`;
    }
    return `${Math.round(meters)} m`;
  }

  /**
   * 格式化输出面积文本 (自适应 m² 与 km²)
   */
  public static formatArea(squareMeters: number): string {
    if (squareMeters >= 1000000) {
      return `${(squareMeters / 1000000).toFixed(2)} km²`;
    }
    return `${Math.round(squareMeters).toLocaleString()} m²`;
  }
}

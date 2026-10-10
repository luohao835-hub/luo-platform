import type { Coordinate } from '@/domain/geometry/Coordinate';

/**
 * 军标战术图形纯数学几何计算算法
 * 100% 纯 TypeScript，框架无关，严格符合六边形架构 Domain 层不变量约束
 */
export class MilitaryPlotAlgorithms {
  private static readonly DEG2RAD = Math.PI / 180;
  private static readonly RAD2DEG = 180 / Math.PI;

  /**
   * 计算两点间的方位角 (弧度)
   */
  public static getBearingRad(p1: Coordinate, p2: Coordinate): number {
    const lat1 = p1.lat * this.DEG2RAD;
    const lat2 = p2.lat * this.DEG2RAD;
    const dLon = (p2.lng - p1.lng) * this.DEG2RAD;

    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (Math.atan2(y, x) + 2 * Math.PI) % (2 * Math.PI);
  }

  /**
   * 从基准点沿指定方位角 (弧度) 和距离 (米) 推算目标经纬度
   */
  public static destination(start: Coordinate, distanceMeters: number, bearingRad: number): Coordinate {
    const R = 6378137; // 地球平均半径
    const δ = distanceMeters / R;
    const φ1 = start.lat * this.DEG2RAD;
    const λ1 = start.lng * this.DEG2RAD;

    const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(bearingRad));
    const λ2 = λ1 + Math.atan2(Math.sin(bearingRad) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));

    return {
      lng: λ2 * this.RAD2DEG,
      lat: φ2 * this.RAD2DEG,
      alt: start.alt,
    };
  }

  /**
   * 计算两点间的地表大圆距离 (米)
   */
  public static distance(p1: Coordinate, p2: Coordinate): number {
    const R = 6378137;
    const dLat = (p2.lat - p1.lat) * this.DEG2RAD;
    const dLon = (p2.lng - p1.lng) * this.DEG2RAD;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(p1.lat * this.DEG2RAD) * Math.cos(p2.lat * this.DEG2RAD) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * 1. 进攻方向粗直箭头 (Assault Attack Arrow)
   * 由起点 p1 与终点 p2 生成带箭翼与宽腰的进攻箭头闭合环多边形 (7 个顶点)
   */
  public static calculateAttackArrow(p1: Coordinate, p2: Coordinate): Coordinate[] {
    const totalDist = this.distance(p1, p2);
    if (totalDist < 10) return [p1, p2, p1];

    const bearing = this.getBearingRad(p1, p2);
    const headLength = totalDist * 0.28; // 箭头头部长度
    const headWidth = totalDist * 0.22;  // 箭头翅膀宽度
    const neckWidth = totalDist * 0.08;  // 箭身颈部宽度
    const tailWidth = totalDist * 0.12;  // 箭尾宽度

    const headBaseDist = totalDist - headLength;
    const neckBaseDist = totalDist - headLength * 0.95;

    // 计算各关键对称点
    const leftTail = this.destination(this.destination(p1, tailWidth / 2, bearing - Math.PI / 2), 0, bearing);
    const rightTail = this.destination(this.destination(p1, tailWidth / 2, bearing + Math.PI / 2), 0, bearing);

    const neckCenter = this.destination(p1, neckBaseDist, bearing);
    const leftNeck = this.destination(neckCenter, neckWidth / 2, bearing - Math.PI / 2);
    const rightNeck = this.destination(neckCenter, neckWidth / 2, bearing + Math.PI / 2);

    const headBaseCenter = this.destination(p1, headBaseDist, bearing);
    const leftHeadCorner = this.destination(headBaseCenter, headWidth / 2, bearing - Math.PI / 2);
    const rightHeadCorner = this.destination(headBaseCenter, headWidth / 2, bearing + Math.PI / 2);

    const arrowTip = p2;

    return [
      leftTail,
      leftNeck,
      leftHeadCorner,
      arrowTip,
      rightHeadCorner,
      rightNeck,
      rightTail,
      leftTail, // 封闭多边形
    ];
  }

  /**
   * 2. 钳击双箭头 (Double Clamp Attack Arrow)
   * 生成左右钳击两路合围的连续闭合单环多边形
   */
  public static calculateDoubleArrow(p1: Coordinate, p2: Coordinate): Coordinate[] {
    const totalDist = this.distance(p1, p2);
    if (totalDist < 10) return [p1, p2, p1];

    const bearing = this.getBearingRad(p1, p2);
    const spread = totalDist * 0.35;    // 左右两路夹角展开间距
    const headLen = totalDist * 0.26;   // 箭头长度
    const headWidth = totalDist * 0.18; // 箭头展开翼展
    const bodyWidth = totalDist * 0.08; // 箭身宽度

    // 1. 基座起点
    const baseLeft = this.destination(p1, bodyWidth, bearing - Math.PI / 2);
    const baseRight = this.destination(p1, bodyWidth, bearing + Math.PI / 2);

    // 2. 中继分叉点与中间V形结合槽
    const forkCenter = this.destination(p1, totalDist * 0.45, bearing);
    const forkV = this.destination(p1, totalDist * 0.55, bearing);

    // 3. 左翼突击顶点与右翼突击顶点
    const leftTip = this.destination(p2, spread, bearing - Math.PI / 2);
    const rightTip = this.destination(p2, spread, bearing + Math.PI / 2);

    // 4. 左翼箭头翼部展开点
    const leftBase = this.destination(leftTip, headLen, bearing + Math.PI);
    const leftWingOuter = this.destination(leftBase, headWidth / 2, bearing - Math.PI / 2);
    const leftWingInner = this.destination(leftBase, bodyWidth / 2, bearing + Math.PI / 2);

    // 5. 右翼箭头翼部展开点
    const rightBase = this.destination(rightTip, headLen, bearing + Math.PI);
    const rightWingOuter = this.destination(rightBase, headWidth / 2, bearing + Math.PI / 2);
    const rightWingInner = this.destination(rightBase, bodyWidth / 2, bearing - Math.PI / 2);

    return [
      baseLeft,
      this.destination(forkCenter, bodyWidth, bearing - Math.PI / 2),
      leftWingOuter,
      leftTip,
      leftWingInner,
      forkV,
      rightWingInner,
      rightTip,
      rightWingOuter,
      this.destination(forkCenter, bodyWidth, bearing + Math.PI / 2),
      baseRight,
      baseLeft, // 连续单环闭合
    ];
  }

  /**
   * 3. 雷达波束扇形视场 (Radar Beam Sector)
   * 根据圆心、视距半径、中心朝向角和波束张角计算扇形闭合面
   */
  public static calculateSector(
    center: Coordinate,
    radiusMeters: number,
    headingDeg: number,
    angleSpreadDeg: number,
    segmentCount = 36,
  ): Coordinate[] {
    const points: Coordinate[] = [center];
    const halfAngle = angleSpreadDeg / 2;
    const startAngle = (headingDeg - halfAngle) * this.DEG2RAD;
    const endAngle = (headingDeg + halfAngle) * this.DEG2RAD;
    const step = (endAngle - startAngle) / segmentCount;

    for (let i = 0; i <= segmentCount; i++) {
      const currentAngle = startAngle + step * i;
      points.push(this.destination(center, radiusMeters, currentAngle));
    }
    points.push(center); // 闭合回圆心
    return points;
  }
}

import type { Coordinate } from '@/domain/geometry/Coordinate';

/**
 * 战术图形几何类型
 */
export type DrawShapeType =
  | 'point'          // 战术点 (支持自定义图片图标)
  | 'line'           // 航线 / 攻击线
  | 'circle'         // 警戒圆 / 杀伤半径圆 / 空域圆柱体
  | 'rectangle'      // 侦察矩形空域
  | 'square'         // 正方形巡逻网格
  | 'polygon'        // 复杂多边形防区 / 立体空域
  | 'attack_arrow'   // 军规突击箭头 (粗直进攻方向箭头)
  | 'double_arrow'   // 军规钳击双箭头 (多路合围箭头)
  | 'sector';        // 雷达波束探测扇形区

/**
 * 战术图形视觉样式
 */
export interface GraphicStyle {
  strokeColor?: string;     // 描边颜色 (rgba 或 hex)
  strokeWidth?: number;     // 描边宽度
  fillColor?: string;       // 填充颜色 (rgba 或 hex)
  pointSize?: number;       // 点大小（像素）
  label?: string;           // 标注文本
  altitudeMode?: 'clampToGround' | 'relativeToGround' | 'absolute'; // 高程贴地/悬空模式
  iconUrl?: string;         // 自定义点图标 URL (例如 /icons/drone.png)
  iconScale?: number;       // 图标缩放比例 (默认 1)
  rotation?: number;        // 图标朝向角度 (单位：弧度)
}

/**
 * 战术图形领域模型属性
 */
export interface TacticalGraphicProps {
  id: string;
  name: string;
  shapeType: DrawShapeType;
  coordinates: Coordinate[]; // 关键坐标点集合（含高程 alt）
  radius?: number;           // 半径（米，仅圆形适用）
  height?: number;           // 基准海拔高度/底面高（米）
  extrudedHeight?: number;   // 3D 拉伸高度/立体厚度（米，用于空域管控体与三维柱体）
  style?: GraphicStyle;
  description?: string;
  createdAt?: number;
}

/**
 * 战术标绘图形领域实体 (TacticalGraphic)
 */
export class TacticalGraphic {
  public readonly id: string;
  public readonly name: string;
  public readonly shapeType: DrawShapeType;
  public readonly coordinates: Coordinate[];
  public readonly radius?: number;
  public readonly height?: number;
  public readonly extrudedHeight?: number;
  public readonly style: GraphicStyle;
  public readonly description?: string;
  public readonly createdAt: number;

  constructor(props: TacticalGraphicProps) {
    this.id = props.id || `graphic_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.name = props.name || `战术图元_${props.shapeType}`;
    this.shapeType = props.shapeType;
    this.coordinates = props.coordinates;
    this.radius = props.radius;
    this.height = props.height;
    this.extrudedHeight = props.extrudedHeight;
    this.style = props.style || {
      strokeColor: 'rgba(0, 229, 255, 0.9)',
      strokeWidth: 2,
      fillColor: 'rgba(0, 229, 255, 0.25)',
      pointSize: 6,
    };
    this.description = props.description;
    this.createdAt = props.createdAt || Date.now();

    this.validate();
  }

  /**
   * 业务不变量自校验
   */
  private validate(): void {
    if (!this.shapeType) {
      throw new Error('战术图元几何类型 (shapeType) 不能为空');
    }
    if (!this.coordinates || this.coordinates.length === 0) {
      throw new Error('战术图元必须包含至少一个坐标点');
    }
    if (this.shapeType === 'circle' && (this.radius == null || this.radius <= 0)) {
      throw new Error('圆形图元必须具有大于 0 的有效半径 (radius)');
    }
    if (this.shapeType === 'line' && this.coordinates.length < 2) {
      throw new Error('线状图元至少需要 2 个坐标点');
    }
    if ((this.shapeType === 'polygon' || this.shapeType === 'rectangle' || this.shapeType === 'square') && this.coordinates.length < 3) {
      throw new Error(`${this.shapeType} 封闭面至少需要 3 个坐标点`);
    }
    if (this.extrudedHeight != null && this.extrudedHeight < 0) {
      throw new Error('三维拉伸高度不能为负数');
    }
  }
}

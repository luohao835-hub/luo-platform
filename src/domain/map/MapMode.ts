/**
 * GIS 地图引擎运行模式
 * 使用 (string & {}) 技巧：既保留 '2D' | '3D' 的强类型提示与补全，
 * 又对未来新增的 GIS 引擎模式（如 2.5D、Simulation、Mapbox 等）开放扩展。
 */
export type MapMode = '2D' | '3D' | (string & {});

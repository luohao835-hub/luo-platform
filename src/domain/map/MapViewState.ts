import type { Coordinate } from '@/domain/geometry/Coordinate';
import type { MapMode } from '@/domain/map/MapMode';

export interface MapViewState {
  mode: MapMode;
  center: Coordinate;
  zoom: number;
  pitch?: number;
  heading?: number;
  cameraAltitude?: number;  // 视点/相机海拔高度 (米)
  groundElevation?: number; // 视口中心地表真实高程 (米)
}

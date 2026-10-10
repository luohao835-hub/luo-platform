import type { DualEngineMapPort } from '@/ports/map/DualEngineMapPort';
import { DroneTrajectory, type DroneTrajectoryProps } from '@/domain/track/DroneTrajectory';

export class LoadTrajectoryFromNetworkUseCase {
  private readonly mapPort: DualEngineMapPort;

  constructor(mapPort: DualEngineMapPort) {
    this.mapPort = mapPort;
  }

  async execute(
    url: string,
    overrides?: Partial<DroneTrajectoryProps>,
  ): Promise<DroneTrajectory> {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`加载网络飞机轨迹数据失败 [HTTP ${res.status}]: ${url}`);
    }
    const data = await res.json();
    const trajectory = DroneTrajectory.fromGeoJson(data, overrides);

    this.mapPort.loadDroneTrajectory(trajectory);
    return trajectory;
  }
}

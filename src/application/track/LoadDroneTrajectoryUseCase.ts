import type { DualEngineMapPort } from '@/ports/map/DualEngineMapPort';
import { DroneTrajectory, type DroneTrajectoryProps } from '@/domain/track/DroneTrajectory';

export class LoadDroneTrajectoryUseCase {
  private readonly mapPort: DualEngineMapPort;

  constructor(mapPort: DualEngineMapPort) {
    this.mapPort = mapPort;
  }

  execute(trajectoryOrProps: DroneTrajectory | DroneTrajectoryProps): DroneTrajectory {
    const trajectory =
      trajectoryOrProps instanceof DroneTrajectory
        ? trajectoryOrProps
        : new DroneTrajectory(trajectoryOrProps);

    this.mapPort.loadDroneTrajectory(trajectory);
    return trajectory;
  }
}

import type { DualEngineMapPort } from '@/ports/map/DualEngineMapPort';

export class ResetDroneTrackUseCase {
  private readonly mapPort: DualEngineMapPort;

  constructor(mapPort: DualEngineMapPort) {
    this.mapPort = mapPort;
  }

  execute(trajectoryId: string): void {
    this.mapPort.resetDroneTrack(trajectoryId);
  }
}

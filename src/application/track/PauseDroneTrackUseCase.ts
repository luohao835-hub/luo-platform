import type { DualEngineMapPort } from '@/ports/map/DualEngineMapPort';

export class PauseDroneTrackUseCase {
  private readonly mapPort: DualEngineMapPort;

  constructor(mapPort: DualEngineMapPort) {
    this.mapPort = mapPort;
  }

  execute(trajectoryId: string): void {
    this.mapPort.pauseDroneTrack(trajectoryId);
  }
}

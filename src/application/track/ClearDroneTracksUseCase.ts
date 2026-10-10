import type { DualEngineMapPort } from '@/ports/map/DualEngineMapPort';

export class ClearDroneTracksUseCase {
  private readonly mapPort: DualEngineMapPort;

  constructor(mapPort: DualEngineMapPort) {
    this.mapPort = mapPort;
  }

  execute(): void {
    this.mapPort.clearAllTrajectories();
  }
}

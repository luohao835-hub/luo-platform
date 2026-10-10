import type { DualEngineMapPort } from '@/ports/map/DualEngineMapPort';

export class StopManualDrawUseCase {
  private readonly mapPort: DualEngineMapPort;

  constructor(mapPort: DualEngineMapPort) {
    this.mapPort = mapPort;
  }

  execute(): void {
    this.mapPort.stopManualDraw();
  }
}

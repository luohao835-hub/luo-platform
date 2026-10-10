import type { DualEngineMapPort } from '@/ports/map/DualEngineMapPort';

export class ClearGraphicsUseCase {
  private readonly mapPort: DualEngineMapPort;

  constructor(mapPort: DualEngineMapPort) {
    this.mapPort = mapPort;
  }

  execute(id?: string): void {
    if (id) {
      this.mapPort.removeGraphic(id);
    } else {
      this.mapPort.clearAllGraphics();
    }
  }
}

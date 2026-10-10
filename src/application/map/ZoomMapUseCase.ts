import type { DualEngineMapPort } from '@/ports/map/DualEngineMapPort';

export class ZoomMapUseCase {
  private readonly mapPort: DualEngineMapPort;

  constructor(mapPort: DualEngineMapPort) {
    this.mapPort = mapPort;
  }

  zoomIn(): void {
    this.mapPort.zoomIn();
  }

  zoomOut(): void {
    this.mapPort.zoomOut();
  }
}

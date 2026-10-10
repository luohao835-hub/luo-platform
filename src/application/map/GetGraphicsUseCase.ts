import type { DualEngineMapPort } from '@/ports/map/DualEngineMapPort';
import type { TacticalGraphic } from '@/domain/geometry/TacticalGraphic';

export class GetGraphicsUseCase {
  private readonly mapPort: DualEngineMapPort;

  constructor(mapPort: DualEngineMapPort) {
    this.mapPort = mapPort;
  }

  execute(): TacticalGraphic[] {
    return this.mapPort.getAllGraphics();
  }
}

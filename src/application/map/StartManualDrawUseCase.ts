import type { DualEngineMapPort } from '@/ports/map/DualEngineMapPort';
import type { DrawShapeType, TacticalGraphic } from '@/domain/geometry/TacticalGraphic';

export class StartManualDrawUseCase {
  private readonly mapPort: DualEngineMapPort;

  constructor(mapPort: DualEngineMapPort) {
    this.mapPort = mapPort;
  }

  execute(shapeType: DrawShapeType, onComplete?: (graphic: TacticalGraphic) => void): void {
    this.mapPort.startManualDraw(shapeType, onComplete);
  }
}

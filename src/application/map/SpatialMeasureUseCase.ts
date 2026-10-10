import type { DualEngineMapPort } from '@/ports/map/DualEngineMapPort';
import type { SpatialMeasureResult } from '@/domain/geometry/SpatialCalculator';

export class SpatialMeasureUseCase {
  private readonly mapPort: DualEngineMapPort;

  constructor(mapPort: DualEngineMapPort) {
    this.mapPort = mapPort;
  }

  start(type: 'distance' | 'area', onUpdate?: (result: SpatialMeasureResult) => void): void {
    this.mapPort.startSpatialMeasure(type, onUpdate);
  }

  clear(): void {
    this.mapPort.clearSpatialMeasure();
  }
}

import type { DualEngineMapPort } from '@/ports/map/DualEngineMapPort';
import type { Coordinate } from '@/domain/geometry/Coordinate';

export class FlyToLocationUseCase {
  private readonly mapPort: DualEngineMapPort;

  constructor(mapPort: DualEngineMapPort) {
    this.mapPort = mapPort;
  }

  execute(coord: Coordinate, zoom?: number, durationMs?: number): void {
    this.mapPort.flyTo(coord, zoom, durationMs);
  }
}

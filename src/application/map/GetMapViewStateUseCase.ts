import type { DualEngineMapPort } from '@/ports/map/DualEngineMapPort';
import type { MapViewState } from '@/domain/map/MapViewState';

export class GetMapViewStateUseCase {
  private readonly mapPort: DualEngineMapPort;

  constructor(mapPort: DualEngineMapPort) {
    this.mapPort = mapPort;
  }

  execute(): MapViewState {
    return this.mapPort.getViewState();
  }
}

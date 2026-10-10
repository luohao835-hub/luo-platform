import type { DualEngineMapPort } from '@/ports/map/DualEngineMapPort';
import type { MapLayerType } from '@/domain/map/LayerType';

export class ToggleLayerVisibilityUseCase {
  private readonly mapPort: DualEngineMapPort;

  constructor(mapPort: DualEngineMapPort) {
    this.mapPort = mapPort;
  }

  execute(layer: MapLayerType, visible: boolean): void {
    this.mapPort.setLayerVisible(layer, visible);
  }

  getState(layer: MapLayerType): boolean {
    return this.mapPort.getLayerVisible(layer);
  }
}

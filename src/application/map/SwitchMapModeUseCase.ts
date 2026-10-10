import type { DualEngineMapPort } from '@/ports/map/DualEngineMapPort';
import type { MapMode } from '@/domain/map/MapMode';

export class SwitchMapModeUseCase {
  private readonly mapPort: DualEngineMapPort;

  constructor(mapPort: DualEngineMapPort) {
    this.mapPort = mapPort;
  }

  async execute(targetMode: MapMode): Promise<void> {
    await this.mapPort.switchMode(targetMode);
  }
}

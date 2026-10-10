import type { DualEngineMapPort } from '@/ports/map/DualEngineMapPort';
import type { MapInitOptions } from '@/ports/map/MapPort';

export class InitMapUseCase {
  private readonly mapPort: DualEngineMapPort;

  constructor(mapPort: DualEngineMapPort) {
    this.mapPort = mapPort;
  }

  async execute(
    container2D: HTMLElement,
    container3D: HTMLElement,
    options?: MapInitOptions,
  ): Promise<void> {
    await this.mapPort.init(container2D, container3D, options);
  }
}

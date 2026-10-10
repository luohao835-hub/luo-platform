import type { DualEngineMapPort } from '@/ports/map/DualEngineMapPort';
import { TacticalGraphic } from '@/domain/geometry/TacticalGraphic';
import type { TacticalGraphicProps } from '@/domain/geometry/TacticalGraphic';

export class DrawGraphicDataUseCase {
  private readonly mapPort: DualEngineMapPort;

  constructor(mapPort: DualEngineMapPort) {
    this.mapPort = mapPort;
  }

  execute(graphicOrProps: TacticalGraphic | TacticalGraphicProps): TacticalGraphic {
    const graphic =
      graphicOrProps instanceof TacticalGraphic
        ? graphicOrProps
        : new TacticalGraphic(graphicOrProps);

    this.mapPort.drawGraphic(graphic);
    return graphic;
  }

  executeBatch(list: Array<TacticalGraphic | TacticalGraphicProps>): TacticalGraphic[] {
    return list.map((item) => this.execute(item));
  }
}

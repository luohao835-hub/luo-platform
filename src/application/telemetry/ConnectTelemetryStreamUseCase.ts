import type { DualEngineMapPort } from '@/ports/map/DualEngineMapPort';
import type { SituationTelemetryPort } from '@/ports/websocket/SituationTelemetryPort';
import type { DroneTelemetryFrame } from '@/domain/telemetry/DroneTelemetryFrame';
import type { GeofenceBreachAlert } from '@/domain/geofence/GeofenceConflictDetector';
import type { CheckGeofenceBreachUseCase } from '@/application/geofence/CheckGeofenceBreachUseCase';

export class ConnectTelemetryStreamUseCase {
  private readonly telemetryPort: SituationTelemetryPort;
  private readonly mapPort: DualEngineMapPort;
  private readonly breachUseCase: CheckGeofenceBreachUseCase;

  constructor(
    telemetryPort: SituationTelemetryPort,
    mapPort: DualEngineMapPort,
    breachUseCase: CheckGeofenceBreachUseCase,
  ) {
    this.telemetryPort = telemetryPort;
    this.mapPort = mapPort;
    this.breachUseCase = breachUseCase;
  }

  async execute(
    wsUrl?: string,
    onTelemetry?: (frame: DroneTelemetryFrame) => void,
    onBreach?: (alerts: GeofenceBreachAlert[]) => void,
  ): Promise<() => void> {
    await this.telemetryPort.connect(wsUrl);

    const unsubscribe = this.telemetryPort.subscribe((frame) => {
      // 1. 同步更新地图上无人机机群当前实时位置
      this.mapPort.updateDroneLivePosition(frame);

      // 2. 实时执行电子围栏碰撞与越界检测
      const alerts = this.breachUseCase.execute(frame);
      if (alerts.length > 0 && onBreach) {
        onBreach(alerts);
      }

      if (onTelemetry) {
        onTelemetry(frame);
      }
    });

    return () => {
      unsubscribe();
      this.telemetryPort.disconnect();
    };
  }
}

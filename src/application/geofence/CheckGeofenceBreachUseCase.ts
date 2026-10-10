import type { DualEngineMapPort } from '@/ports/map/DualEngineMapPort';
import type { DroneTelemetryFrame } from '@/domain/telemetry/DroneTelemetryFrame';
import { GeofenceConflictDetector, type GeofenceBreachAlert } from '@/domain/geofence/GeofenceConflictDetector';

export class CheckGeofenceBreachUseCase {
  private readonly mapPort: DualEngineMapPort;

  constructor(mapPort: DualEngineMapPort) {
    this.mapPort = mapPort;
  }

  execute(frame: DroneTelemetryFrame): GeofenceBreachAlert[] {
    const graphics = this.mapPort.getAllGraphics();
    const alerts: GeofenceBreachAlert[] = [];

    for (const g of graphics) {
      const alert = GeofenceConflictDetector.checkBreach(
        frame.coordinate,
        frame.droneId,
        frame.callsign,
        g,
      );

      if (alert) {
        alerts.push(alert);
        // 触发围栏报警高亮
        this.mapPort.highlightGeofenceAlert(g.id, true);
      } else {
        this.mapPort.highlightGeofenceAlert(g.id, false);
      }
    }

    return alerts;
  }
}

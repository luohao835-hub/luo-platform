import type { DualEngineMapPort } from '@/ports/map/DualEngineMapPort';
import { MissionRoutePlan, type MissionRoutePlanProps, type RoutePlanWaypoint } from '@/domain/mission/MissionRoutePlan';

export class ManageRoutePlanUseCase {
  private readonly mapPort: DualEngineMapPort;

  constructor(mapPort: DualEngineMapPort) {
    this.mapPort = mapPort;
  }

  startPlanning(
    onWaypointChange?: (waypoints: RoutePlanWaypoint[]) => void,
    onComplete?: (waypoints: RoutePlanWaypoint[]) => void,
    taskType?: 'route' | 'area' | 'strike',
  ): void {
    this.mapPort.startRoutePlanning(onWaypointChange, onComplete, taskType);
  }

  stopPlanning(): void {
    this.mapPort.stopRoutePlanning();
  }

  renderPlan(planOrProps: MissionRoutePlan | MissionRoutePlanProps): MissionRoutePlan {
    const plan = planOrProps instanceof MissionRoutePlan ? planOrProps : new MissionRoutePlan(planOrProps);
    this.mapPort.renderRoutePlan(plan);
    return plan;
  }

  clearPlan(): void {
    this.mapPort.clearRoutePlan();
  }
}

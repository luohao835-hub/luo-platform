import type { TaskRepositoryPort } from '@/ports/repositories/TaskRepositoryPort';
import type { ReconnaissanceSubTask } from '@/domain/task/ReconnaissanceSubTask';
import type { MissionRoutePlan } from '@/domain/mission/MissionRoutePlan';

export class CommitMissionRouteUseCase {
  private readonly taskRepo: TaskRepositoryPort;

  constructor(taskRepo: TaskRepositoryPort) {
    this.taskRepo = taskRepo;
  }

  async execute(plan: MissionRoutePlan): Promise<ReconnaissanceSubTask> {
    const task = plan.toReconnaissanceSubTask();
    return await this.taskRepo.create(task);
  }
}

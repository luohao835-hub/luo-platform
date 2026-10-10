import { ReconnaissanceSubTask } from '@/domain/task/ReconnaissanceSubTask';
import type { Coordinate } from '@/domain/geometry/Coordinate';
import type { TaskRepositoryPort } from '@/ports/repositories/TaskRepositoryPort';

export interface CreateReconnaissanceSubTaskCommand {
  name: string;
  targetId: string;
  area: Coordinate[];
}

export class CreateReconnaissanceSubTask {
  private readonly taskRepo: TaskRepositoryPort;

  constructor(taskRepo: TaskRepositoryPort) {
    this.taskRepo = taskRepo;
  }

  async execute(command: CreateReconnaissanceSubTaskCommand): Promise<ReconnaissanceSubTask> {
    const subTask = new ReconnaissanceSubTask({
      name: command.name,
      targetId: command.targetId,
      area: command.area,
    });

    return await this.taskRepo.create(subTask);
  }
}

import type { TaskRepositoryPort } from '@/ports/repositories/TaskRepositoryPort';
import type { ReconnaissanceSubTask } from '@/domain/task/ReconnaissanceSubTask';

export class GetReconnaissanceTasksUseCase {
  private readonly taskRepo: TaskRepositoryPort;

  constructor(taskRepo: TaskRepositoryPort) {
    this.taskRepo = taskRepo;
  }

  async execute(): Promise<ReconnaissanceSubTask[]> {
    return await this.taskRepo.findAll();
  }
}

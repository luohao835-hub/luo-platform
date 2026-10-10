import type { TaskRepositoryPort } from '@/ports/repositories/TaskRepositoryPort';

export class DeleteReconnaissanceTaskUseCase {
  private readonly taskRepo: TaskRepositoryPort;

  constructor(taskRepo: TaskRepositoryPort) {
    this.taskRepo = taskRepo;
  }

  async execute(taskId: string): Promise<boolean> {
    if (!taskId) {
      throw new Error('删除任务必须指定有效的任务 ID');
    }
    return await this.taskRepo.delete(taskId);
  }
}

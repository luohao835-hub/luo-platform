import type { ReconnaissanceSubTask } from '@/domain/task/ReconnaissanceSubTask';

export interface TaskRepositoryPort {
  create(task: ReconnaissanceSubTask): Promise<ReconnaissanceSubTask>;
  findById(id: string): Promise<ReconnaissanceSubTask | null>;
  listByMissionId(missionId: string): Promise<ReconnaissanceSubTask[]>;
  findAll(): Promise<ReconnaissanceSubTask[]>;
  delete(id: string): Promise<boolean>;
}

import type { AxiosInstance } from 'axios';
import type { TaskRepositoryPort } from '@/ports/repositories/TaskRepositoryPort';
import { ReconnaissanceSubTask } from '@/domain/task/ReconnaissanceSubTask';
import type { Coordinate } from '@/domain/geometry/Coordinate';

interface ApiResponse<T> {
  code?: number;
  data?: T;
  message?: string;
}

interface SubTaskDTO {
  id?: string;
  task_name: string;
  task_type?: 'route' | 'area' | 'strike';
  target_id: string;
  polygon_points: Coordinate[];
  task_status?: 'PENDING' | 'EXECUTING' | 'COMPLETED' | 'FAILED';
  created_at?: string;
}

export class HttpTaskRepository implements TaskRepositoryPort {
  private readonly http: AxiosInstance;

  constructor(http: AxiosInstance) {
    this.http = http;
  }

  async create(task: ReconnaissanceSubTask): Promise<ReconnaissanceSubTask> {
    const payload = {
      task_name: task.name,
      task_type: task.type,
      target_id: task.targetId,
      polygon_points: task.area,
    };

    const res = await this.http.post<ApiResponse<SubTaskDTO> | SubTaskDTO>('/api/v1/tasks/reconnaissance', payload);
    const rawData = res.data;
    // 兼容后端返回外层 { code: 200, data: { ... } } 或扁平结构
    const dto: SubTaskDTO = (rawData && typeof rawData === 'object' && 'data' in rawData && rawData.data)
      ? (rawData.data as SubTaskDTO)
      : (rawData as SubTaskDTO);

    return this.toDomain(dto);
  }

  async findById(id: string): Promise<ReconnaissanceSubTask | null> {
    const res = await this.http.get<ApiResponse<SubTaskDTO> | SubTaskDTO>(`/api/v1/tasks/reconnaissance/${id}`);
    const rawData = res.data;
    const dto: SubTaskDTO | null = (rawData && typeof rawData === 'object' && 'data' in rawData && rawData.data)
      ? (rawData.data as SubTaskDTO)
      : (rawData as SubTaskDTO | null);

    return dto ? this.toDomain(dto) : null;
  }

  async listByMissionId(missionId: string): Promise<ReconnaissanceSubTask[]> {
    const res = await this.http.get<ApiResponse<SubTaskDTO[]> | SubTaskDTO[]>(`/api/v1/missions/${missionId}/tasks`);
    const rawData = res.data;
    const list: SubTaskDTO[] = (rawData && typeof rawData === 'object' && 'data' in rawData && Array.isArray(rawData.data))
      ? rawData.data
      : (Array.isArray(rawData) ? rawData : []);

    return list.map((item) => this.toDomain(item));
  }

  async findAll(): Promise<ReconnaissanceSubTask[]> {
    const res = await this.http.get<ApiResponse<SubTaskDTO[]> | SubTaskDTO[]>('/api/v1/tasks/reconnaissance');
    const rawData = res.data;
    const list: SubTaskDTO[] = (rawData && typeof rawData === 'object' && 'data' in rawData && Array.isArray(rawData.data))
      ? rawData.data
      : (Array.isArray(rawData) ? rawData : []);

    return list.map((item) => this.toDomain(item));
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.http.delete<ApiResponse<unknown>>(`/api/v1/tasks/reconnaissance/${id}`);
    return res.status === 200;
  }

  private toDomain(dto: SubTaskDTO): ReconnaissanceSubTask {
    if (!dto) {
      throw new Error('服务端返回的侦察子任务数据为空');
    }
    return new ReconnaissanceSubTask({
      id: dto.id || `task_${Date.now()}`,
      name: dto.task_name,
      type: dto.task_type ?? 'route',
      targetId: dto.target_id,
      area: dto.polygon_points || [],
      status: dto.task_status ?? 'PENDING',
      createdAt: dto.created_at ? new Date(dto.created_at) : new Date(),
    });
  }
}

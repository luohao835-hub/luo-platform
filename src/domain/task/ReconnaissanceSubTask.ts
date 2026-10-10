import type { Coordinate } from '@/domain/geometry/Coordinate';

export type SubTaskStatus = 'PENDING' | 'EXECUTING' | 'COMPLETED' | 'FAILED';
export type MissionTaskType = 'route' | 'area' | 'strike';

export interface ReconnaissanceSubTaskProps {
  id?: string;
  name: string;
  type?: MissionTaskType;
  targetId: string;
  area: Coordinate[];
  status?: SubTaskStatus;
  createdAt?: Date;
}

export class ReconnaissanceSubTask {
  public readonly id?: string;
  public readonly name: string;
  public readonly type: MissionTaskType;
  public readonly targetId: string;
  public readonly area: Coordinate[];
  public status: SubTaskStatus;
  public readonly createdAt: Date;

  constructor(props: ReconnaissanceSubTaskProps) {
    this.id = props.id;
    this.name = props.name;
    this.type = props.type ?? 'route';
    this.targetId = props.targetId;
    this.area = props.area;
    this.status = props.status ?? 'PENDING';
    this.createdAt = props.createdAt ?? new Date();

    this.validate();
  }

  private validate(): void {
    if (!this.name || this.name.trim().length === 0) {
      throw new Error('侦察任务名称不能为空');
    }
    if (!this.targetId) {
      throw new Error('必须绑定侦察目标 ID');
    }
    if (!this.area || this.area.length < 3) {
      throw new Error('侦察区域至少需要 3 个坐标点构成闭合多边形');
    }
  }

  public startExecution(): void {
    if (this.status !== 'PENDING') {
      throw new Error(`当前任务状态为 ${this.status}，无法启动`);
    }
    this.status = 'EXECUTING';
  }
}

import { ref } from 'vue';
import { createReconnaissanceSubTaskUseCase } from '@/infrastructure/bootstrap/container';
import type { CreateReconnaissanceSubTaskCommand } from '@/application/task/CreateReconnaissanceSubTask';
import type { ReconnaissanceSubTask } from '@/domain/task/ReconnaissanceSubTask';

export function useCreateReconnaissanceSubTask() {
  const loading = ref(false);
  const error = ref<string | null>(null);

  const execute = async (
    command: CreateReconnaissanceSubTaskCommand,
  ): Promise<ReconnaissanceSubTask | null> => {
    loading.value = true;
    error.value = null;
    try {
      return await createReconnaissanceSubTaskUseCase.execute(command);
    } catch (err: unknown) {
      if (err instanceof Error) {
        error.value = err.message;
      } else {
        error.value = '创建任务失败';
      }
      return null;
    } finally {
      loading.value = false;
    }
  };

  return {
    loading,
    error,
    execute,
  };
}

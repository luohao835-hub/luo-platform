<script setup lang="ts">
import { reactive } from 'vue';
import { ElMessage } from 'element-plus';
import { useCreateReconnaissanceSubTask } from '@/presentation/composables/useCreateReconnaissanceSubTask';

const emit = defineEmits<{
  (e: 'success', taskId: string): void;
}>();

const { loading, execute } = useCreateReconnaissanceSubTask();

const form = reactive({
  name: '',
  targetId: 'target-001',
  area: [
    { lng: 116.39, lat: 39.9 },
    { lng: 116.4, lat: 39.9 },
    { lng: 116.4, lat: 39.91 },
  ],
});

const handleSubmit = async () => {
  const task = await execute(form);
  if (task?.id) {
    ElMessage.success(`子任务 [${task.name}] 创建成功！`);
    emit('success', task.id);
  }
};
</script>

<template>
  <el-form :model="form" label-width="100px">
    <el-form-item label="任务名称">
      <el-input v-model="form.name" placeholder="请输入侦察子任务名称" />
    </el-form-item>
    <el-form-item>
      <el-button type="primary" :loading="loading" @click="handleSubmit">
        创建侦察任务
      </el-button>
    </el-form-item>
  </el-form>
</template>

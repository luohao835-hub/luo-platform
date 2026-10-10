<script setup lang="ts">
import { ref } from 'vue';
import MapViewer from '@/presentation/components/MapViewer.vue';
import CreateSubTaskModal from '@/presentation/components/CreateSubTaskModal.vue';
import { appConfig } from '@/infrastructure/config/appConfig';
import { ElMessage } from 'element-plus';

const isSubTaskModalVisible = ref(false);

const handleSuccess = (taskId: string) => {
  ElMessage.success(`侦察子任务创建成功 [ID: ${taskId}]`);
  isSubTaskModalVisible.value = false;
};
</script>

<template>
  <div class="workbench-layout">
    <!-- 顶部综合指控导航条 -->
    <header class="workbench-header">
      <div class="header-left">
        <div class="platform-logo">🛡️</div>
        <div class="platform-title-group">
          <div class="title-with-badge">
            <h1 class="platform-title">{{ appConfig.appTitle.toUpperCase() }}</h1>
            <span class="version-tag">COP C2</span>
          </div>
          <span class="platform-subtitle">全球海空多维态势感知与实兵航线指控中心</span>
        </div>
      </div>

      <div class="header-right">
        <el-button
          type="primary"
          class="action-btn"
          @click="isSubTaskModalVisible = true"
        >
          ➕ 规划侦察子任务
        </el-button>
      </div>
    </header>

    <!-- 态势主屏：GIS 2D/3D 双引擎视口 -->
    <main class="workbench-body">
      <MapViewer />
    </main>

    <!-- 侦察子任务创建弹窗 (业务用例集成) -->
    <el-dialog
      v-model="isSubTaskModalVisible"
      title="创建侦察子任务 (业务用例演示)"
      width="520px"
      append-to-body
      destroy-on-close
    >
      <CreateSubTaskModal @success="handleSuccess" />
    </el-dialog>
  </div>
</template>

<style scoped>
.workbench-layout {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background-color: #060e18;
}

.workbench-header {
  height: 52px;
  background: rgba(13, 23, 37, 0.95);
  border-bottom: 1px solid rgba(0, 229, 255, 0.25);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  z-index: 20;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.platform-logo {
  font-size: 24px;
}

.platform-title-group {
  display: flex;
  flex-direction: column;
}

.title-with-badge {
  display: flex;
  align-items: center;
  gap: 8px;
}

.platform-title {
  margin: 0;
  font-size: 16px;
  font-weight: 700;
  letter-spacing: 1px;
  color: #00e5ff;
  text-shadow: 0 0 8px rgba(0, 229, 255, 0.4);
}

.version-tag {
  background: rgba(0, 229, 255, 0.15);
  border: 1px solid rgba(0, 229, 255, 0.35);
  color: #00e5ff;
  font-size: 10px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 3px;
  font-family: monospace;
}

.env-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 3px;
  letter-spacing: 0.5px;
}

.env-badge.development {
  background: rgba(0, 230, 118, 0.2);
  color: #00e676;
  border: 1px solid rgba(0, 230, 118, 0.4);
}

.env-badge.production {
  background: rgba(255, 61, 0, 0.2);
  color: #ff3d00;
  border: 1px solid rgba(255, 61, 0, 0.4);
}

.env-badge.staging {
  background: rgba(255, 171, 0, 0.2);
  color: #ffab00;
  border: 1px solid rgba(255, 171, 0, 0.4);
}

.platform-subtitle {
  font-size: 11px;
  color: #728ca8;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.action-btn {
  background: linear-gradient(135deg, #0077aa, #00b4d8);
  border: none;
  font-weight: 600;
  box-shadow: 0 0 10px rgba(0, 229, 255, 0.3);
}

.action-btn:hover {
  background: linear-gradient(135deg, #0099cc, #00d2f0);
}

.workbench-body {
  flex: 1;
  min-height: 0;
  position: relative;
}
</style>

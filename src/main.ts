import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import zhCn from 'element-plus/es/locale/lang/zh-cn';

// GIS 引擎原生样式引入
import 'ol/ol.css';
import 'cesium/Build/Cesium/Widgets/widgets.css';

import '@/styles/index.css';
import App from '@/App.vue';

// 配置 Cesium 资源基础路径
if (typeof window !== 'undefined') {
  (window as unknown as { CESIUM_BASE_URL: string }).CESIUM_BASE_URL = '/cesium/';
}

const app = createApp(App);

app.use(ElementPlus, {
  locale: zhCn,
});

app.mount('#app');

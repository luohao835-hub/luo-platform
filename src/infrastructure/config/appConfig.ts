export interface AppConfig {
  appTitle: string;
  appEnv: string;
  apiBaseUrl: string;
  httpServiceUrl: string;
  wsServiceUrl: string;
  mapServiceUrls: string[];
  terrainServiceUrl: string;
  cesiumIonToken: string;
}

const rawMapUrls = (import.meta.env.VITE_APP_MAP_SERVICE_URL || '')
  .split(',')
  .map((item: string) => item.trim())
  .filter(Boolean);

// 若未显式配置地形服务，尝试根据本地瓦片切片服务推断 /terrain 路径
const fallbackTerrainUrl = rawMapUrls.find((u: string) => u.includes('8092'))
  ? 'http://127.0.0.1:8092/terrain'
  : '';

export const appConfig: AppConfig = {
  appTitle: import.meta.env.VITE_APP_TITLE || 'luo-platform',
  appEnv: import.meta.env.VITE_APP_ENV || 'development',
  apiBaseUrl: import.meta.env.VITE_APP_BASE_API || '/dev-api',
  httpServiceUrl: import.meta.env.VITE_APP_HTTP_SERVICE_URL || '',
  wsServiceUrl: import.meta.env.VITE_APP_WS_SERVICE_URL || '',
  mapServiceUrls: rawMapUrls,
  terrainServiceUrl: import.meta.env.VITE_APP_TERRAIN_SERVICE_URL || fallbackTerrainUrl,
  cesiumIonToken: import.meta.env.VITE_APP_CESIUM_ION_TOKEN || '',
};

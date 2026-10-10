import axios from 'axios';
import { appConfig } from '@/infrastructure/config/appConfig';
import { HttpTaskRepository } from '@/adapters/http/HttpTaskRepository';
import { CreateReconnaissanceSubTask } from '@/application/task/CreateReconnaissanceSubTask';
import { GetReconnaissanceTasksUseCase } from '@/application/task/GetReconnaissanceTasksUseCase';
import { DeleteReconnaissanceTaskUseCase } from '@/application/task/DeleteReconnaissanceTaskUseCase';
import { OpenLayersMapAdapter } from '@/adapters/map/openlayers/OpenLayersMapAdapter';
import { CesiumMapAdapter } from '@/adapters/map/cesium/CesiumMapAdapter';
import { DualEngineMapAdapter } from '@/adapters/map/DualEngineMapAdapter';
import { InitMapUseCase } from '@/application/map/InitMapUseCase';
import { SwitchMapModeUseCase } from '@/application/map/SwitchMapModeUseCase';
import { FlyToLocationUseCase } from '@/application/map/FlyToLocationUseCase';
import { ZoomMapUseCase } from '@/application/map/ZoomMapUseCase';
import { GetMapViewStateUseCase } from '@/application/map/GetMapViewStateUseCase';
import { StartManualDrawUseCase } from '@/application/map/StartManualDrawUseCase';
import { StopManualDrawUseCase } from '@/application/map/StopManualDrawUseCase';
import { DrawGraphicDataUseCase } from '@/application/map/DrawGraphicDataUseCase';
import { ClearGraphicsUseCase } from '@/application/map/ClearGraphicsUseCase';
import { GetGraphicsUseCase } from '@/application/map/GetGraphicsUseCase';
import { LoadDroneTrajectoryUseCase } from '@/application/track/LoadDroneTrajectoryUseCase';
import { StartDroneTrackUseCase } from '@/application/track/StartDroneTrackUseCase';
import { PauseDroneTrackUseCase } from '@/application/track/PauseDroneTrackUseCase';
import { ResetDroneTrackUseCase } from '@/application/track/ResetDroneTrackUseCase';
import { ClearDroneTracksUseCase } from '@/application/track/ClearDroneTracksUseCase';
import { ToggleLayerVisibilityUseCase } from '@/application/map/ToggleLayerVisibilityUseCase';
import { LoadTrajectoryFromNetworkUseCase } from '@/application/track/LoadTrajectoryFromNetworkUseCase';
import { SpatialMeasureUseCase } from '@/application/map/SpatialMeasureUseCase';
import { ManageRoutePlanUseCase } from '@/application/mission/ManageRoutePlanUseCase';
import { CommitMissionRouteUseCase } from '@/application/mission/CommitMissionRouteUseCase';
import { WebSocketSituationClient } from '@/infrastructure/websocket/WebSocketSituationClient';
import { WebSocketSituationAdapter } from '@/adapters/websocket/WebSocketSituationAdapter';
import { CheckGeofenceBreachUseCase } from '@/application/geofence/CheckGeofenceBreachUseCase';
import { ConnectTelemetryStreamUseCase } from '@/application/telemetry/ConnectTelemetryStreamUseCase';

const httpClient = axios.create({
  baseURL: appConfig.apiBaseUrl,
  timeout: 10000,
});

export const taskRepository = new HttpTaskRepository(httpClient);
export const createReconnaissanceSubTaskUseCase = new CreateReconnaissanceSubTask(taskRepository);
export const getReconnaissanceTasksUseCase = new GetReconnaissanceTasksUseCase(taskRepository);
export const deleteReconnaissanceTaskUseCase = new DeleteReconnaissanceTaskUseCase(taskRepository);

// GIS 引擎适配器及多引擎调度器装配（基于注册表模式，可灵活扩展更多 GIS 渲染库）
export const openLayersAdapter = new OpenLayersMapAdapter(appConfig.mapServiceUrls);
export const cesiumAdapter = new CesiumMapAdapter(
  appConfig.mapServiceUrls,
  appConfig.terrainServiceUrl,
  appConfig.cesiumIonToken,
);
// 地图引擎挂载
export const dualEngineMapAdapter = new DualEngineMapAdapter([
  openLayersAdapter,
  cesiumAdapter,
]);
export const initMapUseCase = new InitMapUseCase(dualEngineMapAdapter);
export const switchMapModeUseCase = new SwitchMapModeUseCase(dualEngineMapAdapter);
export const flyToLocationUseCase = new FlyToLocationUseCase(dualEngineMapAdapter);
export const zoomMapUseCase = new ZoomMapUseCase(dualEngineMapAdapter);
export const getMapViewStateUseCase = new GetMapViewStateUseCase(dualEngineMapAdapter);

// 战术几何标绘用例组装
export const startManualDrawUseCase = new StartManualDrawUseCase(dualEngineMapAdapter);
export const stopManualDrawUseCase = new StopManualDrawUseCase(dualEngineMapAdapter);
export const drawGraphicDataUseCase = new DrawGraphicDataUseCase(dualEngineMapAdapter);
export const clearGraphicsUseCase = new ClearGraphicsUseCase(dualEngineMapAdapter);
export const getGraphicsUseCase = new GetGraphicsUseCase(dualEngineMapAdapter);

// 无人机轨迹运动与推演用例组装
export const loadDroneTrajectoryUseCase = new LoadDroneTrajectoryUseCase(dualEngineMapAdapter);
export const startDroneTrackUseCase = new StartDroneTrackUseCase(dualEngineMapAdapter);
export const pauseDroneTrackUseCase = new PauseDroneTrackUseCase(dualEngineMapAdapter);
export const resetDroneTrackUseCase = new ResetDroneTrackUseCase(dualEngineMapAdapter);
export const clearDroneTracksUseCase = new ClearDroneTracksUseCase(dualEngineMapAdapter);

// 物理分层与网络航线仿真用例
export const toggleLayerVisibilityUseCase = new ToggleLayerVisibilityUseCase(dualEngineMapAdapter);
export const loadTrajectoryFromNetworkUseCase = new LoadTrajectoryFromNetworkUseCase(dualEngineMapAdapter);

// 空间分析与战术量测用例
export const spatialMeasureUseCase = new SpatialMeasureUseCase(dualEngineMapAdapter);

// 交互式航线任务规划与业务闭环用例
export const manageRoutePlanUseCase = new ManageRoutePlanUseCase(dualEngineMapAdapter);
export const commitMissionRouteUseCase = new CommitMissionRouteUseCase(taskRepository);

// 实时 WebSocket 遥测链路与电子围栏冲突检测
const wsSituationClient = new WebSocketSituationClient();
export const webSocketSituationAdapter = new WebSocketSituationAdapter(wsSituationClient);
export const checkGeofenceBreachUseCase = new CheckGeofenceBreachUseCase(dualEngineMapAdapter);
export const connectTelemetryStreamUseCase = new ConnectTelemetryStreamUseCase(
  webSocketSituationAdapter,
  dualEngineMapAdapter,
  checkGeofenceBreachUseCase,
);

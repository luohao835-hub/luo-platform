import type { DroneTelemetryFrame } from '@/domain/telemetry/DroneTelemetryFrame';

export type TelemetryConnectionState = 'connecting' | 'connected' | 'disconnected';

export interface SituationTelemetryPort {
  connect(url?: string): Promise<void>;
  disconnect(): void;
  getConnectionState(): TelemetryConnectionState;
  subscribe(callback: (frame: DroneTelemetryFrame) => void): () => void;
  subscribeBatch(callback: (frames: DroneTelemetryFrame[]) => void): () => void;
  sendViewportFilter(minLng: number, minLat: number, maxLng: number, maxLat: number): void;
  sendCategoryFilter(category: string): void;
}

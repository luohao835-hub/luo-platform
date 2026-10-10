import type { SituationTelemetryPort, TelemetryConnectionState } from '@/ports/websocket/SituationTelemetryPort';
import { DroneTelemetryFrame, type DroneTelemetryProps } from '@/domain/telemetry/DroneTelemetryFrame';
import { WebSocketSituationClient } from '@/infrastructure/websocket/WebSocketSituationClient';

export class WebSocketSituationAdapter implements SituationTelemetryPort {
  private readonly client: WebSocketSituationClient;

  constructor(client: WebSocketSituationClient) {
    this.client = client;
  }

  async connect(url?: string): Promise<void> {
    await this.client.connect(url);
  }

  disconnect(): void {
    this.client.disconnect();
  }

  getConnectionState(): TelemetryConnectionState {
    return this.client.getState();
  }

  subscribe(callback: (frame: DroneTelemetryFrame) => void): () => void {
    return this.client.subscribe((rawProps: DroneTelemetryProps) => {
      try {
        const frame = new DroneTelemetryFrame(rawProps);
        callback(frame);
      } catch (err) {
        console.warn('[WebSocketSituationAdapter] 遥测报文解析失败:', err);
      }
    });
  }

  subscribeBatch(callback: (frames: DroneTelemetryFrame[]) => void): () => void {
    return this.client.subscribeBatch((rawList: DroneTelemetryProps[]) => {
      const frames: DroneTelemetryFrame[] = [];
      for (const p of rawList) {
        try {
          frames.push(new DroneTelemetryFrame(p));
        } catch {
          // 忽略非法单体
        }
      }
      callback(frames);
    });
  }

  sendViewportFilter(minLng: number, minLat: number, maxLng: number, maxLat: number): void {
    this.client.sendBBox(minLng, minLat, maxLng, maxLat);
  }

  sendCategoryFilter(category: string): void {
    this.client.sendCategoryFilter(category);
  }
}

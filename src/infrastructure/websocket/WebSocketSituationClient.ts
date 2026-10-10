import type { DroneTelemetryProps } from '@/domain/telemetry/DroneTelemetryFrame';

export class WebSocketSituationClient {
  private ws: WebSocket | null = null;
  private isManualClose = false;
  private reconnectTimer: number | null = null;
  private currentUrl = 'ws://localhost:10086/ws/situation';
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 3; // 最多自动重试 3 次，避免无限报错刷屏
  private listeners: Set<(data: DroneTelemetryProps) => void> = new Set();
  private batchListeners: Set<(data: DroneTelemetryProps[]) => void> = new Set();
  private connectionState: 'connecting' | 'connected' | 'disconnected' = 'disconnected';

  public connect(url?: string): Promise<void> {
    this.isManualClose = false;
    this.connectionState = 'connecting';
    if (url) {
      this.currentUrl = url;
    }

    return new Promise((resolve) => {
      try {
        this.ws = new WebSocket(this.currentUrl);

        this.ws.onopen = () => {
          this.connectionState = 'connected';
          this.reconnectAttempts = 0; // 连接成功，重置计数
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data);
            if (payload.type === 'situation_update' && Array.isArray(payload.targets)) {
              // 批量触发
              this.batchListeners.forEach((fn) => fn(payload.targets));
              // 单体分发
              payload.targets.forEach((target: DroneTelemetryProps) => {
                this.broadcast(target);
              });
            } else if (payload.id || payload.droneId) {
              this.broadcast(payload);
            }
          } catch {
            // 忽略格式不符的数据
          }
        };

        this.ws.onerror = () => {
          this.connectionState = 'disconnected';
          this.scheduleReconnect();
          resolve();
        };

        this.ws.onclose = () => {
          this.connectionState = 'disconnected';
          if (!this.isManualClose) {
            this.scheduleReconnect();
          }
        };
      } catch {
        this.connectionState = 'disconnected';
        this.scheduleReconnect();
        resolve();
      }
    });
  }

  public disconnect(): void {
    this.isManualClose = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.connectionState = 'disconnected';
  }

  public subscribe(callback: (data: DroneTelemetryProps) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  public subscribeBatch(callback: (data: DroneTelemetryProps[]) => void): () => void {
    this.batchListeners.add(callback);
    return () => this.batchListeners.delete(callback);
  }

  public getState(): 'connecting' | 'connected' | 'disconnected' {
    return this.connectionState;
  }

  /**
   * 向 Go 后端发送视口过滤订阅消息
   */
  public sendBBox(minLng: number, minLat: number, maxLng: number, maxLat: number): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          action: 'set_bbox',
          bbox: { minLng, minLat, maxLng, maxLat },
        }),
      );
    }
  }

  /**
   * 向 Go 后端发送目标分类过滤 (all / aviation / maritime)
   */
  public sendCategoryFilter(category: string): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          action: 'set_filter',
          category,
        }),
      );
    }
  }

  private broadcast(data: DroneTelemetryProps): void {
    this.listeners.forEach((listener) => {
      try {
        listener(data);
      } catch (err) {
        console.error('[WebSocketSituationClient] 消息分发异常:', err);
      }
    });
  }

  private scheduleReconnect(): void {
    if (this.isManualClose || this.reconnectTimer) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn(
        `[WebSocketSituationClient] 已暂停自动重连 (已重试 ${this.maxReconnectAttempts} 次)。请确认 Go 后端服务是否已启动 (终端执行: npm run server:run)。`,
      );
      return;
    }

    this.reconnectAttempts++;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.isManualClose) {
        this.connect(this.currentUrl);
      }
    }, 3000);
  }
}

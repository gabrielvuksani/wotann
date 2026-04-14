declare module "ws" {
  export default class WebSocket {
    constructor(url: string);
    readonly readyState: number;
    send(data: string): void;
    close(): void;
    on(event: string, listener: (...args: unknown[]) => void): void;
  }

  export class WebSocketServer {
    constructor(options: { server: import("node:http").Server });
    on(event: string, listener: (...args: unknown[]) => void): void;
    close(): void;
  }
}

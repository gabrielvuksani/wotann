/**
 * Signal channel adapter using signal-cli as a subprocess.
 * signal-cli provides a JSON-RPC interface for sending/receiving Signal messages.
 * Requires: signal-cli installed and registered with a phone number.
 */

import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import type { ChannelAdapter, ChannelMessage, ChannelType } from "./gateway.js";

export interface SignalConfig {
  readonly phoneNumber: string;
  readonly signalCliBin: string;
  readonly configDir: string;
}

const DEFAULT_SIGNAL_CONFIG: SignalConfig = {
  phoneNumber: "",
  signalCliBin: "signal-cli",
  configDir: ".wotann/signal-data",
};

export class SignalAdapter implements ChannelAdapter {
  readonly type: ChannelType = "signal";
  readonly name = "Signal (signal-cli)";
  connected = false;
  private readonly signalConfig: SignalConfig;
  private messageHandlers: Array<(message: ChannelMessage) => void> = [];
  private daemonProcess: ChildProcess | null = null;

  constructor(config?: Partial<SignalConfig>) {
    this.signalConfig = { ...DEFAULT_SIGNAL_CONFIG, ...config };
  }

  async connect(): Promise<boolean> {
    if (!this.signalConfig.phoneNumber) {
      console.warn("[Signal] Phone number not configured. Set signal config in .wotann/config.yaml.");
      return false;
    }

    try {
      // Start signal-cli in JSON-RPC daemon mode
      this.daemonProcess = spawn(this.signalConfig.signalCliBin, [
        "-u", this.signalConfig.phoneNumber,
        "--config", this.signalConfig.configDir,
        "jsonRpc",
      ], { stdio: ["pipe", "pipe", "pipe"] });

      let buffer = "";
      this.daemonProcess.stdout?.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf8");
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line) as {
              method?: string;
              params?: {
                envelope?: {
                  source?: string;
                  sourceName?: string;
                  timestamp?: number;
                  dataMessage?: { message?: string; groupInfo?: { groupId?: string } };
                };
              };
            };

            if (event.method === "receive" && event.params?.envelope?.dataMessage?.message) {
              const env = event.params.envelope;
              const msg: ChannelMessage = {
                id: randomUUID(),
                channelType: "signal",
                channelId: env.dataMessage?.groupInfo?.groupId ?? env.source ?? "",
                senderId: env.source ?? "",
                senderName: env.sourceName,
                content: env.dataMessage?.message ?? "",
                timestamp: env.timestamp ?? Date.now(),
              };

              for (const handler of this.messageHandlers) {
                handler(msg);
              }
            }
          } catch {
            // Skip malformed JSON lines
          }
        }
      });

      this.daemonProcess.on("exit", () => {
        this.connected = false;
      });

      // Wait a moment for the daemon to start
      await new Promise((r) => setTimeout(r, 1000));
      this.connected = true;
      return true;
    } catch {
      return false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.daemonProcess) {
      this.daemonProcess.kill("SIGTERM");
      this.daemonProcess = null;
    }
    this.connected = false;
  }

  async send(channelId: string, content: string, _replyTo?: string): Promise<boolean> {
    if (!this.daemonProcess?.stdin) return false;
    try {
      const rpcRequest = JSON.stringify({
        jsonrpc: "2.0",
        method: "send",
        id: randomUUID(),
        params: {
          recipient: [channelId],
          message: content,
        },
      });
      this.daemonProcess.stdin.write(rpcRequest + "\n");
      return true;
    } catch {
      return false;
    }
  }

  onMessage(handler: (message: ChannelMessage) => void): void {
    this.messageHandlers.push(handler);
  }
}

/**
 * Type stubs for optional runtime dependencies that may not be installed.
 * These modules are dynamically imported with `.catch(() => null)` guards.
 */
declare module "nodemailer" {
  export function createTransport(options: Record<string, unknown>): unknown;
}

declare module "imap" {
  class Imap {
    constructor(options: Record<string, unknown>);
    once(event: string, handler: (...args: unknown[]) => void): void;
    on(event: string, handler: (...args: unknown[]) => void): void;
    openBox(name: string, readOnly: boolean, callback: (err: Error | null) => void): void;
    search(criteria: unknown[], callback: (err: Error | null, uids: number[]) => void): void;
    fetch(uids: number[], options: Record<string, unknown>): {
      on: (event: string, handler: (...args: any[]) => void) => void;
      once: (event: string, handler: (...args: any[]) => void) => void;
    };
    end(): void;
    connect(): void;
  }
  export default Imap;
}

declare module "@whiskeysockets/baileys" {
  function makeWASocket(options: Record<string, unknown>): unknown;
  function useMultiFileAuthState(path: string): Promise<{ state: unknown; saveCreds: () => void }>;
  const DisconnectReason: Record<string, number>;
  export default makeWASocket;
  export { useMultiFileAuthState, DisconnectReason };
}

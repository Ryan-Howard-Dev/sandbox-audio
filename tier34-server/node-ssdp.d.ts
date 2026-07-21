declare module 'node-ssdp' {
  import { EventEmitter } from 'node:events';

  export type SsdpServerOptions = {
    udn?: string;
    location?: string | (() => string);
    adInterval?: number;
    ttl?: number;
    ssdpSig?: string;
    explicitSocketBind?: boolean;
    sourcePort?: number;
    suppressRootDeviceAdvertisements?: boolean;
  };

  export class Client extends EventEmitter {
    constructor(opts?: Record<string, unknown>);
    search(service: string): void;
    stop(): void;
    on(
      event: 'response',
      listener: (
        headers: Record<string, string>,
        statusCode: number,
        rinfo: { address: string },
      ) => void,
    ): this;
  }

  export class Server extends EventEmitter {
    constructor(opts?: SsdpServerOptions);
    addUSN(device: string): void;
    start(cb?: (err?: Error) => void): Promise<void>;
    stop(): void;
    advertise(alive?: boolean): void;
    on(event: 'advertise-alive', listener: (headers: Record<string, string>) => void): this;
    on(event: 'advertise-bye', listener: (headers: Record<string, string>) => void): this;
  }
}

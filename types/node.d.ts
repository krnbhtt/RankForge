declare namespace NodeJS {
  interface ProcessEnv {
    [key: string]: string | undefined;
  }
  interface Process {
    env: ProcessEnv;
    cwd(): string;
    uptime(): number;
    exit(code?: number): never;
    argv: string[];
  }
  interface Timeout {}
}

declare var process: NodeJS.Process;

declare function setTimeout(callback: (...args: any[]) => void, ms?: number, ...args: any[]): NodeJS.Timeout;
declare function clearTimeout(timeoutId: NodeJS.Timeout): void;

declare class Buffer {
  static from(data: any, encoding?: string): Buffer;
  static isBuffer(obj: any): boolean;
  toString(encoding?: string): string;
}

declare module 'fs' {
  export interface Stats {
    isFile(): boolean;
    isDirectory(): boolean;
    size: number;
  }
  export interface FSWatcher {
    close(): void;
  }
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): string | undefined;
  export function readFileSync(path: string, encoding: string): string;
  export function writeFileSync(path: string, data: string, encoding: string): void;
  export function watch(
    filename: string,
    listener?: (event: string, filename: string) => void
  ): FSWatcher;
  export namespace promises {
    export function readFile(path: string, encoding: string): Promise<string>;
    export function writeFile(path: string, data: string, encoding: string): Promise<void>;
    export function rename(oldPath: string, newPath: string): Promise<void>;
    export function mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;
    export function stat(path: string): Promise<Stats>;
  }
}

declare module 'path' {
  export function resolve(...pathSegments: string[]): string;
  export function join(...paths: string[]): string;
  export function dirname(p: string): string;
  export function basename(p: string, ext?: string): string;
  export function extname(p: string): string;
}

declare module 'events' {
  export class EventEmitter {
    on(event: string, listener: (...args: any[]) => void): this;
    once(event: string, listener: (...args: any[]) => void): this;
    off(event: string, listener: (...args: any[]) => void): this;
    emit(event: string, ...args: any[]): boolean;
  }
}

declare module 'dns' {
  export namespace promises {
    export function lookup(hostname: string): Promise<{ address: string; family: number }>;
  }
}

declare module 'http' {
  export interface IncomingMessage {
    headers: Record<string, string | string[] | undefined>;
    method?: string;
    url?: string;
  }
  export interface ServerResponse {
    writeHead(statusCode: number, headers?: Record<string, string | number>): this;
    end(data?: any): this;
    write(chunk: any): boolean;
  }
  export interface Server {
    close(callback?: (err?: Error) => void): this;
  }
}

declare module 'express' {
  import * as http from 'http';

  export interface Request extends http.IncomingMessage {
    body: any;
    params: Record<string, string>;
    query: Record<string, any>;
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
  }

  export interface Response extends http.ServerResponse {
    status(code: number): this;
    json(body: any): this;
    send(body: any): this;
  }

  export type NextFunction = (err?: any) => void;
  export type RequestHandler = (req: Request, res: Response, next: NextFunction) => any;

  export interface RouterInstance {
    use(...handlers: any[]): this;
    get(path: string, ...handlers: RequestHandler[]): this;
    post(path: string, ...handlers: RequestHandler[]): this;
    put(path: string, ...handlers: RequestHandler[]): this;
    delete(path: string, ...handlers: RequestHandler[]): this;
  }

  export function Router(): RouterInstance;

  export interface ExpressApp extends RouterInstance {
    listen(port: number, host?: string, callback?: () => void): http.Server;
  }

  function express(): ExpressApp;
  namespace express {
    export function json(): RequestHandler;
    export function urlencoded(options?: any): RequestHandler;
    export function Router(): RouterInstance;
  }

  export default express;
}

declare module 'cors' {
  import type { RequestHandler } from 'express';
  function cors(options?: any): RequestHandler;
  export default cors;
}

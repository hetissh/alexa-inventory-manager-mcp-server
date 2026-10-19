import { request } from 'node:http';

export interface HttpReply {
  readonly status: number;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: string;
}

/**
 * One plain HTTP request to 127.0.0.1, on its own connection. Unlike `fetch` it lets a test set the Host header
 * and send any method, and it never keeps a connection open that would stall a server shutdown.
 */
export function httpRequest(
  port: number,
  path: string,
  options: { readonly method?: string; readonly headers?: Readonly<Record<string, string>> } = {},
): Promise<HttpReply> {
  return new Promise((resolve, reject) => {
    const outgoing = request(
      { host: '127.0.0.1', port, path, method: options.method ?? 'GET', headers: options.headers, agent: false },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => {
          resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString('utf8') });
        });
      },
    );
    outgoing.on('error', reject);
    outgoing.end();
  });
}

export const jsonBody = (reply: HttpReply): Record<string, unknown> => JSON.parse(reply.body) as Record<string, unknown>;

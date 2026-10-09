import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { collectionInfo } from "./fake-qdrant.js";

export interface QdrantRequest {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

export interface QdrantReply {
  readonly status?: number;
  readonly result?: unknown;
}

export type QdrantRoute = (request: QdrantRequest) => QdrantReply | undefined;

export interface QdrantServer {
  readonly url: string;
  readonly requests: QdrantRequest[];
  close(): Promise<void>;
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : undefined;
}

/**
 * A Qdrant REST server on a free local port. Each route may answer a request;
 * unanswered requests get 404. The version probe at `GET /` always answers.
 */
export async function startQdrantServer(
  ...routes: QdrantRoute[]
): Promise<QdrantServer> {
  const requests: QdrantRequest[] = [];
  const server = createServer((req, res) => {
    void readBody(req).then((body) => {
      const request = { method: req.method!, path: req.url!, body };
      if (request.path === "/") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ title: "qdrant", version: "1.19.0" }));
        return;
      }
      requests.push(request);
      const reply = routes
        .map((route) => route(request))
        .find((answer) => answer !== undefined);
      res.writeHead(reply?.status ?? (reply ? 200 : 404), {
        "content-type": "application/json",
      });
      res.end(
        JSON.stringify({
          result: reply?.result ?? null,
          status: "ok",
          time: 0,
        }),
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

/** Lists `names` and describes each as a valid collection of `dims` vectors. */
export function validCollections(
  names: readonly string[],
  { dims = 2048, quantized = [] as readonly string[] } = {},
): QdrantRoute {
  return ({ method, path }) => {
    if (method !== "GET") return undefined;
    if (path === "/collections") {
      return { result: { collections: names.map((name) => ({ name })) } };
    }
    const name = decodeURIComponent(path.replace(/^\/collections\//, ""));
    if (path.startsWith("/collections/") && names.includes(name)) {
      return {
        result: collectionInfo({
          vectors: { size: dims, distance: "Cosine" },
          quantized: quantized.includes(name),
        }),
      };
    }
    return undefined;
  };
}

export function pointsRoute(
  action: "query" | "scroll",
  points: (body: unknown) => readonly unknown[],
): QdrantRoute {
  return ({ method, path, body }) => {
    if (method !== "POST" || !path.endsWith(`/points/${action}`)) {
      return undefined;
    }
    return action === "query"
      ? { result: { points: points(body) } }
      : { result: { points: points(body), next_page_offset: null } };
  };
}

import { contract } from "./support/env.js";
import { expectStatus, send, type Method } from "./support/http.js";

type RetiredRoute = { path: string; method: Method; python: number };

const retiredRoutes: RetiredRoute[] = [
  { path: "/docs", method: "GET", python: 200 },
  { path: "/docs", method: "HEAD", python: 200 },
  { path: "/docs/oauth2-redirect", method: "GET", python: 200 },
  { path: "/redoc", method: "GET", python: 200 },
  { path: "/redoc", method: "HEAD", python: 200 },
  { path: "/openapi.json", method: "GET", python: 200 },
  { path: "/openapi.json", method: "HEAD", python: 200 },
  { path: "/llms.txt", method: "GET", python: 404 },
];

const expected = (route: RetiredRoute) =>
  contract.target === "nest" ? 404 : route.python;

describe(`retired routes (target: ${contract.target})`, () => {
  it.each(retiredRoutes)("$method $path", async (route) => {
    const reply = await send(route.path, { method: route.method });
    expectStatus(reply, expected(route));
  });
});

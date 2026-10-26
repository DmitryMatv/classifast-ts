import { expectStatus, send, type Method } from "./support/http.js";

type RetiredRoute = { path: string; method: Method };

const retiredRoutes: RetiredRoute[] = [
  { path: "/docs", method: "GET" },
  { path: "/docs", method: "HEAD" },
  { path: "/docs/oauth2-redirect", method: "GET" },
  { path: "/redoc", method: "GET" },
  { path: "/redoc", method: "HEAD" },
  { path: "/openapi.json", method: "GET" },
  { path: "/openapi.json", method: "HEAD" },
  { path: "/llms.txt", method: "GET" },
];

// FastAPI served these; the classifier catch-all now answers them.
describe("retired routes", () => {
  it.each(retiredRoutes)("$method $path -> 404", async (route) => {
    const reply = await send(route.path, { method: route.method });
    expectStatus(reply, 404);
  });
});

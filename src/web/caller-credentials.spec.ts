import { parseCookies } from "./caller-credentials.js";

// Results of starlette.requests.cookie_parser on each header.
describe("parseCookies", () => {
  it.each([
    ["a=1; b=2", { a: "1", b: "2" }],
    [
      "__session=tok; cf_track=abc; __session=later",
      { __session: "later", cf_track: "abc" },
    ],
    ['noequals; x = " y " ', { "": "noequals", x: " y " }],
    ['q="a\\"b\\101"', { q: 'a"bA' }],
    [" ; =v; k=", { "": "v", k: "" }],
    ['k=""', { k: "" }],
    ['k="x', { k: '"x' }],
    ["", {}],
  ])("parses %j", (header, cookies) => {
    expect(Object.fromEntries(parseCookies(header))).toEqual(cookies);
  });
});

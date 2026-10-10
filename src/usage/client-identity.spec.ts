import { clientIp, hashIp, trackingId } from "./client-identity.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("clientIp", () => {
  it("test_cloudflare_ip_takes_precedence", () => {
    const headers = {
      "cf-connecting-ip": "203.0.113.10",
      "x-forwarded-for": "198.51.100.5, 198.51.100.6",
    };

    expect(clientIp(headers, "127.0.0.1")).toBe("203.0.113.10");
  });

  it("test_forwarded_for_is_used_when_cloudflare_header_missing", () => {
    const headers = { "x-forwarded-for": "198.51.100.5, 198.51.100.6" };

    expect(clientIp(headers, "127.0.0.1")).toBe("198.51.100.5");
  });

  it("falls back to the socket peer, then to unknown", () => {
    expect(clientIp({}, "127.0.0.1")).toBe("127.0.0.1");
    expect(clientIp({}, undefined)).toBe("unknown");
  });

  it("reads the first of repeated headers", () => {
    const headers = { "cf-connecting-ip": ["203.0.113.10", "203.0.113.11"] };

    expect(clientIp(headers, undefined)).toBe("203.0.113.10");
  });
});

describe("hashIp", () => {
  it("matches Python's sha256 hex prefix", () => {
    expect(hashIp("203.0.113.10")).toBe("631f08140b24b727");
  });
});

describe("trackingId", () => {
  it("test_existing_tracking_cookie_is_reused", () => {
    const cookie = "1b4e28ba-2fa1-41d2-883f-0016d3cca427";

    expect(trackingId(cookie)).toBe(cookie);
  });

  it.each([
    "{1b4e28ba-2fa1-41d2-883f-0016d3cca427}",
    "urn:uuid:1b4e28ba-2fa1-41d2-883f-0016d3cca427",
    "1B4E28BA2FA141D2883F0016D3CCA427",
    "{{1b4e28ba-2fa1-41d2-883f-0016d3cca427}",
    "--1b4e28ba2fa141d2883f0016d3cca427-",
    " 1b4e28ba2fa141d2883f0016d3cca4\t",
    "+1b4e28ba2fa141d2883f0016d3cca42",
    "0x1b4e28ba2fa141d2883f0016d3cca4",
    "0x_1b4e28ba2fa141d2883f0016d3cca",
    "1b4e28ba_2fa141d2883f0016d3cca42",
    "\u00a01b4e28ba2fa141d2883f0016d3cca4\u0085",
    "\u06631b4e28ba2fa141d2883f0016d3cca42",
    "\u{1d7cf}1b4e28ba2fa141d2883f0016d3cca42",
  ])("keeps %j, which Python's uuid.UUID accepts, verbatim", (cookie) => {
    expect(trackingId(cookie)).toBe(cookie);
  });

  it.each([
    "not-a-uuid",
    "1b4e28ba-2fa1-41d2-883f",
    "1b4e28ba-2fa1-41d2-883f-0016d3cca42g",
    "_1b4e28ba2fa141d2883f0016d3cca42",
    "1b4e28ba2fa141d2883f0016d3cca42_",
    "1b4e28ba__2fa141d2883f0016d3cca4",
    "+ 1b4e28ba2fa141d2883f0016d3cca4",
    "\u001c1b4e28ba2fa141d2883f0016d3cca42",
    "\u200b1b4e28ba2fa141d2883f0016d3cca42",
    "\ufeff1b4e28ba2fa141d2883f0016d3cca42",
    "0o1b4e28ba2fa141d2883f0016d3cca4",
    "",
    undefined,
  ])("test_invalid_tracking_cookie_is_replaced (%j)", (cookie) => {
    const replacement = trackingId(cookie);

    expect(replacement).toMatch(UUID_PATTERN);
    expect(replacement).not.toBe(trackingId(cookie));
  });
});

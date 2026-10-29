import { beforeEach, describe, expect, it } from "vitest";
import {
  click,
  element,
  fakeServices,
  hydratePage,
  type FakeServices,
  press,
} from "../test/islands.js";
import { Island } from "../../../../src/web/islands/render-island.js";
import type { HeaderLinks } from "../../../../src/web/header/site-header.js";

const links: HeaderLinks = {
  home: "https://classifast.test/",
  mappingIndex: "https://classifast.test/mapping/",
  classifiers: {
    UNSPSC: "https://classifast.test/UNSPSC/",
    CPV: "https://classifast.test/CPV/",
  },
};

function menuState() {
  return {
    menu: element("#mobile-menu").classList.contains("active"),
    button: element("#mobile-menu-button").classList.contains("active"),
    expanded: element("#mobile-menu-button").getAttribute("aria-expanded"),
  };
}

const OPEN = { menu: true, button: true, expanded: "true" };
const CLOSED = { menu: false, button: false, expanded: "false" };

let services: FakeServices;

describe("header island, mapping variant", () => {
  beforeEach(async () => {
    services = fakeServices();
    const errors = await hydratePage(
      <>
        <Island
          name="header"
          as="header"
          className="bg-white border-b border-slate-200 relative"
          props={{ variant: "mapping", links, standards: null }}
        />
        <main>
          <p id="outside">Outside</p>
        </main>
      </>,
      services,
    );
    expect(errors).toEqual([]);
  });

  it("never starts auth", () => {
    expect(services.auth.calls).toEqual([]);
  });

  it("toggles the menu from the button", async () => {
    expect(menuState()).toEqual(CLOSED);
    await click(element("#mobile-menu-button"));
    expect(menuState()).toEqual(OPEN);
    await click(element("#mobile-menu-button span"));
    expect(menuState()).toEqual(CLOSED);
  });

  it("closes on Escape and returns focus to the button", async () => {
    await click(element("#mobile-menu-button"));
    await press("Escape");
    expect(menuState()).toEqual(CLOSED);
    expect(document.activeElement).toBe(element("#mobile-menu-button"));
  });

  it("ignores other keys", async () => {
    await click(element("#mobile-menu-button"));
    await press("Enter");
    expect(menuState()).toEqual(OPEN);
  });

  it("closes on an outside click but not on a click inside the menu", async () => {
    await click(element("#mobile-menu-button"));
    await click(element("#mobile-menu .menu-section-title"));
    expect(menuState()).toEqual(OPEN);
    await click(element("#outside"));
    expect(menuState()).toEqual(CLOSED);
  });

  it("closes when a menu link is followed", async () => {
    await click(element("#mobile-menu-button"));
    const chip = element("#mobile-menu a.menu-chip");
    chip.addEventListener("click", (event) => event.preventDefault());
    await click(chip);
    expect(menuState()).toEqual(CLOSED);
  });
});

describe("header island, mapping product variant", () => {
  it("hydrates the product's standards in the title and the desktop nav", async () => {
    const errors = await hydratePage(
      <Island
        name="header"
        as="header"
        props={{
          variant: "mapping",
          links,
          standards: {
            source: { name: "UNSPSC", url: links.classifiers["UNSPSC"]! },
            target: { name: "CPV", url: links.classifiers["CPV"]! },
          },
        }}
      />,
      fakeServices(),
    );
    expect(errors).toEqual([]);
    expect(element("header a > span").textContent).toBe("UNSPSC -> CPV");
    expect(
      [...document.querySelectorAll(".desktop-nav a")].map((a) =>
        a.getAttribute("href"),
      ),
    ).toEqual([
      "https://classifast.test/UNSPSC/",
      "https://classifast.test/CPV/",
    ]);
    await click(element("#mobile-menu-button"));
    expect(menuState()).toEqual(OPEN);
  });
});

describe("header island, home variant", () => {
  const HREF = "https://classifast.test/?from=home";

  beforeEach(async () => {
    services = fakeServices({ href: HREF });
    const errors = await hydratePage(
      <>
        <Island
          name="header"
          as="header"
          className="site-masthead"
          role="banner"
          props={{ variant: "home", links }}
        />
        <p id="outside">Outside</p>
      </>,
      services,
    );
    expect(errors).toEqual([]);
  });

  const slot = (name: "desktop" | "mobile") =>
    element(`#${name}-auth-container`);
  const controls = (name: "desktop" | "mobile") =>
    [...slot(name).children].map((child) => ({
      tag: child.tagName,
      text: child.textContent,
    }));
  const SIGNED_IN = {
    status: "signed-in",
    userId: "user_1",
    sessionUsable: true,
  } as const;

  it("starts auth and keeps both slots empty while it is pending", () => {
    expect(services.auth.calls).toEqual(["start"]);
    expect(slot("desktop").childElementCount).toBe(0);
    expect(slot("mobile").childElementCount).toBe(0);
  });

  it("offers Sign In and Sign Up on desktop and only Sign In on mobile when signed out", async () => {
    await services.auth.set({ status: "signed-out" });

    expect(controls("desktop")).toEqual([
      { tag: "BUTTON", text: "Sign In" },
      { tag: "BUTTON", text: "Sign Up" },
    ]);
    expect(controls("mobile")).toEqual([{ tag: "BUTTON", text: "Sign In" }]);
    expect(element("#clerk-sign-in-button-mobile").className).toBe(
      element("#clerk-sign-in-button-desktop").className,
    );
    for (const button of slot("desktop").querySelectorAll("button")) {
      expect(button.type).toBe("button");
    }

    await click(element("#clerk-sign-in-button-mobile"));
    await click(element("#clerk-sign-in-button-desktop"));
    await click(element("#clerk-sign-up-button-desktop"));
    expect(services.auth.calls).toEqual([
      "start",
      "one-tap",
      "sign-in",
      "sign-in",
      "sign-up",
    ]);
  });

  it("asks for One Tap only for a signed-out visitor", async () => {
    await services.auth.set({ status: "unavailable" });
    await services.auth.set(SIGNED_IN);
    expect(services.auth.calls).toEqual(["start"]);

    await services.auth.set({ status: "signed-out" });
    expect(services.auth.calls).toEqual(["start", "one-tap"]);
  });

  it("mounts Clerk's user button in both slots and keeps what Clerk renders", async () => {
    await services.auth.set(SIGNED_IN);

    const desktop = element("#clerk-user-button-desktop");
    const mobile = element("#clerk-user-button-mobile");
    expect(desktop.parentElement).toBe(slot("desktop"));
    expect(mobile.parentElement).toBe(slot("mobile"));
    expect(mobile.className).toBe(desktop.className);
    expect(mobile.classList).toContain("h-9");
    expect(services.auth.userButtons).toEqual(new Set([desktop, mobile]));
    expect(document.querySelector("#clerk-sign-in-button-mobile")).toBeNull();

    desktop.append(document.createElement("img"));
    await click(element("#mobile-menu-button"));
    expect(
      document.querySelector("#clerk-user-button-desktop img"),
    ).not.toBeNull();

    await services.auth.set({ status: "signed-out" });
    expect(services.auth.userButtons).toEqual(new Set());
  });

  it("links to the accounts site with this page as the redirect when Clerk is unavailable", async () => {
    await services.auth.set({ status: "unavailable" });

    const redirect = encodeURIComponent(HREF);
    const links = (name: "desktop" | "mobile") =>
      [...slot(name).children].map((a) => [
        a.textContent,
        a.getAttribute("href"),
      ]);
    expect(links("desktop")).toEqual([
      [
        "Sign In",
        `https://accounts.classifast.com/sign-in?redirect_url=${redirect}`,
      ],
      [
        "Sign Up",
        `https://accounts.classifast.com/sign-up?redirect_url=${redirect}`,
      ],
    ]);
    expect(links("mobile")).toEqual([
      [
        "Sign In",
        `https://accounts.classifast.com/sign-in?redirect_url=${redirect}`,
      ],
    ]);
  });

  it("opens and closes the menu as the mapping header does", async () => {
    await click(element("#mobile-menu-button"));
    expect(menuState()).toEqual(OPEN);
    await press("Escape");
    expect(menuState()).toEqual(CLOSED);
    expect(document.activeElement).toBe(element("#mobile-menu-button"));
    await click(element("#mobile-menu-button"));
    await click(element("#outside"));
    expect(menuState()).toEqual(CLOSED);
  });
});

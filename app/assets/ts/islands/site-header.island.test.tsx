import { beforeEach, describe, expect, it } from "vitest";
import {
  click,
  element,
  fakeServices,
  hydratePage,
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

describe("header island, mapping variant", () => {
  beforeEach(async () => {
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
      fakeServices(),
    );
    expect(errors).toEqual([]);
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

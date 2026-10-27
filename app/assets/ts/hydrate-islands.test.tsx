import { act, useState } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Island } from "../../../src/web/islands/render-island.js";
import {
  IslandRoot,
  SERVER_SERVICES,
} from "../../../src/web/islands/services.js";
import { captureEdits } from "./hydrate-islands.js";
import {
  click,
  element,
  fakeServices,
  hydrateHtml,
  hydratePage,
} from "./test/islands.js";

const buyButton = {
  slug: "unspsc-to-cpv-mapping",
  returnUrl: "https://classifast.test/mapping/unspsc-to-cpv-mapping/",
  className: "action-button",
};

async function clickEveryButton(): Promise<void> {
  for (const button of document.querySelectorAll("button")) {
    await click(button);
  }
}

describe("hydrateIslands", () => {
  it("hydrates every host of a registered island", async () => {
    const services = fakeServices();
    const errors = await hydratePage(
      <>
        <Island name="buy-button" props={buyButton} />
        <Island name="buy-button" props={{ ...buyButton, slug: "other" }} />
      </>,
      services,
    );
    expect(errors).toEqual([]);

    await clickEveryButton();

    expect(services.checkouts.map(([slug]) => slug)).toEqual([
      "unspsc-to-cpv-mapping",
      "other",
    ]);
  });

  it("leaves a host from another version or an unknown island static", async () => {
    const services = fakeServices();
    const current = renderToStaticMarkup(
      <Island name="buy-button" props={buyButton} />,
    );
    const html = [
      current.replace('data-island-version="1"', 'data-island-version="0"'),
      current.replace('data-island="buy-button"', 'data-island="retired"'),
    ].join("");

    expect(await hydrateHtml(html, services)).toEqual([]);
    await clickEveryButton();

    expect(services.checkouts).toEqual([]);
  });

  it("escapes props so no value can close the host element", async () => {
    const services = fakeServices();
    const hostile = { ...buyButton, slug: `"></div><script>x</script>&amp;` };
    expect(
      await hydratePage(<Island name="buy-button" props={hostile} />, services),
    ).toEqual([]);
    expect(document.querySelectorAll("script")).toHaveLength(0);

    await click(element("button"));

    expect(services.checkouts).toEqual([[hostile.slug, hostile.returnUrl]]);
  });
});

function Notes() {
  const [edits, setEdits] = useState(0);
  return (
    <form onInput={() => setEdits((count) => count + 1)}>
      <textarea defaultValue="example" />
      <output>{edits}</output>
    </form>
  );
}

describe("captureEdits", () => {
  it("restores text typed before hydration as an input event", async () => {
    const host = document.createElement("div");
    host.innerHTML = renderToString(
      <IslandRoot services={SERVER_SERVICES} restoreEdits={() => {}}>
        <Notes />
      </IslandRoot>,
    );
    document.body.append(host);
    element<HTMLTextAreaElement>("textarea").value = "typed early";

    await act(async () => {
      hydrateRoot(
        host,
        <IslandRoot services={fakeServices()} restoreEdits={captureEdits(host)}>
          <Notes />
        </IslandRoot>,
      );
    });

    expect(element<HTMLTextAreaElement>("textarea").value).toBe("typed early");
    expect(element("output").textContent).toBe("1");
  });
});

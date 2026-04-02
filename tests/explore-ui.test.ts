import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { getExploreUI } from "../src/cli/commands/explore/ui.js";

describe("explore UI", () => {
  it("emits a browser script that parses", () => {
    const html = getExploreUI(7878);
    const match = html.match(/<script>([\s\S]*)<\/script>/);

    expect(match?.[1]).toBeTruthy();
    expect(() => new vm.Script(match![1])).not.toThrow();
  });
});

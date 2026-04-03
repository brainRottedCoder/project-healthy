import { afterEach, describe, expect, it } from "vitest";
import { shouldShowInstallAnimation } from "../src/postinstall.js";

const originalStdoutIsTTY = process.stdout.isTTY;

function setStdoutTTY(value: boolean | undefined) {
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value,
  });
}

afterEach(() => {
  Object.defineProperty(process.stdout, "isTTY", {
    configurable: true,
    value: originalStdoutIsTTY,
  });
});

describe("postinstall animation gating", () => {
  it("shows the animation for interactive local installs", () => {
    setStdoutTTY(true);

    expect(
      shouldShowInstallAnimation({
        npm_config_loglevel: "notice",
        TERM: "xterm-256color",
      }),
    ).toBe(true);
  });

  it("suppresses the animation in CI", () => {
    setStdoutTTY(true);

    expect(
      shouldShowInstallAnimation({
        CI: "true",
        npm_config_loglevel: "notice",
        TERM: "xterm-256color",
      }),
    ).toBe(false);
  });

  it("suppresses the animation without a TTY", () => {
    setStdoutTTY(false);

    expect(
      shouldShowInstallAnimation({
        npm_config_loglevel: "notice",
        TERM: "xterm-256color",
      }),
    ).toBe(false);
  });
});

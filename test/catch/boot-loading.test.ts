import { bootLoadingCss, hideBootLoading, showBootLoading } from "#app/catch/boot-loading";
import { afterEach, describe, expect, it, vi } from "vitest";

const banned = /discord|telegram|roguelite/i;

afterEach(() => {
  hideBootLoading();
  vi.useRealTimers();
  document.getElementById("cc-boot-loading-style")?.remove();
});

describe("boot loading indicator", () => {
  it("centers a pixel-font Loading label with animated dots", () => {
    showBootLoading();
    const root = document.getElementById("cc-boot-loading");
    expect(root).not.toBeNull();
    expect(root?.querySelector(".cc-boot-label")?.textContent).toBe("Loading");
    expect(root?.querySelectorAll(".cc-boot-dots i")).toHaveLength(3);
    expect(root?.getAttribute("aria-label")).toBe("Loading");
    expect(bootLoadingCss).toContain("font-family: emerald, monospace");
    expect(bootLoadingCss).toContain("align-items: center");
    expect(bootLoadingCss).toContain("justify-content: center");
    expect(bootLoadingCss).toContain("position: fixed");
    expect(bootLoadingCss).toContain("safe-area-inset-top");
    expect(bootLoadingCss).toContain("safe-area-inset-bottom");
    expect(bootLoadingCss).toContain("clamp(22px, 5.2vw, 48px)");
    expect(bootLoadingCss).toContain("@keyframes cc-boot-dot");
    expect(bootLoadingCss).not.toMatch(banned);
    expect(root?.textContent).not.toMatch(banned);
  });

  it("switches the copy after 15 seconds and hides when the scene is ready", () => {
    vi.useFakeTimers();
    showBootLoading();
    vi.advanceTimersByTime(14_000);
    expect(document.querySelector(".cc-boot-label")?.textContent).toBe("Loading");
    showBootLoading();
    vi.advanceTimersByTime(1_000);
    const root = document.getElementById("cc-boot-loading");
    expect(root?.classList.contains("is-slow")).toBe(true);
    expect(root?.querySelector(".cc-boot-label")?.textContent).toBe("Still loading, hang tight…");
    expect(root?.getAttribute("aria-label")).toBe("Still loading, hang tight…");
    hideBootLoading();
    expect(document.getElementById("cc-boot-loading")).toBeNull();
  });
});

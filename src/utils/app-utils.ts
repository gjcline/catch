/** @returns Whether the device has a touchscreen */
export function hasTouchscreen(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  if (window.matchMedia("(hover: none), (pointer: coarse)").matches) {
    return true;
  }
  // iPadOS desktop mode reports a Mac with a fine pointer and still has no mouse.
  const touchPoints = navigator.maxTouchPoints ?? 0;
  if (navigator.platform === "MacIntel" && touchPoints > 1) {
    return true;
  }
  const ua = navigator.userAgent || "";
  return touchPoints > 0 && /iPhone|iPad|Android|Mobile/i.test(ua);
}

/**
 * Checks if the orientation of the scene is landscape
 * @param scene - The scene to check (Must have a `scale: Phaser.Scale.ScaleManager` property)
 * @returns Whether the game is running in landscape mode (Primary or Secondary)
 */
export function isLandscapeMode(scene: { scale: Phaser.Scale.ScaleManager }): boolean {
  const landscapeModes = [Phaser.Scale.Orientation.LANDSCAPE, Phaser.Scale.Orientation.LANDSCAPE_SECONDARY];
  return landscapeModes.includes(scene.scale.orientation);
}

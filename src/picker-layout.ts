/** Geometry for ONE native-style picker card, including a reduced visual viewport. */
export interface PickerViewport { width: number; height: number; left?: number; top?: number }
export interface PickerPlacement {
  left: number; top: number; width: number; height: number; maxWidth: number; maxHeight: number;
}

export function placePicker(
  anchor: { right: number; top: number },
  measured: { width: number; height: number },
  viewport: PickerViewport,
): PickerPlacement {
  const margin = 12;
  const originX = viewport.left ?? 0;
  const originY = viewport.top ?? 0;
  const maxWidth = Math.max(1, Math.min(420, viewport.width - 32));
  const maxHeight = Math.max(1, Math.min(360, viewport.height - 2 * margin));
  const width = Math.min(Math.max(measured.width, 0), maxWidth);
  const height = Math.min(Math.max(measured.height, 0), maxHeight);
  const clamp = (value: number, start: number, end: number): number => Math.max(start, Math.min(value, end));
  return {
    left: clamp(anchor.right - width, originX + margin, originX + viewport.width - width - margin),
    top: clamp(anchor.top - 8 - height, originY + margin, originY + viewport.height - height - margin),
    width, height, maxWidth, maxHeight,
  };
}

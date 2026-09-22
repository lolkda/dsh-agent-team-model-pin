import assert from 'node:assert/strict';
import test from 'node:test';
let layout;
try { layout = await import('../src/picker-layout.ts'); } catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}

for (const viewport of [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 320, height: 240, left: 0, top: 320 },
]) {
  test(`picker layout: one panel stays inside ${viewport.width}x${viewport.height}`, () => {
    assert.equal(typeof layout?.placePicker, 'function');
    const rect = layout.placePicker(
      { right: viewport.width - 4, top: (viewport.top ?? 0) + viewport.height - 32 },
      { width: 440, height: 720 }, viewport,
    );
    const left = viewport.left ?? 0;
    const top = viewport.top ?? 0;
    assert.ok(rect.left >= left + 12);
    assert.ok(rect.top >= top + 12);
    assert.ok(rect.left + rect.width <= left + viewport.width - 12);
    assert.ok(rect.top + rect.height <= top + viewport.height - 12);
    assert.ok(rect.maxWidth <= viewport.width - 24);
    assert.ok(rect.maxHeight <= viewport.height - 24);
  });
}

test('picker layout: oversized panels also fit beside a left-edge trigger', () => {
  assert.equal(typeof layout?.placePicker, 'function');
  const rect = layout.placePicker({ right: 30, top: 40 }, { width: 900, height: 900 }, { width: 320, height: 240 });
  assert.equal(rect.left, 12);
  assert.equal(rect.top, 12);
  assert.ok(rect.width <= 296 && rect.height <= 216);
});

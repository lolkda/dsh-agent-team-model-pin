/** Native ModelSelect presentation: one fixed card, click-to-drill, no hover submenu.
 * Measurements and theme tokens follow DSH 0.1.7-rc.1's ModelSelect (MIT).
 * Class names are package-owned; no dependency on upstream hashed CSS names.
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
import {
  IconDataOutlineRegular, IconChevronDownOutlineRegular,
  IconChevronRightOutlineRegular, IconChevronLeftOutlineRegular, IconCheckOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives';
import { placePicker } from './picker-layout.ts';
import { CLIENT_VERSION } from './ui-state.ts';
import type { Choice, MenuRow } from './ui-state.ts';

const h = React.createElement;
const css = `
.atmp-picker{min-width:0;position:relative}
.atmp-trigger{min-width:0;max-width:min(360px,45cqw);height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:transparent;border:none;border-radius:24px;outline:none;align-items:center;gap:4px;padding:0 4px 0 8px;font-size:13px;font-weight:500;line-height:20px;display:flex}
.atmp-trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.atmp-trigger:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3)}
.atmp-trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
.atmp-trigger-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.atmp-trigger-effort{min-width:0;flex-shrink:1000;color:var(--dsw-alias-label-caption);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.atmp-trigger-icon{flex:none;display:none}
@container (width <= 360px){.atmp-trigger-icon{display:block}.atmp-trigger-label,.atmp-trigger-effort{display:none}}
.atmp-chevron{color:var(--dsw-alias-label-caption);flex:none;transition:transform .12s}
.atmp-chevron-open{transform:rotate(180deg)}
.atmp-menu{box-sizing:border-box;position:fixed;z-index:1100;display:flex;flex-direction:column;width:max-content;min-width:min(240px,calc(100vw - 32px));max-width:min(420px,calc(100vw - 32px));max-height:min(360px,calc(100dvh - 24px));padding:4px;border:0;border-radius:20px;overflow:hidden;background:var(--dsw-specific-menu);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-prominent);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
.atmp-scroll{min-height:0;overflow-y:auto;overscroll-behavior:contain;touch-action:pan-y;-webkit-overflow-scrolling:touch}
.atmp-cell{box-sizing:border-box;width:100%;min-height:40px;display:flex;align-items:center;gap:8px;padding:0 10px;color:var(--dsw-alias-label-primary);font-size:14px;line-height:22px;text-align:left;background:transparent;border:0;border-radius:10px;cursor:pointer;outline:none}
.atmp-cell:hover:not(:disabled),.atmp-cell:focus-visible,.atmp-option:hover:not(:disabled),.atmp-option:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}
.atmp-cell:disabled,.atmp-option:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}
.atmp-cell-label{flex:none;white-space:nowrap}
.atmp-cell-value{min-width:0;flex:auto;text-align:right;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.atmp-cell-chevron{flex:none;color:var(--dsw-alias-label-tertiary)}
.atmp-divider{height:1px;flex:none;margin:4px 8px;background:var(--dsw-alias-border-l1)}
.atmp-back{flex:none;border-bottom:1px solid var(--dsw-alias-border-l1);border-radius:12px 12px 0 0;margin-bottom:3px}
.atmp-group-title{position:sticky;top:0;z-index:1;padding:5px 8px 3px;font-size:12px;font-weight:500;line-height:18px;background:var(--dsw-specific-menu);color:var(--dsw-alias-label-tertiary)}
.atmp-option{box-sizing:border-box;width:100%;min-height:38px;display:flex;align-items:center;gap:8px;padding:6px 8px;color:inherit;text-align:left;background:transparent;border:0;border-radius:10px;outline:none;cursor:pointer}
.atmp-option-name{min-width:0;flex:1;color:inherit;font-size:14px;font-weight:500;line-height:20px;overflow-wrap:anywhere}
.atmp-check{display:grid;place-items:center;flex:0 0 18px;color:var(--dsw-alias-label-primary)}
.atmp-status{flex:none;padding:7px 10px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.atmp-error{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;flex:none;max-height:96px;overflow-y:auto;margin:4px 2px 0;padding:7px 8px;border-radius:8px;background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;overflow-wrap:anywhere}
.atmp-retry{flex:none;padding:0;border:0;background:transparent;color:inherit;font:inherit;font-weight:600;cursor:pointer}
@media (pointer:coarse){.atmp-cell,.atmp-option{min-height:44px}}
`;

export interface ModelPickerProps {
  open: boolean;
  disabled: boolean;
  busy: boolean;
  label: string;
  effort?: string;
  title: string;
  rows: readonly MenuRow[];
  selectedIds: readonly string[];
  status?: string;
  error?: string | null;
  backLabel: string;
  reloadLabel: string;
  onOpenChange(open: boolean): void;
  onChoose(id: string): Promise<boolean>;
  onReload(): void;
}

export function ModelPicker(props: ModelPickerProps): React.ReactElement {
  const { open, disabled, busy, rows, selectedIds } = props;
  const [pane, setPane] = React.useState('root');
  const [position, setPosition] = React.useState<React.CSSProperties | null>(null);
  const root = React.useRef<HTMLDivElement>(null);
  const trigger = React.useRef<HTMLButtonElement>(null);
  const menu = React.useRef<HTMLDivElement>(null);
  const focusIntent = React.useRef<string | null>(null);
  const id = React.useId();
  const parent = rows.find((row): row is Choice => !('type' in row) && row.id === pane);
  const choices = parent?.submenu ?? [];

  const close = (focus = false): void => {
    props.onOpenChange(false);
    setPane('root');
    if (focus) queueMicrotask(() => trigger.current?.focus());
  };
  const back = (): void => {
    focusIntent.current = pane;
    setPane('root');
  };
  const drill = (next: string): void => {
    focusIntent.current = 'choice';
    setPane(next);
  };
  const choose = async (value: string): Promise<void> => {
    if (busy) return;
    if (await props.onChoose(value)) close(true);
  };

  React.useEffect(() => {
    if (!open) { setPane('root'); setPosition(null); }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node) || root.current?.contains(target) || menu.current?.contains(target)) return;
      if (!busy) close();
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open, busy]);

  React.useLayoutEffect(() => {
    if (!open) return;
    const place = (): void => {
      const anchor = trigger.current?.getBoundingClientRect();
      const card = menu.current;
      if (!anchor || !card) return;
      const visual = window.visualViewport;
      const measured = card.getBoundingClientRect();
      const next = placePicker(anchor, {
        width: measured.width || card.offsetWidth || 240,
        height: measured.height || card.offsetHeight || 200,
      }, {
        width: visual?.width ?? window.innerWidth,
        height: visual?.height ?? window.innerHeight,
        left: visual?.offsetLeft ?? 0,
        top: visual?.offsetTop ?? 0,
      });
      const value = { left: next.left, top: next.top, maxWidth: next.maxWidth, maxHeight: next.maxHeight };
      setPosition((previous) => previous?.left === value.left && previous.top === value.top && previous.maxWidth === value.maxWidth && previous.maxHeight === value.maxHeight ? previous : value);
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(place);
    if (menu.current) observer?.observe(menu.current);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
      observer?.disconnect();
    };
  }, [open, pane, rows, props.status, props.error]);

  React.useEffect(() => {
    const intent = focusIntent.current;
    focusIntent.current = null;
    if (!open || !intent) return;
    const target = intent === 'choice'
      ? menu.current?.querySelector<HTMLButtonElement>('[data-atmp-choice][aria-checked="true"]:not(:disabled)') ?? menu.current?.querySelector<HTMLButtonElement>('[data-atmp-choice]:not(:disabled)')
      : menu.current?.querySelector<HTMLButtonElement>(`[data-atmp-open="${intent}"]`);
    (target ?? trigger.current)?.focus();
  }, [open, pane]);

  const onKeyDown = (event: React.KeyboardEvent): void => {
    if (!open || event.defaultPrevented) return;
    if (event.key === 'Escape' || event.key === 'Tab' && event.shiftKey || event.key === 'ArrowLeft' && pane !== 'root') {
      event.preventDefault();
      if (pane !== 'root') back(); else close(true);
      return;
    }
    const buttons = [...menu.current?.querySelectorAll<HTMLButtonElement>('[data-atmp-item]:not(:disabled)') ?? []];
    if (!buttons.length) return;
    const focused = document.activeElement;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const current = buttons.findIndex((button) => button === focused);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : current < 0 ? event.key === 'ArrowDown' ? 0 : buttons.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    } else if (event.key === 'Tab' || event.key === 'ArrowRight' && pane === 'root') {
      event.preventDefault();
      if (focused instanceof HTMLButtonElement && buttons.includes(focused)) focused.click();
      else buttons[0]?.focus();
    }
  };

  const rootRows = rows.map((row) => 'type' in row
    ? h('div', { key: row.id, className: 'atmp-divider', role: 'separator' })
    : h('button', {
      key: row.id, type: 'button', role: 'menuitem', className: 'atmp-cell',
      'data-atmp-open': row.id, 'data-atmp-item': true, 'aria-haspopup': 'menu',
      disabled: row.disabled || busy, onClick: () => drill(row.id),
    }, h('span', { className: 'atmp-cell-label' }, row.label),
    h('span', { className: 'atmp-cell-value', title: row.value }, row.value),
    h(IconChevronRightOutlineRegular, { className: 'atmp-cell-chevron' })));

  let lastGroup: string | undefined;
  const optionRows = choices.flatMap((choice) => {
    const result: React.ReactNode[] = [];
    if (choice.detail && choice.detail !== lastGroup) {
      result.push(h('div', { key: `group-${choice.id}`, className: 'atmp-group-title' }, choice.detail));
    }
    lastGroup = choice.detail;
    const selected = selectedIds.includes(choice.id);
    result.push(h('button', {
      key: choice.id, type: 'button', role: 'menuitemradio', 'aria-checked': selected,
      className: 'atmp-option', 'data-atmp-choice': choice.id, 'data-atmp-item': true,
      disabled: busy || choice.disabled, onClick: () => { void choose(choice.id); },
      title: choice.label,
    }, h('span', { className: 'atmp-option-name' }, choice.label),
    h('span', { className: 'atmp-check', 'aria-hidden': true }, selected && h(IconCheckOutlineRegular, { size: 16 }))));
    return result;
  });

  return h('div', { className: 'atmp-picker', ref: root, onKeyDown },
    h('style', null, css),
    h('button', {
      ref: trigger, type: 'button', className: 'atmp-trigger', 'data-team-model-pin': CLIENT_VERSION,
      disabled, 'aria-label': props.title, title: props.effort ? `${props.label} · ${props.effort}` : props.label,
      'aria-haspopup': 'menu', 'aria-expanded': open, 'aria-controls': open ? `${id}-menu` : undefined,
      onClick: () => { if (busy || disabled) return; setPane('root'); props.onOpenChange(!open); },
    }, h(IconDataOutlineRegular, { className: 'atmp-trigger-icon', size: 16 }),
    h('span', { className: 'atmp-trigger-label' }, props.label),
    props.effort && h('span', { className: 'atmp-trigger-effort' }, props.effort),
    h(IconChevronDownOutlineRegular, { className: `atmp-chevron${open ? ' atmp-chevron-open' : ''}` })),
    open && createPortal(h('div', {
      ref: menu, id: `${id}-menu`, role: 'menu', className: 'atmp-menu',
      'aria-label': parent?.label ?? props.title, 'aria-busy': busy,
      'data-atmp-pane': pane,
      style: position ?? { visibility: 'hidden', left: 0, top: 0 },
    }, pane !== 'root' && h('button', {
      type: 'button', className: 'atmp-cell atmp-back', 'data-atmp-back': true,
      'data-atmp-item': true, role: 'menuitem', disabled: busy,
      'aria-label': props.backLabel, onClick: back,
    }, h(IconChevronLeftOutlineRegular, {}), parent?.label),
    h('div', { className: 'atmp-scroll', 'data-atmp-scroll': true }, pane === 'root' ? rootRows : optionRows),
    props.status && h('div', { className: 'atmp-status', role: 'status' }, props.status),
    props.error && h('div', { className: 'atmp-error', role: 'alert' },
      h('span', null, props.error), h('button', { type: 'button', className: 'atmp-retry', disabled: busy, onClick: props.onReload }, props.reloadLabel)),
    ), document.body),
  );
}

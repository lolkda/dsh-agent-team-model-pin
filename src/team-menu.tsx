/** React rows in DSH's model/reasoning menu plus their one root overlay. */
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives';
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type {} from '@deepseek-ai/dsh-client-ui-layout/client';
import type { PresetRow } from './preset-policy.ts';
import {
  loadTeamMenuData,
  saveTeamMenuChoice,
} from './team-menu-data.ts';
import type {
  TeamMenuChoice,
  TeamMenuData,
  TeamMenuLabels,
  TeamMenuKind,
  TeamMenuRowState,
} from './team-menu-data.ts';

const zh = {
  rowPreset: 'Team 预设',
  rowModel: 'Team 模型',
  rowEffort: 'Team 推理等级',
  loading: '加载中…',
  unavailable: '不可用',
  follow: '跟随主 Agent',
  modelDefault: '模型默认',
  readOnly: '当前设置只读',
  missing: 'Team 插件尚未就绪，请刷新页面后重试',
  catalogUnavailable: 'Agent 预设目录不可用',
  saveUnavailable: 'Team 设置保存接口不可用',
  noModel: '当前没有可用模型',
  dialogPreset: '选择 Team 预设',
  dialogModel: '选择 Team 模型',
  dialogEffort: '选择 Team 推理等级',
  close: '关闭',
  cancel: '取消',
  saveFailed: '保存失败：',
  presetStandardName: '标准模式',
  presetStandardDescription: '处理代码、文件和资料，适合大多数任务。',
  presetPtcName: 'PTC 模式',
  presetPtcDescription: '包含标准模式的所有能力，更适合批量调用工具。',
  presetMinimalName: '极简模式',
  presetMinimalDescription: 'Agent 仅使用终端工具完成任务。',
  presetCordisName: '创造模式',
  presetCordisDescription: '用对话定制 DSH。',
} as const;
const en: Record<keyof typeof zh, string> = {
  rowPreset: 'Team preset',
  rowModel: 'Team model',
  rowEffort: 'Team reasoning effort',
  loading: 'Loading…',
  unavailable: 'Unavailable',
  follow: 'Follow main Agent',
  modelDefault: 'Model default',
  readOnly: 'Settings are read-only',
  missing: 'The Team plugin is not ready. Refresh the page and retry.',
  catalogUnavailable: 'The Agent preset catalog is unavailable',
  saveUnavailable: 'The Team settings saving API is unavailable',
  noModel: 'No available model',
  dialogPreset: 'Choose Team preset',
  dialogModel: 'Choose Team model',
  dialogEffort: 'Choose Team reasoning effort',
  close: 'Close',
  cancel: 'Cancel',
  saveFailed: 'Could not save: ',
  presetStandardName: 'Standard mode',
  presetStandardDescription: 'Work with code, files, and information. Suitable for most tasks.',
  presetPtcName: 'PTC mode',
  presetPtcDescription: 'Includes all Standard mode capabilities, better suited to batch tool calls.',
  presetMinimalName: 'Minimal mode',
  presetMinimalDescription: 'The agent works using only a terminal tool.',
  presetCordisName: 'Creator mode',
  presetCordisDescription: 'Customize DSH through conversation.',
};

export type TeamMenuKey = keyof typeof zh;

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'agentTeamMenu': TeamMenuKey;
  }
}

export const teamMenuLocale = { zh, en };

export interface TeamMenuRequest {
  sessionId: string;
  kind: TeamMenuKind;
}

/** A tiny observable used by the root overlay slot. */
class TeamMenuRequests {
  private current: TeamMenuRequest | null = null;
  private readonly listeners = new Set<() => void>();

  getSnapshot = (): TeamMenuRequest | null => this.current;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  set(value: TeamMenuRequest | null): void {
    this.current = value;
    for (const listener of this.listeners) listener();
  }
}

/** Session-independent controller shared by the rows and the overlay. */
export class TeamMenuController {
  readonly requests = new TeamMenuRequests();

  constructor(
    private readonly ctx: Parameters<typeof loadTeamMenuData>[0],
    private readonly labels: TeamMenuLabels,
    private readonly displayPreset: (row: PresetRow) => string,
  ) {}

  load(sessionId: string): Promise<TeamMenuData> {
    return loadTeamMenuData(this.ctx, sessionId, this.labels, this.displayPreset);
  }

  loadOne(sessionId: string, kind: TeamMenuKind): Promise<TeamMenuRowState> {
    return this.load(sessionId).then(data => data[kind]);
  }

  save(sessionId: string, choice: TeamMenuChoice, revision: number): Promise<void> {
    return saveTeamMenuChoice(this.ctx, sessionId, choice, revision, this.labels);
  }

  open(sessionId: string, kind: TeamMenuKind): void {
    this.requests.set({ sessionId, kind });
  }

  close(): void {
    this.requests.set(null);
  }
}

type MenuRowsProps = PropsRuntime<'conversation.input.model.options'>
  & PropsLocale<'agentTeamMenu'>
  & InjectFace<{ controller: TeamMenuController }>;

type OverlayProps = PropsRuntime<'shell.overlay'>
  & PropsLocale<'agentTeamMenu'>
  & InjectFace<{ controller: TeamMenuController; hooks: { request: HostObservable<TeamMenuRequest | null> } }>;

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  width: '100%',
  minHeight: 34,
  padding: '0 8px',
  border: 0,
  borderRadius: 'var(--dsw-radius-md)',
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
  fontSize: 13,
  lineHeight: '20px',
  textAlign: 'left',
  cursor: 'pointer',
};
const valueStyle: CSSProperties = {
  maxWidth: '58%',
  overflow: 'hidden',
  color: 'var(--dsw-alias-label-caption)',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const optionStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 2,
  width: '100%',
  padding: '8px 10px',
  border: 0,
  borderRadius: 'var(--dsw-radius-md)',
  background: 'transparent',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
};
const detailStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-caption)',
  fontSize: 12,
  lineHeight: '18px',
};

/** Render the three Team settings rows only in a root conversation. */
export function TeamSettingsRows(props: MenuRowsProps) {
  const { controller, sessionId, locked, dismiss, t } = props;
  const addressedChild = props.useSession(snapshot => snapshot.subagent !== null);
  const listedChild = props.useSessions(state => state.byId[sessionId]?.origin === 'subagent');
  const [data, setData] = useState<TeamMenuData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setError(null);
    void controller.load(sessionId).then(value => {
      if (live) setData(value);
    }, (reason: unknown) => {
      if (live) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { live = false; };
  }, [controller, sessionId]);

  if (addressedChild || listedChild) return null;

  const presetError = data?.preset.error ?? error;
  const modelError = data?.model.error ?? error;
  const effortError = data?.effort.error ?? error;
  const rows: readonly { kind: TeamMenuKind; label: string; value: string; rowError?: string }[] = [
    { kind: 'preset', label: t('rowPreset'), value: data?.preset.current ?? t('loading'),
      ...(presetError === null || presetError === undefined ? {} : { rowError: presetError }) },
    { kind: 'model', label: t('rowModel'), value: data?.model.current ?? t('loading'),
      ...(modelError === null || modelError === undefined ? {} : { rowError: modelError }) },
    { kind: 'effort', label: t('rowEffort'), value: data?.effort.current ?? t('loading'),
      ...(effortError === null || effortError === undefined ? {} : { rowError: effortError }) },
  ];

  return (
    <div data-dsh-team-settings-rows="">
      {rows.map((row, index) => {
        const unavailable = error !== null || row.rowError !== undefined;
        return (
          <button
            key={row.kind}
            type="button"
            role="menuitem"
            disabled={locked}
            aria-haspopup="dialog"
            title={row.rowError ?? error ?? undefined}
            style={{
              ...rowStyle,
              ...(index === 0 ? { borderTop: '1px solid var(--dsw-alias-border-l1)', marginTop: 4, paddingTop: 4, minHeight: 38 } : {}),
              ...(locked ? { cursor: 'not-allowed', opacity: 0.55 } : {}),
            }}
            onClick={() => {
              if (locked) return;
              dismiss();
              controller.open(sessionId, row.kind);
            }}
          >
            <span>{row.label}</span>
            <span style={valueStyle}>{unavailable ? t('unavailable') : row.value}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Root overlay: choosing a row opens this dialog after the model menu closes. */
export function TeamSettingsOverlay(props: OverlayProps) {
  const { controller, t } = props;
  const request = props.useRequest(value => value);
  if (request === null) return null;
  return <TeamSettingsDialog key={`${request.sessionId}:${request.kind}`} controller={controller} request={request} t={t} />;
}

function TeamSettingsDialog({ controller, request, t }: {
  controller: TeamMenuController;
  request: TeamMenuRequest;
  t: OverlayProps['t'];
}) {
  const [state, setState] = useState<TeamMenuRowState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let live = true;
    void controller.loadOne(request.sessionId, request.kind).then(value => {
      if (live) setState(value);
    }, (reason: unknown) => {
      if (live) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { live = false; };
  }, [controller, request.kind, request.sessionId]);

  const title = request.kind === 'preset'
    ? t('dialogPreset')
    : request.kind === 'model' ? t('dialogModel') : t('dialogEffort');
  const select = (choice: TeamMenuChoice): void => {
    if (saving || state === null) return;
    setSaving(true);
    setError(null);
    void controller.save(request.sessionId, choice, state.revision).then(() => {
      controller.close();
    }, (reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => { setSaving(false); });
  };

  return (
    <Modal open title={title} closeLabel={t('close')} onClose={() => controller.close()}
      footer={<Button variant="outline" onClick={() => controller.close()} disabled={saving}>{t('cancel')}</Button>}>
      {state === null && error === null && <p>{t('loading')}</p>}
      {(error !== null || state?.error !== undefined) && (
        <p role="alert" style={{ color: 'var(--dsw-alias-label-error)', margin: '0 0 8px' }}>
          {error === null ? state?.error : `${t('saveFailed')}${error}`}
        </p>
      )}
      {state !== null && (
        <div role="listbox" aria-label={title} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {state.options.map(option => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={option.active === true}
              disabled={saving}
              style={optionStyle}
              onClick={() => select(option.choice)}
            >
              <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span aria-hidden="true" style={{ width: 14 }}>{option.active === true ? '✓' : ''}</span>
                <span>{option.label}</span>
              </span>
              {option.detail !== undefined && <span style={{ ...detailStyle, paddingLeft: 22 }}>{option.detail}</span>}
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

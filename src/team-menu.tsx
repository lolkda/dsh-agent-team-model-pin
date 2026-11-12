/** React rows in DSH's model/reasoning menu plus native popupSelect launchers. */
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { PopupSpec } from '@deepseek-ai/dsh-client-ui-commands/client';
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client';
import type {} from '@deepseek-ai/dsh-client-ui-session/client';
import type { PresetRow } from './preset-policy.ts';
import type { PresetDisplayText } from './team-menu-data.ts';
import { loadTeamMenuData, saveTeamMenuChoice } from './team-menu-data.ts';
import type {
  TeamMenuChoice,
  TeamMenuData,
  TeamMenuLabels,
  TeamMenuKind,
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
  searchPreset: '搜索 Team 预设…',
  searchModel: '搜索 Team 模型…',
  searchEffort: '搜索 Team 推理等级…',
  empty: '暂无可用选项',
  noResults: '没有匹配的选项',
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
  searchPreset: 'Search Team presets…',
  searchModel: 'Search Team models…',
  searchEffort: 'Search Team reasoning efforts…',
  empty: 'No options',
  noResults: 'No matching options',
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

interface TeamPopupContext { sessionId: string }
interface PopupControllerLike {
  open(command: string, spec: PopupSpec<TeamPopupContext>, context: TeamPopupContext, segment: { via: 'enter'; token: string }): void;
}

/** Session-independent controller shared by the model-menu rows. */
export class TeamMenuController {
  private readonly choices = new Map<string, TeamMenuChoice>();
  private readonly revisions = new Map<string, number>();

  constructor(
    private readonly ctx: Parameters<typeof loadTeamMenuData>[0],
    private readonly labels: TeamMenuLabels,
    private readonly displayPreset: (row: PresetRow) => PresetDisplayText,
  ) {}

  load(sessionId: string): Promise<TeamMenuData> {
    return loadTeamMenuData(this.ctx, sessionId, this.labels, this.displayPreset);
  }

  /** Open the same native popupSelect shell used by slash commands. */
  open(sessionId: string, kind: TeamMenuKind): void {
    const binding = this.ctx.sessions.binding(sessionId);
    const commandUi = this.ctx.commandUi;
    const popup = commandUi?.popupFor?.(binding?.ctx) as PopupControllerLike | undefined;
    if (binding?.ctx === undefined || popup === undefined) return;
    popup.open(`team-${kind}`, this.spec(kind), { sessionId }, { via: 'enter', token: `/team-${kind}` });
  }

  private spec(kind: TeamMenuKind): PopupSpec<TeamPopupContext> {
    const searchLabel = kind === 'preset'
      ? this.labels.searchPreset
      : kind === 'model' ? this.labels.searchModel : this.labels.searchEffort;
    return {
      searchMode: 'fuzzy-label',
      searchLabels: () => ({ placeholder: searchLabel, empty: this.labels.empty, noResults: this.labels.noResults }),
      options: async (context, signal) => {
        signal.throwIfAborted();
        const data = await this.load(context.sessionId);
        signal.throwIfAborted();
        const row = data[kind];
        if (row.error !== undefined && row.options.length === 0) throw new Error(row.error);
        for (const option of row.options) {
          const id = `${context.sessionId}:${kind}:${option.id}`;
          this.choices.set(id, option.choice);
          this.revisions.set(id, row.revision);
        }
        return row.options.map(option => ({
          id: `${context.sessionId}:${kind}:${option.id}`,
          label: option.label,
          ...(option.detail === undefined ? {} : { detail: option.detail }),
          ...(option.group === undefined ? {} : { group: option.group }),
          ...(option.active === true ? { active: true } : {}),
        }));
      },
      onSelect: async (option, context) => {
        const choice = this.choices.get(option.id);
        const revision = this.revisions.get(option.id);
        if (choice === undefined || revision === undefined) throw new Error(this.labels.unavailable);
        await saveTeamMenuChoice(this.ctx, context.sessionId, choice, revision, this.labels);
      },
    };
  }
}

type MenuRowsProps = PropsRuntime<'conversation.input.model.options'>
  & PropsLocale<'agentTeamMenu'>
  & { controller: TeamMenuController };

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

import en from '../../i18n/en.commands.desktop.json' with { type: 'json' };
import zh from '../../i18n/zh-CN.commands.desktop.json' with { type: 'json' };
import type { CommandId } from '../../../electron/commands';
import type { Lang } from '../../i18n/index';

export { commandDefinitions, commandGroups, commandIds } from '../../../electron/commands';
export type { CommandId } from '../../../electron/commands';
export const commandStrings = { en, zh } satisfies Record<Lang, typeof en>;
export type EditorCommands = Record<CommandId, { run: () => void; disabled?: boolean; checked?: boolean }>;

export function commandShortcut(accelerator: string | undefined, mac: boolean) {
  return accelerator
    ?.replace('CommandOrControl+', mac ? '⌘' : 'Ctrl+')
    .replace('Shift+', mac ? '⇧' : 'Shift+');
}

import { Select } from '@radix-ui/themes';
import type { ReactNode } from 'react';

type Props = Omit<Select.TriggerProps, 'value' | 'onChange' | 'children'> & {
  value: string | number;
  onValueChange: (value: string) => void;
  options: { value: string | number; label: ReactNode; disabled?: boolean }[];
};

/** Shared option data for the editor's Radix selectors. */
export function Choice({ value, onValueChange, options, disabled, ...trigger }: Props) {
  return (
    <Select.Root value={String(value)} onValueChange={onValueChange} disabled={disabled}>
      <Select.Trigger variant="surface" data-value={value} {...trigger} />
      <Select.Content position="popper">
        {options.map((option) => (
          <Select.Item
            key={option.value}
            value={String(option.value)}
            disabled={option.disabled}
            data-value={option.value}
          >
            {option.label}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}

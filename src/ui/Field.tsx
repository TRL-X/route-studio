import { TextField } from '@radix-ui/themes';
import { useId, useState } from 'react';
import { NumberInput } from './NumberInput';

export function Field({
  label,
  value,
  save,
  number,
  date,
  min,
  max,
  optional = false,
  onInvalid,
  describedBy,
  increment,
  unit,
  displayLabel = label,
}: {
  label: string;
  value: string | number | null;
  save: (value: string) => void;
  number?: boolean;
  date?: boolean;
  min?: number;
  max?: number;
  optional?: boolean;
  onInvalid?: () => void;
  describedBy?: string;
  increment?: number;
  unit?: string;
  displayLabel?: string;
}) {
  const inputId = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const inputProps: TextField.RootProps = {
    id: inputId,
    'aria-describedby': describedBy,
    min,
    max,
    value: draft ?? value ?? '',
    onChange: (e) => setDraft(e.target.value),
    onKeyDown: (e) => {
      if (e.key === 'Enter') e.currentTarget.blur();
      if (e.key === 'Escape') {
        setDraft(null);
        e.currentTarget.value = String(value ?? '');
        e.currentTarget.blur();
      }
    },
    onBlur: (e) => {
      const raw = e.target.value;
      if (!e.currentTarget.validity.valid || (number && !optional && raw === '')) {
        onInvalid?.();
      } else if (raw !== String(value ?? '')) {
        save(raw);
      }
      setDraft(null);
    },
  };
  return (
    <div className="field">
      <label htmlFor={inputId}>{displayLabel}</label>
      {number ? (
        <NumberInput
          {...inputProps}
          aria-label={label}
          label={label}
          unit={unit}
          increment={increment}
          onStep={(next) => {
            setDraft(null);
            if (next !== value) save(String(next));
          }}
        />
      ) : (
        <TextField.Root {...inputProps} type={date ? 'date' : 'text'} />
      )}
    </div>
  );
}

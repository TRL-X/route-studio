import { useState } from 'react';

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
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type={number ? 'number' : date ? 'date' : 'text'}
        step={number ? 'any' : undefined}
        aria-describedby={describedBy}
        min={min}
        max={max}
        value={draft ?? value ?? ''}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
          if (e.key === 'Escape') {
            setDraft(null);
            e.currentTarget.value = String(value ?? '');
            e.currentTarget.blur();
          }
        }}
        onBlur={(e) => {
          const raw = e.target.value;
          if (!e.currentTarget.validity.valid || (number && !optional && raw === '')) {
            onInvalid?.();
          } else if (raw !== String(value ?? '')) {
            save(raw);
          }
          setDraft(null);
        }}
      />
    </label>
  );
}

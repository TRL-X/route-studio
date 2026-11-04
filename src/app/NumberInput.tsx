import { IconButton, TextField, Text } from '@radix-ui/themes';
import { useRef } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

type Props = Omit<TextField.RootProps, 'type' | 'step'> & {
  label: string;
  increment?: number;
  unit?: string;
  onStep: (value: number) => void;
};

/** Keep free-form precision while providing bounded, undoable desktop stepping. */
export function NumberInput({ label, increment = 1, unit, onStep, onKeyDown, ...props }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const min = props.min === undefined ? -Infinity : Number(props.min);
  const max = props.max === undefined ? Infinity : Number(props.max);
  const value = props.value === '' || props.value == null ? NaN : Number(props.value);
  function step(direction: number) {
    const current = input.current?.valueAsNumber ?? NaN;
    const base = Number.isFinite(current) ? current : 0;
    // Remove arithmetic noise without rounding a manually entered value to the increment.
    const next = Math.max(min, Math.min(max, Number((base + direction * increment).toPrecision(15))));
    if (next !== current) onStep(next);
  }
  return (
    <TextField.Root
      className="number-control"
      {...props}
      ref={input}
      type="number"
      step="any"
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || props.disabled || props.readOnly) return;
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          step(event.key === 'ArrowUp' ? 1 : -1);
        }
      }}
    >
      <TextField.Slot side="right" gap="1" pr="1">
        {unit && (
          <Text size="1" color="gray" aria-hidden="true">
            {unit}
          </Text>
        )}
        {([-1, 1] as const).map((direction) => (
          <IconButton
            size="1"
            variant="ghost"
            m="0"
            color="gray"
            key={direction}
            type="button"
            tabIndex={-1}
            aria-label={`${label} ${direction < 0 ? '−' : '+'}${increment}`}
            disabled={props.disabled || props.readOnly || (direction < 0 ? value <= min : value >= max)}
            // Keep the draft in the input until the step commits it as one history entry.
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => step(direction)}
          >
            {direction < 0 ? <ChevronDown /> : <ChevronUp />}
          </IconButton>
        ))}
      </TextField.Slot>
    </TextField.Root>
  );
}

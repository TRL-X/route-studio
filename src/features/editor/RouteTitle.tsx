import { useLayoutEffect, useRef, useState } from 'react';
import { strings, type Lang } from '../../i18n/index';

export function RouteTitle({
  name,
  lang,
  locked,
  onRename,
}: {
  name: string;
  lang: Lang;
  locked: boolean;
  onRename: (name: string) => void;
}) {
  const t = strings[lang];
  const title = name || t.untitled;
  const [editing, setEditing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);

  useLayoutEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    } else if (restoreFocus.current) {
      restoreFocus.current = false;
      button.current?.focus();
    }
  }, [editing]);

  return (
    <h1 className="route-title" aria-label={title}>
      {editing ? (
        <input
          ref={input}
          aria-label={t.routeName}
          defaultValue={name}
          placeholder={t.untitled}
          disabled={locked}
          onBlur={(event) => {
            const next = event.currentTarget.value;
            if (next !== name) onRename(next);
            setEditing(false);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            if (event.key !== 'Enter' && event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            restoreFocus.current = true;
            if (event.key === 'Escape') event.currentTarget.value = name;
            event.currentTarget.blur();
          }}
        />
      ) : (
        <button
          ref={button}
          type="button"
          aria-label={t.renameRoute}
          title={`${title} · ${t.renameRoute}`}
          disabled={locked}
          onClick={() => setEditing(true)}
        >
          {title}
        </button>
      )}
    </h1>
  );
}

import { useState, type ReactNode } from 'react';
import { Activity, ChevronDown, ChevronUp } from 'lucide-react';
import type { Copy } from './strings';

const minimum = 16;
const maximum = 65;

export function ProfilePanel({
  children,
  t,
  count,
  missing,
  onFill,
}: {
  children: ReactNode;
  t: Copy;
  count: number;
  missing: number;
  onFill: () => void;
}) {
  const [height, setHeight] = useState(27);
  const [collapsed, setCollapsed] = useState(false);
  function resize(next: number) {
    setHeight(Math.max(minimum, Math.min(maximum, Math.round(next))));
    setCollapsed(false);
  }
  return (
    <section className="profile-area" style={{ height: collapsed ? 'auto' : `max(112px, ${height}%)` }}>
      <div
        className="profile-divider"
        role="separator"
        aria-label={t.resizeProfile}
        aria-orientation="horizontal"
        aria-controls="profile-frame"
        aria-valuemin={0}
        aria-valuemax={maximum}
        aria-valuenow={collapsed ? 0 : height}
        tabIndex={0}
        onPointerDown={(e) => {
          if (e.button === 0) e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          const canvas = e.currentTarget.closest('main')!.getBoundingClientRect();
          resize(((canvas.bottom - e.clientY) / canvas.height) * 100);
        }}
        onKeyDown={(e) => {
          switch (e.key) {
            case 'ArrowUp':
              resize(collapsed ? minimum : height + 5);
              break;
            case 'ArrowDown':
              if (collapsed || height <= minimum) setCollapsed(true);
              else resize(height - 5);
              break;
            case 'Home':
              setCollapsed(true);
              break;
            case 'End':
              resize(maximum);
              break;
            default:
              return;
          }
          e.preventDefault();
        }}
      />
      <div className="profile-head">
        <span className="pane-title">
          <Activity size={15} />
          {t.profile}
        </span>
        <span className="sample-count">
          {count} {t.samples}
        </span>
        {missing > 0 && (
          <button className="sub-action gap-fill" title={t.interpolationHint} onClick={onFill}>
            {t.interpolateGaps} ({missing})
          </button>
        )}
        <button
          className="icon profile-toggle"
          aria-label={collapsed ? t.expandProfile : t.collapseProfile}
          title={collapsed ? t.expandProfile : t.collapseProfile}
          aria-expanded={!collapsed}
          aria-controls="profile-frame"
          onClick={() => setCollapsed(!collapsed)}
        >
          {collapsed ? <ChevronUp /> : <ChevronDown />}
        </button>
      </div>
      <div className="profile-frame" id="profile-frame" hidden={collapsed}>
        {children}
      </div>
    </section>
  );
}

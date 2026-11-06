import type { ReactNode } from 'react';

export function PropertyGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="property-group" open>
      <summary>{title}</summary>
      <div className="property-body">{children}</div>
    </details>
  );
}

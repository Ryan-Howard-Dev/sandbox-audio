import React from 'react';

/** Scroll target for settings search — place at the start of a searchable section. */
export default function SettingsSectionAnchor({ id }: { id: string }) {
  return (
    <span
      className="settings-section-anchor"
      data-settings-anchor={id}
      aria-hidden
    />
  );
}

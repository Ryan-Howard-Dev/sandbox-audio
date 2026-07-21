import { useEffect, useState } from 'react';

export function useAccentColor(): string {
  const [color, setColor] = useState('#e8500a');

  useEffect(() => {
    const read = () => {
      const v = getComputedStyle(document.documentElement).getPropertyValue('--orange').trim();
      if (v) setColor(v);
    };
    read();
    window.addEventListener('sandbox-theme-change', read);
    return () => window.removeEventListener('sandbox-theme-change', read);
  }, []);

  return color;
}

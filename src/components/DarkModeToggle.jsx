import React from 'react';
import { Moon, Sun, Monitor } from 'lucide-react';

const MODES = [
  { key: 'auto', label: 'אוטומטי (לפי מערכת)', icon: Monitor },
  { key: 'light', label: 'מצב בהיר', icon: Sun },
  { key: 'dark', label: 'מצב כהה', icon: Moon },
];

export default function DarkModeToggle({ themeMode, setThemeMode }) {
  const currentIndex = MODES.findIndex(m => m.key === themeMode);
  const nextIndex = (currentIndex + 1) % MODES.length;
  const current = MODES[currentIndex] || MODES[0];
  const CurrentIcon = current.icon;

  return (
    <button
      onClick={() => setThemeMode(MODES[nextIndex].key)}
      className="flex items-center w-full justify-start text-sm lg:text-base border border-red-200 text-red-800 hover:bg-red-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700 rounded-md px-4 py-2 mb-2 transition-colors"
      type="button"
    >
      <CurrentIcon className="h-4 w-4 ml-2" />
      {current.label}
    </button>
  );
}
import React from 'react';
import { Moon, Sun } from 'lucide-react';

export default function DarkModeToggle({ darkMode, setDarkMode }) {
  return (
    <button
      onClick={() => setDarkMode(!darkMode)}
      className="flex items-center w-full justify-start text-sm lg:text-base border border-red-200 text-red-800 hover:bg-red-50 rounded-md px-4 py-2 mb-2 transition-colors"
      type="button"
    >
      {darkMode ? <Sun className="h-4 w-4 ml-2" /> : <Moon className="h-4 w-4 ml-2" />}
      {darkMode ? 'מצב בהיר' : 'מצב כהה'}
    </button>
  );
}
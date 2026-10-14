import React from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';
import { ThemeMode } from '../types';

interface ThemeToggleProps {
  variant?: 'segmented' | 'compact' | 'dropdown';
  className?: string;
}

export function ThemeToggle({ variant = 'segmented', className = '' }: ThemeToggleProps) {
  const { theme, resolvedTheme, setTheme, isSystemDark } = useTheme();

  const options: { mode: ThemeMode; label: string; shortLabel: string; icon: React.ReactNode }[] = [
    {
      mode: 'system',
      label: `System (${isSystemDark ? 'Dunkel' : 'Hell'})`,
      shortLabel: 'Auto',
      icon: <Monitor className="w-3.5 h-3.5" />,
    },
    {
      mode: 'light',
      label: 'Heller Modus',
      shortLabel: 'Hell',
      icon: <Sun className="w-3.5 h-3.5" />,
    },
    {
      mode: 'dark',
      label: 'Dunkler Modus',
      shortLabel: 'Dunkel',
      icon: <Moon className="w-3.5 h-3.5" />,
    },
  ];

  if (variant === 'compact') {
    return (
      <button
        type="button"
        id="theme-toggle-compact"
        onClick={() => {
          if (theme === 'system') setTheme('light');
          else if (theme === 'light') setTheme('dark');
          else setTheme('system');
        }}
        className={`p-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors shadow-xs cursor-pointer flex items-center gap-1.5 text-xs font-medium ${className}`}
        title={`Aktuelles Design: ${
          theme === 'system' ? `System (${resolvedTheme === 'dark' ? 'Dunkel' : 'Hell'})` : theme === 'dark' ? 'Dunkel' : 'Hell'
        }. Klicken zum Wechseln.`}
        aria-label="Design wechseln"
      >
        {theme === 'system' ? (
          <Monitor className="w-4 h-4 text-blue-600 dark:text-blue-400" />
        ) : resolvedTheme === 'dark' ? (
          <Moon className="w-4 h-4 text-indigo-400" />
        ) : (
          <Sun className="w-4 h-4 text-amber-500" />
        )}
        <span className="hidden sm:inline capitalize">
          {theme === 'system' ? 'Auto' : theme === 'dark' ? 'Dunkel' : 'Hell'}
        </span>
      </button>
    );
  }

  // Segmented control (default)
  return (
    <div
      role="radiogroup"
      aria-label="Farbschema auswählen"
      className={`inline-flex items-center p-1 rounded-xl bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200/80 dark:border-zinc-700/60 shadow-xs ${className}`}
    >
      {options.map((opt) => {
        const isActive = theme === opt.mode;
        return (
          <button
            key={opt.mode}
            type="button"
            role="radio"
            aria-checked={isActive}
            id={`theme-btn-${opt.mode}`}
            onClick={() => setTheme(opt.mode)}
            title={opt.label}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg transition-all cursor-pointer ${
              isActive
                ? 'bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white shadow-xs font-semibold'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-zinc-200/50 dark:hover:bg-zinc-700/40'
            }`}
          >
            <span
              className={
                isActive
                  ? opt.mode === 'system'
                    ? 'text-blue-600 dark:text-blue-400'
                    : opt.mode === 'light'
                    ? 'text-amber-500'
                    : 'text-indigo-400'
                  : ''
              }
            >
              {opt.icon}
            </span>
            <span className="text-[11px]">{opt.shortLabel}</span>
          </button>
        );
      })}
    </div>
  );
}

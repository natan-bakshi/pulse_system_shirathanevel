import React, { useState, useRef, useEffect } from 'react';

const CURRENCIES = [
  { code: 'ILS', symbol: '₪' },
  { code: 'USD', symbol: '$' }
];

export default function CurrencyPicker({ value, onChange, className = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  
  const current = CURRENCIES.find(c => c.code === value) || CURRENCIES[0];
  const other = CURRENCIES.find(c => c.code !== current.code);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-sm font-medium text-gray-500 hover:text-gray-800 transition-colors px-0.5 cursor-pointer select-none"
        title="לחץ לשינוי מטבע"
      >
        {current.symbol}
      </button>
      {open && (
        <div className="absolute z-50 top-full mt-0.5 bg-white border border-gray-200 rounded shadow-md min-w-[32px]" style={{ right: '50%', transform: 'translateX(50%)' }}>
          <button
            type="button"
            onClick={() => {
              onChange(other.code);
              setOpen(false);
            }}
            className="block w-full text-center text-sm font-medium py-1 px-2 hover:bg-gray-100 transition-colors"
          >
            {other.symbol}
          </button>
        </div>
      )}
    </div>
  );
}
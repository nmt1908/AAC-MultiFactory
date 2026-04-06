// src/components/UnauthorizedDialog.jsx
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

export default function UnauthorizedDialog({ onLogout, userData }) {
  const { t } = useTranslation('common');
  const [countdown, setCountdown] = useState(5);

  // Countdown timer
  useEffect(() => {
    if (countdown <= 0) {
      onLogout?.();
      return;
    }

    const timer = setTimeout(() => {
      setCountdown(prev => prev - 1);
    }, 1000);

    return () => clearTimeout(timer);
  }, [countdown, onLogout]);

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50">
      {/* Very transparent overlay - can see login behind */}
      <div className="absolute inset-0 bg-black/10" onClick={onLogout} />

      {/* Smaller Dialog Card */}
      <div className="relative w-full max-w-sm mx-4 p-6 bg-white rounded-2xl shadow-2xl border-2 border-red-200 z-10">
        {/* Icon */}
        <div className="text-center mb-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-50 mb-3">
            <span className="text-3xl">🚫</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900 mb-2">
            {t('unauthorized.title')}
          </h1>
          <p className="text-xs text-slate-600 mb-3">
            {t('unauthorized.message')}
          </p>

          {/* Show employee info */}
          {/* {userData && (
            <div className="mt-3 p-2.5 bg-slate-50 rounded-lg">
              <p className="text-xs text-slate-500">{t('unauthorized.employeeInfo')}</p>
              <p className="text-sm font-semibold text-slate-900">
                {userData.name} - {userData.empno}
              </p>
            </div>
          )} */}
        </div>

        {/* Contact Info + Countdown */}
        <p className="mt-3 text-center text-xs text-slate-500">
          {t('unauthorized.contactAdmin')}
        </p>
        <p className="mt-2 text-center text-lg text-red-600 font-bold">
          {countdown}
        </p>
        <p className="text-center text-xs text-slate-500">
          giây
        </p>
      </div>
    </div>
  );
}

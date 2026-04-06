import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FiX } from 'react-icons/fi';

/**
 * Alert Image Dialog - displays full alert image in a modal
 * @param {Object} props
 * @param {Object|null} props.alert - alert object to display
 * @param {Function} props.onClose - callback when dialog closes
 */
function AlertImageDialog({ alert, onClose }) {
    const { t, i18n } = useTranslation('common');

    // ESC key handler
    useEffect(() => {
        if (!alert) return;

        const handleKeyDown = (e) => {
            if (e.key === 'Escape' || e.key === 'Esc') {
                e.preventDefault();
                onClose?.();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [alert, onClose]);

    if (!alert) return null;

    // Helper: map event_code -> i18n key
    const getEventLabelKey = (code) => {
        if (!code) return 'alerts.events.unknown';
        const c = String(code).toLowerCase();

        switch (c) {
            case 'crowb':
                return 'alerts.events.crowb';
            case 'crowb2':
                return 'alerts.events.crowb2';
            case 'intruder':
                return 'alerts.events.intruder';
            case 'fire':
                return 'alerts.events.fire';
            case 'smartphone':
                return 'alerts.events.smartphone';
            default:
                return 'alerts.events.unknown';
        }
    };

    const alertTime = alert.created_unix
        ? new Date(alert.created_unix * 1000).toLocaleString(
            i18n.language?.startsWith('en') ? 'en-US' : 'vi-VN'
        )
        : '—';

    const eventText = alert.event_code ? t(getEventLabelKey(alert.event_code)) : '';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4">
            <div className="relative w-full max-w-5xl max-h-[92vh] bg-slate-950/95 rounded-3xl shadow-2xl border border-slate-800/70 overflow-hidden flex flex-col">
                {/* Close button */}
                <button
                    onClick={onClose}
                    className="
            absolute right-4 top-2 z-10
            flex h-8 w-8 items-center justify-center
            rounded-full
            bg-red-500/80 text-white
            hover:bg-red-600/90
            shadow-md border border-white/40
            transition
          "
                >
                    <FiX className="w-4 h-4" />
                </button>

                {/* HEADER */}
                <div className="h-11 px-6 flex items-center justify-between bg-slate-900/90 border-b border-slate-800">
                    <div className="flex flex-col">
                        <span className="text-[10px] uppercase tracking-wide text-slate-400">
                            {t('alerts.camera')}
                        </span>
                        <span className="text-xs md:text-sm font-semibold text-slate-100">
                            {alert.camera_code || '—'}
                        </span>
                    </div>

                    <div className="hidden md:flex flex-col items-end text-[10px] text-slate-300">
                        {/* Reserved for future use */}
                    </div>
                </div>

                {/* BODY – IMAGE */}
                <div className="flex-1 bg-black flex items-center justify-center">
                    {alert.fullUrl ? (
                        <img
                            src={alert.fullUrl}
                            alt={`Alert ${alert.camera_code || ''}`}
                            className="max-w-full max-h-full object-contain"
                        />
                    ) : alert.thumbUrl ? (
                        <img
                            src={alert.thumbUrl}
                            alt={`Alert ${alert.camera_code || ''}`}
                            className="max-w-full max-h-full object-contain"
                        />
                    ) : (
                        <p className="text-xs text-slate-200 p-4">
                            {t('alerts.noImage') || 'No image available.'}
                        </p>
                    )}
                </div>

                {/* FOOTER */}
                <div className="px-6 py-3 bg-slate-900/95 border-t border-slate-800 flex flex-col md:flex-row md:items-center justify-between gap-2 text-[11px] text-slate-300">
                    <div className="flex-1 min-w-0">
                        {eventText ? (
                            <p className="truncate">
                                <span className="font-semibold">
                                    {t('alerts.genericPrefix')}{' '}
                                </span>
                                <span>{eventText}</span>
                            </p>
                        ) : (
                            <p className="truncate">
                                {t('alerts.camera')}:{' '}
                                <span className="font-mono font-semibold">
                                    {alert.camera_code || '—'}
                                </span>
                            </p>
                        )}
                    </div>

                    <div className="md:text-right font-mono text-slate-400">
                        {alertTime}
                    </div>
                </div>
            </div>
        </div>
    );
}

export default React.memo(AlertImageDialog);

import React, { useEffect, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FiX } from 'react-icons/fi';
import { 
    IoChevronBackOutline, 
    IoChevronForwardOutline, 
    IoCheckmarkCircleOutline, 
    IoCloseCircleOutline, 
    IoHelpCircleOutline 
} from 'react-icons/io5';
import BoundingBoxOverlay from './BoundingBoxOverlay';

/**
 * Alert Image Dialog - displays full alert image in a modal with actions
 * @param {Object} props
 * @param {Object|null} props.alert - alert object to display
 * @param {Function} props.onClose - callback when dialog closes
 * @param {Function} props.onNext - callback for next alert
 * @param {Function} props.onPrev - callback for previous alert
 * @param {Function} props.onStatusUpdate - callback for updating alert status
 * @param {boolean} [props.hasPrev=false] - if there is a previous alert
 * @param {boolean} [props.hasNext=false] - if there is a next alert
 */
function AlertImageDialog({ 
    alert, 
    onClose, 
    onNext, 
    onPrev, 
    onStatusUpdate,
    hasPrev = false,
    hasNext = false
}) {
    console.log("[DEBUG] AlertImageDialog alert prop:", alert);
    const { t, i18n } = useTranslation('common');
    const [imgDims, setImgDims] = useState({ w: 0, h: 0 });
    const [isUpdating, setIsUpdating] = useState(false);
    const imgRef = React.useRef(null);

    // Reset image dims when alert changes
    useEffect(() => {
        setImgDims({ w: 0, h: 0 });
    }, [alert?.id]);

    // Fallback: detect dimensions if image is already loaded or cached
    useEffect(() => {
        if (imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth) {
            setImgDims({
                w: imgRef.current.naturalWidth,
                h: imgRef.current.naturalHeight
            });
        }
    }, [alert?.id, alert?.fullUrl, alert?.thumbUrl]);

    // Keyboard handlers
    useEffect(() => {
        if (!alert) return;

        const handleKeyDown = (e) => {
            if (e.key === 'Escape' || e.key === 'Esc') {
                e.preventDefault();
                onClose?.();
            } else if (e.key === 'ArrowRight' && hasNext) {
                onNext?.();
            } else if (e.key === 'ArrowLeft' && hasPrev) {
                onPrev?.();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [alert, onClose, onNext, onPrev, hasNext, hasPrev]);

    if (!alert) return null;

    // Helper: map event_code -> i18n key
    const getEventLabelKey = (code) => {
        if (!code) return 'alerts.events.unknown';
        const c = String(code).toLowerCase();

        switch (c) {
            case 'crowb': return 'alerts.events.crowb';
            case 'crowb2': return 'alerts.events.crowb2';
            case 'intruder': return 'alerts.events.intruder';
            case 'fire': return 'alerts.events.fire';
            case 'smartphone': return 'alerts.events.smartphone';
            default: return 'alerts.events.unknown';
        }
    };

    const handleImageLoad = (e) => {
        if (e.target.naturalWidth) {
            setImgDims({
                w: e.target.naturalWidth,
                h: e.target.naturalHeight
            });
        }
    };

    const handleStatusUpdate = async (status) => {
        if (isUpdating || !onStatusUpdate) return;
        setIsUpdating(true);
        try {
            await onStatusUpdate(alert.id, status);
        } finally {
            setIsUpdating(false);
        }
    };

    const alertTime = alert.created_unix
        ? new Date(alert.created_unix * 1000).toLocaleString(
            i18n.language?.startsWith('en') ? 'en-US' : 'vi-VN'
        )
        : '—';

    const eventText = alert.event_code ? t(getEventLabelKey(alert.event_code)) : '';
    const isSmartphone = alert.event_code?.toLowerCase() === 'smartphone';

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md px-4 py-8">
            <div className="relative w-full max-w-6xl h-full max-h-full bg-slate-950 rounded-[2.5rem] shadow-2xl border border-slate-800/50 overflow-hidden flex flex-col">
                
                {/* Header */}
                <div className="flex-shrink-0 h-14 pl-8 pr-4 flex items-center justify-between border-b border-slate-800/80 bg-slate-900/40">
                    <div className="flex items-center gap-4">
                        <div className="flex flex-col">
                            <span className="text-[10px] uppercase font-bold tracking-[0.2em] text-slate-500">
                                {t('manageEvents.camera')}
                            </span>
                            <span className="text-sm font-black text-slate-100 flex items-center gap-2">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]"></span>
                                {alert.camera_code || '—'}
                            </span>
                        </div>
                        <div className="h-6 w-px bg-slate-800"></div>
                        <div className="flex flex-col">
                            <span className="text-[10px] uppercase font-bold tracking-[0.2em] text-slate-500">
                                {t('manageEvents.eventType')}
                            </span>
                            <span className="text-sm font-bold text-slate-300">
                                {eventText}
                            </span>
                        </div>
                    </div>

                    <div className="flex items-center gap-6">
                        <div className="hidden md:flex flex-col items-end">
                            <span className="text-[10px] uppercase font-bold tracking-[0.2em] text-slate-500">
                                {t('manageEvents.time')}
                            </span>
                            <span className="text-xs font-mono text-slate-400">
                                {alertTime}
                            </span>
                        </div>
                        <button
                            onClick={onClose}
                            className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-800/50 text-slate-400 hover:bg-red-500/20 hover:text-red-500 transition-all active:scale-95"
                        >
                            <FiX className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                {/* Body - Image & Navigation */}
                <div className="flex-1 min-h-0 relative group bg-black flex items-center justify-center overflow-hidden">
                    {/* Previous Button Overlay */}
                    {hasPrev && (
                        <button 
                            onClick={onPrev}
                            className="absolute left-6 top-1/2 -translate-y-1/2 z-20 w-12 h-12 rounded-full bg-black/20 hover:bg-blue-600/80 text-white backdrop-blur-md flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 border border-white/10"
                        >
                            <IoChevronBackOutline size={24} />
                        </button>
                    )}

                    {/* Next Button Overlay */}
                    {hasNext && (
                        <button 
                            onClick={onNext}
                            className="absolute right-6 top-1/2 -translate-y-1/2 z-20 w-12 h-12 rounded-full bg-black/20 hover:bg-blue-600/80 text-white backdrop-blur-md flex items-center justify-center transition-all opacity-0 group-hover:opacity-100 border border-white/10"
                        >
                            <IoChevronForwardOutline size={24} />
                        </button>
                    )}

                    {alert.fullUrl || alert.thumbUrl ? (
                        <div className="relative rounded-2xl overflow-hidden border border-slate-800 shadow-2xl bg-slate-900 group">
                            <img
                                ref={imgRef}
                                src={alert.fullUrl || alert.thumbUrl}
                                alt={`Alert ${alert.camera_code || ''}`}
                                className="w-full h-[calc(100vh-300px)] object-contain transition-transform duration-500"
                                onLoad={handleImageLoad}
                            />
                            <BoundingBoxOverlay 
                                boxes={alert.boxes || alert.box_details} 
                                imgDims={imgDims} 
                            />
                        </div>
                    ) : (
                        <p className="text-slate-500 text-sm font-medium">
                            {t('alerts.noImage') || 'No image available.'}
                        </p>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="flex-shrink-0 px-8 py-6 border-t border-slate-800/80 bg-slate-900/60 backdrop-blur-xl">
                    <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                        {/* Navigation Pills */}
                        <div className="flex items-center gap-2 bg-slate-800/40 p-1.5 rounded-2xl border border-white/5">
                            <button 
                                onClick={onPrev}
                                disabled={!hasPrev}
                                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all disabled:opacity-20 disabled:cursor-not-allowed hover:bg-slate-700 text-slate-300"
                            >
                                <IoChevronBackOutline size={16} />
                                {t('manageEvents.feedback.previous')}
                            </button>
                            <div className="w-px h-5 bg-slate-700/50"></div>
                            <button 
                                onClick={onNext}
                                disabled={!hasNext}
                                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all disabled:opacity-20 disabled:cursor-not-allowed hover:bg-slate-700 text-slate-300"
                            >
                                {t('manageEvents.feedback.next')}
                                <IoChevronForwardOutline size={16} />
                            </button>
                        </div>

                        {/* Event Review Actions */}
                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => handleStatusUpdate('true')}
                                disabled={isUpdating}
                                className={`
                                    flex items-center gap-2 px-6 py-3 rounded-2xl font-bold text-sm transition-all
                                    bg-emerald-500/10 text-emerald-500 border-2 border-emerald-500/20 hover:bg-emerald-500 hover:text-white hover:border-emerald-500
                                    ${alert.status === 'true' ? 'bg-emerald-500 text-white border-emerald-500 ring-4 ring-emerald-500/20' : ''}
                                `}
                            >
                                <IoCheckmarkCircleOutline size={20} />
                                {t('manageEvents.feedback.correct')}
                            </button>
                            
                            <button
                                onClick={() => handleStatusUpdate('fail')}
                                disabled={isUpdating}
                                className={`
                                    flex items-center gap-2 px-6 py-3 rounded-2xl font-bold text-sm transition-all
                                    bg-red-500/10 text-red-500 border-2 border-red-500/20 hover:bg-red-500 hover:text-white hover:border-red-500
                                    ${alert.status === 'fail' ? 'bg-red-500 text-white border-red-500 ring-4 ring-red-500/20' : ''}
                                `}
                            >
                                <IoCloseCircleOutline size={20} />
                                {t('manageEvents.feedback.incorrect')}
                            </button>

                            <button
                                onClick={() => handleStatusUpdate('unclear')}
                                disabled={isUpdating}
                                className={`
                                    flex items-center gap-2 px-6 py-3 rounded-2xl font-bold text-sm transition-all
                                    bg-orange-500/10 text-orange-500 border-2 border-orange-500/20 hover:bg-orange-500 hover:text-white hover:border-orange-500
                                    ${alert.status === 'unclear' ? 'bg-orange-500 text-white border-orange-500 ring-4 ring-orange-500/20' : ''}
                                `}
                            >
                                <IoHelpCircleOutline size={20} />
                                {t('manageEvents.feedback.unclear')}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default React.memo(AlertImageDialog);

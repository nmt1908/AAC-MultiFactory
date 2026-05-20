import React, { useRef, useEffect } from 'react';
import { FiMaximize2, FiX } from 'react-icons/fi';
import { useTranslation } from "react-i18next";
import FisheyeQuadView from './FisheyeQuadView';

import { currentConfig } from '../config/factoryConfig';

const FISHEYE_EXCEPT_CODES = ['B2006_WR', 'B2009_WR'];
const IS_CH = currentConfig.factoryId === 'ch';
const REFRESH_INTERVAL = IS_CH ? 2500 : 500;

/**
 * Build snapshot URL
 */
function buildSnapshotUrl(camera, tick = 0) {
    if (!camera) return '';
    const base = currentConfig.snapshotBase;

    // CH factory: use camera_code in path
    if (base.includes('/snapshot') && !base.includes('/proxy/snapshot')) {
        return `${base}/${encodeURIComponent(camera.code)}?_=${tick}`;
    }

    // VG factory fallback (proxy via ip) - UNCHANGED
    const u = new URL(base);
    u.searchParams.set('ip', camera.ip || '');
    u.searchParams.set('_', String(tick));
    return u.toString();
}

/**
 * Inspector Fullscreen Component - fullscreen overlay mode
 * @param {Object} props
 * @param {Object} props.inspector - inspector state
 * @param {number} props.snapTick - snapshot refresh tick (VG only; CH self-manages via ref)
 * @param {Function} props.onClose
 * @param {Function} props.onToggleFullscreen
 */
function InspectorFullscreen({
    inspector,
    onClose,
    onToggleFullscreen,
}) {
    const { t } = useTranslation("common");
    const [snapTick, setSnapTick] = React.useState(0);

    React.useEffect(() => {
        if (!inspector.open || !inspector.camera || inspector.mode !== 'fullscreen') return;

        const intervalId = setInterval(() => {
            setSnapTick((v) => v + 1);
        }, REFRESH_INTERVAL);

        return () => clearInterval(intervalId);
    }, [inspector.open, inspector.camera, inspector.mode]);

    if (!inspector.open || !inspector.camera || inspector.mode !== 'fullscreen') {
        return null;
    }

    const isInspector360 =
        !FISHEYE_EXCEPT_CODES.includes(inspector.camera.code) &&
        (inspector.camera.type === 'cam360' ||
            inspector.camera.type === 'cam360_upper');

    return (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60">
            <div className="w-full h-full bg-slate-950/95 flex flex-col rounded-none shadow-2xl border border-slate-800/60">
                {/* Header */}
                <div className="h-10 px-4 flex items-center justify-between bg-slate-900 border-b border-slate-700">
                    <div className="text-xs md:text-sm font-semibold text-slate-100 truncate">
                        {inspector.camera.code || `Camera #${inspector.camera.id}`}
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onToggleFullscreen}
                            className="p-1 rounded-full hover:bg-slate-800 text-slate-200"
                        >
                            <FiMaximize2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                            onClick={onClose}
                            className="p-1 rounded-full hover:bg-red-600/80 text-slate-200"
                        >
                            <FiX className="w-3.5 h-3.5" />
                        </button>
                    </div>
                </div>

                {/* Snapshot zone */}
                <div className="flex-1 bg-black flex items-center justify-center overflow-hidden relative">
                    {(inspector.camera.isSensor || inspector.camera.type === 'sensor' || inspector.camera.type?.startsWith('sensor_')) ? (
                        // Sensor Display
                        <div className="flex flex-col items-center justify-center p-8 text-slate-300">
                            <div className="flex gap-8 mb-6">
                                <div className="flex flex-col items-center gap-2">
                                    <div className="text-4xl font-bold text-orange-400">
                                        {inspector.camera.currentReading?.temperature ?? "--"}°C
                                    </div>
                                    <div className="text-sm opacity-60">{t("sensor.temperature")}</div>
                                </div>
                                <div className="w-px bg-slate-700 h-16 mx-2" />
                                <div className="flex flex-col items-center gap-2">
                                    <div className="text-4xl font-bold text-sky-400">
                                        {inspector.camera.currentReading?.humidity ?? "--"}%
                                    </div>
                                    <div className="text-sm opacity-60">{t("sensor.humidity")}</div>
                                </div>
                            </div>

                            {inspector.camera.sensorConfig && (
                                <div className="text-xs text-slate-500 bg-slate-900/50 p-3 rounded-lg border border-slate-800">
                                    <p>{t("sensor.alertThreshold")}:</p>
                                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-1">
                                        <span>{t("sensor.temperature")}: {inspector.camera.sensorConfig.temp_low ?? 0} - {inspector.camera.sensorConfig.temp_high ?? 100}°C</span>
                                        <span>{t("sensor.humidity")}: {inspector.camera.sensorConfig.hum_low ?? 0} - {inspector.camera.sensorConfig.hum_high ?? 100}%</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : isInspector360 ? (
                        <FisheyeQuadView
                            snapshotUrl={buildSnapshotUrl(inspector.camera, snapTick)}
                            cameraCode={inspector.camera.code}
                        />
                    ) : (
                        <img
                            src={buildSnapshotUrl(inspector.camera, snapTick)}
                            alt={`Camera snapshot ${inspector.camera.code || inspector.camera.id}`}
                            className="max-w-full max-h-full object-contain"
                            onError={() => {
                                console.warn('Snapshot load error for camera:', inspector.camera.code || inspector.camera.ip);
                            }}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}

export default React.memo(InspectorFullscreen);

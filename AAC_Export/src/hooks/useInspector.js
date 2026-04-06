import { useState, useEffect, useCallback, useRef } from 'react';
import { currentConfig } from '../config/factoryConfig';

const DEFAULT_INSPECTOR_SIZE = { width: 720, height: 440 };
const IS_CH = currentConfig.factoryId === 'ch';
const SNAPSHOT_REFRESH_INTERVAL = IS_CH ? 2500 : 500; // CH takes longer to fetch direct HTTP

/**
 * Hook quản lý inspector state
 * @returns {Object} inspector state và methods
 */
export function useInspector() {
    const [inspector, setInspector] = useState({
        open: false,
        camera: null,
        mode: 'window', // 'window' | 'fullscreen'
        x: 80,
        y: 80,
        width: DEFAULT_INSPECTOR_SIZE.width,
        height: DEFAULT_INSPECTOR_SIZE.height,
    });

    const prevWindowRectRef = useRef(null);

    const openInspector = useCallback((camera) => {
        if (typeof window === 'undefined') {
            setInspector((prev) => ({ ...prev, open: true, camera }));
            return;
        }

        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const w = DEFAULT_INSPECTOR_SIZE.width;
        const h = DEFAULT_INSPECTOR_SIZE.height;

        setInspector({
            open: true,
            camera,
            mode: 'window',
            x: (vw - w) / 2,
            y: (vh - h) / 2,
            width: w,
            height: h,
        });
        prevWindowRectRef.current = null;
    }, []);

    const closeInspector = useCallback(() => {
        setInspector((prev) => ({
            ...prev,
            open: false,
            camera: null,
            mode: 'window',
        }));
        prevWindowRectRef.current = null;
    }, []);

    const toggleFullscreen = useCallback(() => {
        setInspector((prev) => {
            if (prev.mode !== 'fullscreen') {
                // Lưu lại rect window trước khi fullscreen
                prevWindowRectRef.current = {
                    x: prev.x,
                    y: prev.y,
                    width: prev.width,
                    height: prev.height,
                };

                return {
                    ...prev,
                    mode: 'fullscreen',
                };
            }

            // Từ fullscreen về window
            const restore = prevWindowRectRef.current || {
                x: 80,
                y: 80,
                width: DEFAULT_INSPECTOR_SIZE.width,
                height: DEFAULT_INSPECTOR_SIZE.height,
            };

            return {
                ...prev,
                mode: 'window',
                ...restore,
            };
        });
    }, []);

    const updateInspectorPosition = useCallback((x, y) => {
        setInspector((prev) => ({ ...prev, x, y }));
    }, []);

    const updateInspectorSize = useCallback((width, height, x, y) => {
        setInspector((prev) => ({ ...prev, width, height, x, y }));
    }, []);

    return {
        inspector,
        openInspector,
        closeInspector,
        toggleFullscreen,
        updateInspectorPosition,
        updateInspectorSize,
    };
}

import { useState, useEffect, useCallback } from 'react';
import { currentConfig } from '../config/factoryConfig';

// Helper: map CCTV row
function mapCctvRow(row) {
    let loc = row.location_json || row.location || {};
    if (typeof loc === 'string') {
        try {
            loc = JSON.parse(loc);
        } catch {
            loc = {};
        }
    }

    return {
        code: row.camera_code || row.code || '',
        status: row.status || '',
        location_json: loc,
    };
}

/**
 * Hook để fetch danh sách camera chưa map
 * @returns {Object} { allCctv, totalUnmapped, loading, error, setAllCctv }
 */
export function useUnmappedCameras() {
    const [allCctv, setAllCctv] = useState([]);
    const [totalUnmapped, setTotalUnmapped] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchUnmapped = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`${currentConfig.apiBase}/layout/unmapped`, {
                method: 'GET',
            });

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            const data = await res.json();

            let cameraList = [];
            // Handle different formats: VG wraps in { ret_code, data }, CH returns direct array
            if (currentConfig.factoryId === 'vg') {
                if (data.ret_code !== 0 || !Array.isArray(data.data)) {
                    throw new Error('Invalid CCTV list response (VG)');
                }
                cameraList = data.data;
                if (typeof data.total_unmapped === 'number') {
                    setTotalUnmapped(data.total_unmapped);
                }
            } else {
                // CH factory
                if (Array.isArray(data)) {
                    cameraList = data;
                    setTotalUnmapped(data.length);
                } else if (data && data.ret_code === 0 && Array.isArray(data.data)) {
                    cameraList = data.data;
                    setTotalUnmapped(typeof data.total_unmapped === 'number' ? data.total_unmapped : data.data.length);
                } else {
                    throw new Error('Invalid CCTV list response (CH)');
                }
            }

            const mapped = cameraList.map(mapCctvRow);

            setAllCctv((prev) => {
                // Giữ lại các sensor từ state cũ
                const sensors = prev.filter((c) => c.isSensor);
                return [...mapped, ...sensors];
            });

            setLoading(false);
            setError(null);
        } catch (err) {
            console.error('Load CCTV list failed:', err);
            setError(err);
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchUnmapped();
    }, [fetchUnmapped]);

    return {
        allCctv,
        setAllCctv,
        totalUnmapped,
        loading,
        error,
        fetchUnmapped,
    };
}

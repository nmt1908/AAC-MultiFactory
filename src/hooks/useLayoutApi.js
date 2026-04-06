import { useState, useEffect, useCallback } from 'react';
import { currentConfig } from '../config/factoryConfig';

const CCTV_API_BASE = currentConfig.apiBase;

const DEFAULT_RANGES = {
    upper: 100,
    lower: 100,
    cam360: 30,
    cam360_upper: 30,
};

// Helper: map layout row to camera object
function mapLayoutRowToCamera(row) {
    const camType = row.cam_type;
    const isTri = camType === 'upper' || camType === 'lower' || camType?.startsWith('floor');
    const isCircle = camType === 'cam360' || camType === 'cam360_upper';

    let loc = row.location_json || row.location || {};
    if (typeof loc === 'string') {
        try {
            loc = JSON.parse(loc);
        } catch {
            loc = {};
        }
    }

    return {
        id: row.id,
        type: camType,
        code: row.camera_code,
        x: Number(row.x_percent),
        y: Number(row.y_percent),
        range: isTri
            ? Number(row.view_distance ?? DEFAULT_RANGES[camType] ?? 100)
            : undefined,
        angle: isTri ? Number(row.view_angle ?? 0) : 0,
        radius: isCircle
            ? Number(row.view_radius ?? DEFAULT_RANGES.cam360)
            : undefined,
        hasLayout: true,
        created_at: row.created_at || null,
        status: row.status || '',
        location_json: loc,
        ip: row.ip || '',
    };
}

// Helper: map camera to payload
function mapCameraToPayload(cam) {
    const isTri = cam.type === 'upper' || cam.type === 'lower' || cam.type?.startsWith('floor');
    const isCircle = cam.type === 'cam360' || cam.type === 'cam360_upper';

    return {
        camera_code: cam.code,
        cam_type: cam.type,
        sensor_type: cam.isSensor ? cam.sensor_type : null,
        x_percent: cam.x,
        y_percent: cam.y,
        view_distance: isTri ? cam.range ?? null : null,
        view_angle: isTri ? cam.angle ?? 0 : null,
        view_radius: isCircle ? cam.radius ?? null : null,
    };
}

/**
 * Hook quản lý camera layout API
 * @returns {Object} { cameras, loading, error, fetchLayout, saveLayout, deleteCamera }
 */
export function useLayoutApi() {
    const [cameras, setCameras] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchLayout = useCallback(async () => {
        setLoading(true);
        try {
            const res = await fetch(`${CCTV_API_BASE}/layout/get`, {
                method: 'GET',
            });

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            const data = await res.json();
            if (data.ret_code !== 0 || !Array.isArray(data.data)) {
                throw new Error('Invalid layout response');
            }

            const mappedCams = data.data.map(mapLayoutRowToCamera);

            // Map sensors từ layout
            const layoutSensors = Array.isArray(data.sensors)
                ? data.sensors
                    .filter((s) => s.x_percent !== null && s.y_percent !== null)
                    .map((s) => ({
                        id: `sensor-${s.device_id}`,
                        code: s.device_id,
                        x: Number(s.x_percent),
                        y: Number(s.y_percent),
                        type: 'sensor',
                        status: 'active',
                        isSensor: true,
                        sensor_type: s.sensor_type || 'upper',
                        sensorStatus: 'off',
                        hasLayout: true, // Important: sensor from DB has layout
                        created_at: s.created_at || null,
                    }))
                : [];

            setCameras([...mappedCams, ...layoutSensors]);
            setLoading(false);
            setError(null);
        } catch (err) {
            console.error('Load CCTV layout failed:', err);
            setError(err);
            setLoading(false);
        }
    }, []);

    const saveLayout = useCallback(async (camerasToSave) => {
        try {
            const payload = camerasToSave
                .filter((cam) => cam.code && cam.code.trim() && !cam.isSensor)
                .map(mapCameraToPayload);

            const res = await fetch(`${CCTV_API_BASE}/layout/save`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    items: payload,
                }),
            });

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            const data = await res.json();
            if (data.ret_code !== 0) {
                throw new Error(data.msg || 'Save layout failed');
            }

            return { success: true };
        } catch (err) {
            console.error('Save CCTV layout failed:', err);
            throw err;
        }
    }, []);

    const deleteCamera = useCallback(async (cameraCode) => {
        try {
            const res = await fetch(`${CCTV_API_BASE}/layout/delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    camera_code: cameraCode,
                }),
            });

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            const data = await res.json();
            if (data.ret_code !== 0) {
                throw new Error(data.msg || 'Delete layout failed');
            }

            return { success: true };
        } catch (err) {
            console.error('Delete layout failed:', err);
            throw err;
        }
    }, []);

    const deleteSensor = useCallback(async (deviceId) => {
        try {
            const res = await fetch(`${CCTV_API_BASE}/layout/deleteSensor`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    device_id: deviceId,
                }),
            });

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            const data = await res.json();
            if (data.ret_code !== 0) {
                throw new Error(data.msg || 'Delete sensor layout failed');
            }

            return { success: true };
        } catch (err) {
            console.error('Delete sensor layout failed:', err);
            throw err;
        }
    }, []);

    // Fetch layout on mount
    useEffect(() => {
        fetchLayout();
    }, [fetchLayout]);

    return {
        cameras,
        setCameras,
        loading,
        error,
        fetchLayout,
        saveLayout,
        deleteCamera,
        deleteSensor,
    };
}

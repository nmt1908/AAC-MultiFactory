import { useState, useEffect, useCallback } from 'react';
import { currentConfig } from '../config/factoryConfig';

const SENSOR_API_BASE = currentConfig.sensorApiBase;
const SENSOR_CONFIG_BASE = currentConfig.sensorConfigBase;
const CCTV_API_BASE = currentConfig.apiBase;

// Helper: map sensor to payload
function mapSensorToPayload(cam) {
    return {
        device_id: cam.code,
        location: cam.location_json?.vi || cam.code,
        x_percent: cam.x,
        y_percent: cam.y,
        sensor_type: cam.sensor_type || 'upper',
    };
}

/**
 * Hook quản lý sensor API
 * @returns {Object} { sensorDetails, loading, error, saveSensorLayout, addSensorsToAllCctv }
 */
export function useSensorApi() {
    const [sensorDetails, setSensorDetails] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const fetchSensorList = useCallback(async () => {
        setLoading(true);
        try {
            const [readingsRes, configsRes] = await Promise.all([
                fetch(SENSOR_API_BASE).catch(() => null),
                fetch(SENSOR_CONFIG_BASE).catch(() => null)
            ]);

            if (!readingsRes || !readingsRes.ok) {
                throw new Error(`HTTP Readings Failed`);
            }

            const data = await readingsRes.json();
            if (data.status !== 'success' || !Array.isArray(data.data)) {
                throw new Error('Invalid sensor response format');
            }

            // Fetch and parse configs if available
            let configMap = {};
            let allConfigs = [];
            if (configsRes && configsRes.ok) {
                try {
                    const configsData = await configsRes.json();
                    if (Array.isArray(configsData)) {
                        allConfigs = configsData;
                        configsData.forEach(cfg => {
                            if (cfg.device_id) {
                                configMap[cfg.device_id] = cfg;
                            }
                        });
                    }
                } catch (e) {
                    console.error('Failed to parse sensor configs', e);
                }
            }

            // Create a map to ensure unique devices and merge data
            const combinedMap = new Map();

            // 1. First add all sensors from configs (Source of truth for existing devices)
            allConfigs.forEach(cfg => {
                if (cfg.device_id && !cfg.device_id.toUpperCase().includes('CCTV')) {
                    combinedMap.set(cfg.device_id, {
                        device_id: cfg.device_id,
                        location: cfg.location || '',
                        sensor_type: cfg.sensor_type || 'upper',
                        sensorConfig: cfg
                    });
                }
            });

            // 2. Merge readings data into the map
            data.data.forEach(s => {
                if (s.device_id && !s.device_id.toUpperCase().includes('CCTV')) {
                    if (combinedMap.has(s.device_id)) {
                        // Merge reading with existing config data
                        const existing = combinedMap.get(s.device_id);
                        combinedMap.set(s.device_id, {
                            ...existing,    // preserve config default fields
                            ...s,           // overwrite with latest reading fields
                            sensorConfig: existing.sensorConfig // ensure config object is kept
                        });
                    } else {
                        // Sensor has reading but no config
                        combinedMap.set(s.device_id, {
                            ...s,
                            sensorConfig: configMap[s.device_id]
                        });
                    }
                }
            });

            const filteredData = Array.from(combinedMap.values());

            setSensorDetails(filteredData);
            setLoading(false);
            setError(null);
        } catch (err) {
            console.error('Load sensor list failed:', err);
            setError(err);
            setLoading(false);
        }
    }, []);

    const saveSensorLayout = useCallback(async (sensorsToSave) => {
        try {
            const payload = sensorsToSave
                .filter((cam) => cam.isSensor && cam.code && cam.code.trim())
                .map(mapSensorToPayload);

            const res = await fetch(`${CCTV_API_BASE}/layout/saveSensor`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items: payload }),
            });

            if (!res.ok) throw new Error(`HTTP ${res.status}`);

            const data = await res.json();
            if (data.ret_code !== 0) {
                throw new Error(data.msg || 'Save sensor failed');
            }

            return { success: true };
        } catch (err) {
            console.error('Save sensor layout failed:', err);
            throw err;
        }
    }, []);

    // Helper để add sensors vào allCctv list
    const getSensorListForAllCctv = useCallback(() => {
        return sensorDetails.map((s) => ({
            code: s.device_id,
            status: s.status || 'active',
            location_json: {
                vi: s.location || '',
                en: s.location || '',
                cn: s.location || '',
            },
            isSensor: true,
            sensor_type: s.sensor_type || 'upper',
            type: 'sensor',
        }));
    }, [sensorDetails]);

    useEffect(() => {
        fetchSensorList();
    }, [fetchSensorList]);

    return {
        sensorDetails,
        loading,
        error,
        saveSensorLayout,
        getSensorListForAllCctv,
    };
}

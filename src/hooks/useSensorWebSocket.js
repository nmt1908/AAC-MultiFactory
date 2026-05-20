import { useState, useEffect, useRef } from 'react';
import { currentConfig } from '../config/factoryConfig';

const DEFAULT_WS_URL = currentConfig.sensorWsBase;
const RECONNECT_DELAY = 5000; // 5 seconds

/**
 * Hook quản lý WebSocket connection cho sensor data
 * @param {string} wsUrl - WebSocket URL (optional, default to sensor server)
 * @returns {Object} sensorReadings - { device_id: { temperature, humidity, timestamp, receivedAt } }
 */
export function useSensorWebSocket(wsUrl = DEFAULT_WS_URL) {
    const [sensorReadings, setSensorReadings] = useState({});
    const wsRef = useRef(null);
    const reconnectTimerRef = useRef(null);

    useEffect(() => {
        const connect = () => {
            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = () => {
                // console.log('✅ Sensor WebSocket connected');
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);

                    if (data.device_id) {
                        const newReading = {
                            temperature: data.temperature,
                            humidity: data.humidity,
                            timestamp: data.timestamp || new Date().toISOString(),
                            receivedAt: Date.now(), // Client-side arrival timestamp
                        };

                        setSensorReadings((prev) => ({
                            ...prev,
                            [data.device_id]: newReading,
                        }));
                    }
                } catch (err) {
                    console.error('Parse WS message failed:', err);
                }
            };

            ws.onclose = () => {
                // console.warn('❌ Sensor WebSocket disconnected, retrying in 5s...');
                reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY);
            };

            ws.onerror = (err) => {
                console.error('WebSocket error:', err);
                ws.close();
            };
        };

        connect();

        // Cleanup
        return () => {
            if (wsRef.current) {
                wsRef.current.close();
            }
            if (reconnectTimerRef.current) {
                clearTimeout(reconnectTimerRef.current);
            }
        };
    }, [wsUrl]);

    return { sensorReadings, setSensorReadings };
}

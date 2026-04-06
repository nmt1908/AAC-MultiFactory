import { useState, useEffect, useRef } from 'react';
import { currentConfig } from '../config/factoryConfig';

const CCTV_API_BASE = currentConfig.apiBase;
const WARNING_IMAGE_BASE = currentConfig.storageBase;
const WARNING_WINDOW_SECONDS = 4 * 60 * 60; // 4 hours
const POLLING_INTERVAL = 5000; // 5 seconds

/**
 * Hook để polling alerts từ API
 * @param {Array} seenAlertIds - danh sách alert IDs đã xem
 * @param {boolean} editMode - edit mode state
 * @param {Object} viewCamera - camera đang view
 * @param {Object} viewedAlert - alert đang xem trong dialog
 * @param {Function} onPanelStateChange - callback khi cần thay đổi panel state
 * @returns {Object} { alerts, loading, error }
 */
export function useAlertsApi(seenAlertIds, editMode, viewCamera, viewedAlert, onPanelStateChange) {
    const [alerts, setAlerts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    // Track previous unseen IDs to detect NEW unseen alerts
    const prevUnseenIdsRef = useRef(new Set());

    useEffect(() => {
        const fetchAlerts = async () => {
            try {
                const res = await fetch(`${CCTV_API_BASE}/warning/recent`, {
                    method: 'GET',
                });

                if (!res.ok) throw new Error(`HTTP ${res.status}`);

                const data = await res.json();
                if (data.ret_code !== 0 || !Array.isArray(data.data)) {
                    throw new Error('Invalid warning response');
                }

                const nowSec = Math.floor(Date.now() / 1000);
                const fourHoursAgo = nowSec - WARNING_WINDOW_SECONDS;

                // Lọc 4 giờ gần nhất
                const filtered = data.data.filter((ev) => {
                    if (typeof ev.created_unix !== 'number') return true;
                    return ev.created_unix >= fourHoursAgo;
                });

                // Sort mới → cũ
                filtered.sort((a, b) => (b.created_unix || 0) - (a.created_unix || 0));

                // Map thumbnail
                const mapped = filtered.map((ev) => {
                    const showThumb = true; // tạm thời luôn show để debug

                    return {
                        ...ev,
                        thumbUrl:
                            showThumb && ev.thumbshot_url
                                ? `${WARNING_IMAGE_BASE}${ev.thumbshot_url}`
                                : null,
                        fullUrl: ev.fullshot_url
                            ? `${WARNING_IMAGE_BASE}${ev.fullshot_url}`
                            : null,
                    };
                });

                // Tính số alert CHƯA XEM
                const seenSet = new Set(seenAlertIds || []);
                const unseenAlerts = mapped.filter((ev) =>
                    ev.id == null ? true : !seenSet.has(ev.id)
                );

                // Get current unseen IDs
                const currentUnseenIds = new Set(unseenAlerts.map(a => a.id).filter(id => id != null));

                // Check if there are NEW unseen alerts (not in previous set)
                const hasNewUnseen = Array.from(currentUnseenIds).some(id => !prevUnseenIdsRef.current.has(id));

                // Update ref for next comparison
                prevUnseenIdsRef.current = currentUnseenIds;

                setAlerts(mapped);
                setLoading(false);
                setError(null);

                // Auto open/close panel - only open when NEW unseen alerts appear
                if (onPanelStateChange) {
                    if (hasNewUnseen && unseenAlerts.length > 0) {
                        // Có alert MỚI chưa xem
                        if (!editMode) {
                            onPanelStateChange({
                                isPanelOpen: true,
                                viewCamera: null
                            });
                        }
                    } else if (unseenAlerts.length === 0) {
                        // Không còn alert chưa xem
                        if (!editMode && !viewCamera && !viewedAlert) {
                            onPanelStateChange({ isPanelOpen: false });
                        }
                    }
                }
            } catch (err) {
                console.error('Polling warning events failed:', err);
                setError(err);
                setLoading(false);
            }
        };

        fetchAlerts(); // gọi lần đầu

        const intervalId = setInterval(fetchAlerts, POLLING_INTERVAL);
        return () => clearInterval(intervalId);
    }, [seenAlertIds, editMode, viewCamera, viewedAlert, onPanelStateChange]);

    return { alerts, loading, error };
}

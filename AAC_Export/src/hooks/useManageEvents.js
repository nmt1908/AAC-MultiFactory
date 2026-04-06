import { useState, useEffect, useCallback, useRef } from 'react';
import { currentConfig } from '../config/factoryConfig';

const API_JSON_URL = `${currentConfig.apiBase}/getManageWarnings`;

export function useManageEvents({ initialPage = 1, initialPerPage = 20 } = {}) {
    // Data State
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // Pagination State
    const [pagination, setPagination] = useState({
        currentPage: initialPage,
        totalPages: 1,
        total: 0,
        perPage: initialPerPage,
        hasNext: false,
        hasPrev: false,
    });

    // Filter State
    const [filters, setFilters] = useState(() => {
        const d = new Date();
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        const todayStr = `${year}-${month}-${day}`;

        return {
            cameraCode: '',
            eventCode: 'all',
            fromDate: todayStr,
            toDate: todayStr,
        };
    });

    // Counts State
    const [counts, setCounts] = useState({
        all: 0,
        smartphone: 0,
        intruder: 0,
        fire: 0,
        crowb: 0,
        crowb2: 0,
    });

    const fetchEvents = useCallback(async (pageOverride = null, filtersOverride = null) => {
        setLoading(true);
        setError(null);

        const page = pageOverride || pagination.currentPage;
        const currentFilters = filtersOverride || filters;

        try {
            // Build Request Body (JSON)
            const body = {
                page: page,
                per_page: pagination.perPage,
                sort_by: 'created_at',
                sort_order: 'desc',
            };

            if (currentFilters.cameraCode) body.camera_code = currentFilters.cameraCode;
            if (currentFilters.eventCode && currentFilters.eventCode !== 'all') body.event_code = currentFilters.eventCode;
            if (currentFilters.fromDate) body.from_date = currentFilters.fromDate;
            if (currentFilters.toDate) body.to_date = currentFilters.toDate;

            const response = await fetch(API_JSON_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                throw new Error(`API Error: ${response.status}`);
            }

            const data = await response.json();

            if (data.ret_code === 0) {
                setEvents(data.data.items || []);
                // Update Counts if available
                if (data.data.counts) {
                    setCounts(prev => ({
                        ...prev,
                        ...data.data.counts
                    }));
                }

                setPagination(prev => ({
                    ...prev,
                    currentPage: data.data.pagination.current_page,
                    totalPages: data.data.pagination.total_pages,
                    total: data.data.pagination.total,
                    hasNext: data.data.pagination.has_next,
                    hasPrev: data.data.pagination.has_prev,
                }));
            } else {
                throw new Error(data.msg || 'Unknown error');
            }
        } catch (err) {
            console.error("Fetch Events Error:", err);
            setError(err.message);
            setEvents([]);
        } finally {
            setLoading(false);
        }
    }, [pagination.currentPage, pagination.perPage, filters]);

    // Initial Fetch & Refetch on pagination change
    useEffect(() => {
        fetchEvents();
    }, [fetchEvents]);

    // Actions
    const goToPage = (page) => {
        if (page < 1 || page > pagination.totalPages) return;
        setPagination(prev => ({ ...prev, currentPage: page }));
    };

    const updateFilters = (newFilters) => {
        setFilters(prev => ({ ...prev, ...newFilters }));
        setPagination(prev => ({ ...prev, currentPage: 1 }));
    };

    const updateEventStatus = async (eventId, status) => {
        try {
            const response = await fetch(`${currentConfig.apiBase}/updateEventStatus`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: eventId, status })
            });
            const data = await response.json();
            if (data.ret_code === 0) {
                // Refresh local state or just refetch
                fetchEvents();
                return { success: true };
            } else {
                return { success: false, msg: data.msg };
            }
        } catch (err) {
            console.error("Update status failed:", err);
            return { success: false, msg: err.message };
        }
    };

    return {
        events,
        loading,
        error,
        pagination,
        filters,
        counts,
        goToPage,
        updateFilters,
        fetchEvents,
        updateEventStatus
    };
}

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
    IoClose, IoFilter, IoArrowBackOutline, IoAlertCircle,
    IoDownload, IoSearch, IoMenu, IoCalendarOutline,
    IoVideocamOutline, IoChevronBackOutline, IoSettingsOutline,
    IoPencilOutline, IoCheckmarkCircleOutline, IoAddCircleOutline,
    IoSaveOutline, IoRefreshOutline, IoEyeOutline, IoEyeOffOutline,
    IoNotificationsOutline, IoNotificationsOffOutline
} from 'react-icons/io5';
import EventCard from '../components/EventCard';
import { useManageEvents } from '../hooks/useManageEvents';
import Pagination from '../components/Pagination';
import DateRangePicker from '../components/DateRangePicker';
import BoundingBoxOverlay from '../components/BoundingBoxOverlay';
import { currentConfig } from '../config/factoryConfig';

const WARNING_IMAGE_BASE = currentConfig.storageBase;

export default function ManageEvents({ onClose }) {
    const { t, i18n } = useTranslation('common');
    const {
        events,
        loading,
        pagination,
        filters,
        counts,
        goToPage,
        updateFilters,
        updateEventStatus
    } = useManageEvents({ initialPerPage: 16 });

    const [selectedEvent, setSelectedEvent] = useState(null);
    const [downloading, setDownloading] = useState(false);
    const [showImageViewer, setShowImageViewer] = useState(false);
    const [imgDims, setImgDims] = useState({ w: 0, h: 0 });
    const [zoomedImgDims, setZoomedImgDims] = useState({ w: 0, h: 0 });

    const [activeTab, setActiveTab] = useState('events'); // 'events' | 'cctv_list' | 'ai_config'
    const [isSidebarOpen, setIsSidebarOpen] = useState(true);

    const [manageCams, setManageCams] = useState([]);
    const [camsLoading, setCamsLoading] = useState(false);
    const [editingCam, setEditingCam] = useState(null);
    const [isAddingCam, setIsAddingCam] = useState(false);
    const [newCam, setNewCam] = useState({
        code: '',
        ip: '',
        username: 'admin',
        password: '',
        threshold: 0.6,
        location: { vi: '', en: '', cn: '' }
    });
    const [updateStatus, setUpdateStatus] = useState({ type: '', message: '' });
    const [camSearchTerm, setCamSearchTerm] = useState('');
    const [camSortField, setCamSortField] = useState('id');
    const [camSortOrder, setCamSortOrder] = useState('ASC');
    const [showCamSettings, setShowCamSettings] = useState(false);
    const [camPagination, setCamPagination] = useState({
        currentPage: 1,
        perPage: 20,
        total: 0,
        totalPages: 1
    });
    const [configuringAi, setConfiguringAi] = useState(null);
    const [camStats, setCamStats] = useState({ total: 0, online: 0, warning: 0, offline: 0 });
    const [visiblePasswords, setVisiblePasswords] = useState({});

    const togglePasswordVisibility = (id) => {
        setVisiblePasswords(prev => ({
            ...prev,
            [id]: !prev[id]
        }));
    };

    const fetchCams = async (page = 1) => {
        setCamsLoading(true);
        try {
            const isVG = currentConfig.factoryId === 'vg';
            const endpoint = isVG ? '/getCctvList' : '/list';
            const method = isVG ? 'POST' : 'GET';

            const url = new URL(`${currentConfig.apiBase}${endpoint}`);
            const options = {
                method,
                headers: { 'Content-Type': 'application/json' }
            };

            const params = {
                page,
                per_page: camPagination.perPage,
                sort_field: camSortField,
                sort_order: camSortOrder,
                search: camSearchTerm || undefined
            };

            if (method === 'POST') {
                options.body = JSON.stringify(params);
            } else {
                Object.entries(params).forEach(([key, val]) => {
                    if (val !== undefined) url.searchParams.append(key, val);
                });
            }

            console.log(`DEBUG: fetchCams (${method}) URL:`, url.toString());
            const response = await fetch(url, options);
            const data = await response.json();

            if (data.ret_code === 0) {
                setManageCams(data.data);
                if (data.stats) {
                    setCamStats(data.stats);
                }
                if (data.pagination) {
                    setCamPagination({
                        currentPage: data.pagination.current_page,
                        perPage: data.pagination.per_page,
                        total: data.pagination.total,
                        totalPages: data.pagination.total_pages
                    });
                }
            }
        } catch (err) {
            console.error('Failed to fetch cams:', err);
        } finally {
            setCamsLoading(false);
        }
    };

    const handleAddCam = async () => {
        try {
            const response = await fetch(`${currentConfig.apiBase}/ai/add_camera`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...newCam,
                    location: JSON.stringify(newCam.location)
                })
            });
            const data = await response.json();
            if (data.ret_code === 0) {
                setUpdateStatus({ type: 'success', message: 'Added camera successfully!' });
                fetchCams(1);
                setTimeout(() => {
                    setIsAddingCam(false);
                    setUpdateStatus({ type: '', message: '' });
                    setNewCam({
                        code: '',
                        ip: '',
                        username: 'admin',
                        password: '',
                        threshold: 0.6,
                        location: { vi: '', en: '', cn: '' }
                    });
                }, 1500);
            } else {
                setUpdateStatus({ type: 'error', message: data.msg || 'Failed to add camera' });
            }
        } catch (err) {
            setUpdateStatus({ type: 'error', message: err.message });
        }
    };

    const handleUpdateCam = async (e) => {
        e.preventDefault();
        setUpdateStatus({ type: 'loading', message: 'Updating...' });
        try {
            const response = await fetch(`${currentConfig.apiBase}/ai/update_camera`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: editingCam.id,
                    code: editingCam.code,
                    username: editingCam.username,
                    password: editingCam.password,
                    ip: editingCam.ip,
                    threshold: editingCam.threshold,
                    is_monitored: editingCam.is_monitored ? 1 : 0,
                    alert_muted: editingCam.alert_muted ? 1 : 0,
                    location: typeof editingCam.location === 'object' ? JSON.stringify(editingCam.location) : editingCam.location
                })
            });
            const data = await response.json();
            if (data.ret_code === 0) {
                setUpdateStatus({ type: 'success', message: 'Updated successfully!' });
                fetchCams();
                setTimeout(() => {
                    setEditingCam(null);
                    setUpdateStatus({ type: '', message: '' });
                }, 1500);
            } else {
                setUpdateStatus({ type: 'error', message: data.msg || 'Update failed' });
            }
        } catch (err) {
            setUpdateStatus({ type: 'error', message: err.message || 'Update failed' });
        }
    };

    useEffect(() => {
        const calculatePerPage = () => {
            const height = window.innerHeight;
            // Tối ưu hóa khoảng trống: trừ ít hơn và dùng rowHeight nhỏ hơn một chút
            const tableHeight = height - 280;
            const rowHeight = 52;
            const calculated = Math.max(10, Math.floor(tableHeight / rowHeight));
            setCamPagination(prev => ({ ...prev, perPage: calculated }));
        };

        calculatePerPage();
        window.addEventListener('resize', calculatePerPage);
        return () => window.removeEventListener('resize', calculatePerPage);
    }, []);

    useEffect(() => {
        if (activeTab === 'cctv_list') fetchCams(1);
    }, [activeTab, camSearchTerm, camSortField, camSortOrder, camPagination.perPage]);

    useEffect(() => {
        setImgDims({ w: 0, h: 0 });
        setZoomedImgDims({ w: 0, h: 0 });
    }, [selectedEvent?.id]);

    const displayEvents = events.map(ev => ({
        ...ev,
        get thumbUrl() { return ev.thumbshot_url ? `${WARNING_IMAGE_BASE}${ev.thumbshot_url}` : null; },
        get fullUrl() { return ev.fullshot_url ? `${WARNING_IMAGE_BASE}${ev.fullshot_url}` : null; },
    }));

    const getEventLabel = (eventCode) => {
        const key = `alerts.events.${eventCode}`;
        const translated = t(key);
        return translated !== key ? translated : eventCode;
    };

    const getEventColor = (eventCode) => {
        switch (eventCode) {
            case 'fire': return 'bg-red-100 text-red-700 border-red-300';
            case 'intruder': return 'bg-yellow-100 text-yellow-700 border-yellow-300';
            case 'smartphone': return 'bg-green-100 text-green-700 border-green-300';
            case 'crowb': return 'bg-purple-100 text-purple-700 border-purple-300';
            case 'crowb2': return 'bg-blue-100 text-blue-700 border-blue-300';
            default: return 'bg-gray-100 text-gray-700 border-gray-300';
        }
    };

    const formatTime = (unixTime) => {
        if (!unixTime) return 'N/A';
        const date = new Date(unixTime * 1000);
        return date.toLocaleString('vi-VN', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
        });
    };

    const handleSort = (field) => {
        if (camSortField === field) {
            setCamSortOrder(camSortOrder === 'ASC' ? 'DESC' : 'ASC');
        } else {
            setCamSortField(field);
            setCamSortOrder('ASC');
        }
    };

    const parseLocation = (loc) => {
        if (!loc) return 'N/A';
        try {
            const parsed = typeof loc === 'string' ? JSON.parse(loc) : loc;
            if (typeof parsed !== 'object' || parsed === null) return loc;

            // Map i18n language to JSON keys (vi, en, cn)
            let lang = i18n.language || 'vi';
            if (lang.startsWith('zh')) lang = 'cn';
            else if (lang.startsWith('en')) lang = 'en';
            else if (lang.startsWith('vi')) lang = 'vi';

            return parsed[lang] || parsed['vi'] || parsed['en'] || Object.values(parsed)[0] || loc;
        } catch (e) {
            return loc;
        }
    };

    const filteredCams = manageCams.filter(cam => {
        const term = camSearchTerm.toLowerCase();
        const locStr = parseLocation(cam.location).toLowerCase();
        return cam.code.toLowerCase().includes(term) || locStr.includes(term);
    });

    const handleAckAlert = async (code) => {
        try {
            const response = await fetch(`${currentConfig.apiBase}/acknowledge_alert`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ camera_code: code })
            });
            const data = await response.json();
            if (data.ret_code === 0) {
                fetchCams(camPagination.currentPage);
            }
        } catch (err) {
            console.error("Ack alert failed:", err);
        }
    };

    const handleDownload = async (url, filename) => {
        if (!url) return;
        setDownloading(true);
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error('Network response was not ok');

            const blob = await response.blob();
            const blobUrl = window.URL.createObjectURL(blob);

            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = filename || `event_${Date.now()}.jpg`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(blobUrl);
        } catch (err) {
            console.error('Download failed:', err);
            alert(t('manageEvents.downloadFailed', 'Download failed. Please try again.'));
        } finally {
            setDownloading(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-slate-50 overflow-hidden flex z-50 font-sans">
            {/* Sidebar */}
            <div className={`
                ${isSidebarOpen ? 'w-64' : 'w-0'} 
                bg-slate-900 text-slate-300 flex flex-col transition-all duration-300 ease-in-out overflow-hidden shadow-2xl
            `}>
                <div className="p-6 border-b border-slate-800 flex flex-col gap-1 flex-shrink-0">
                    <h1 className="text-xl font-bold text-white tracking-tight">Management</h1>
                    <p className="text-xs text-slate-500 uppercase font-semibold tracking-widest">CCTV Control Center</p>
                </div>

                <nav className="flex-1 py-4 overflow-y-auto px-3 space-y-1">
                    <button
                        onClick={() => {
                            setActiveTab('events');
                            setIsSidebarOpen(false);
                        }}
                        className={`
                            w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all
                            ${activeTab === 'events'
                                ? 'bg-slate-800 text-white shadow-inner ring-1 ring-white/10'
                                : 'hover:bg-slate-800/50 hover:text-white'}
                        `}
                    >
                        <IoCalendarOutline size={20} />
                        <span className="font-medium text-sm">{t('manageEvents.title')}</span>
                    </button>

                    <button
                        onClick={() => {
                            setActiveTab('cctv_list');
                            setIsSidebarOpen(false);
                        }}
                        className={`
                            w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all
                            ${activeTab === 'cctv_list'
                                ? 'bg-slate-800 text-white shadow-inner ring-1 ring-white/10'
                                : 'hover:bg-slate-800/50 hover:text-white'}
                        `}
                    >
                        <IoVideocamOutline size={20} />
                        <span className="font-medium text-sm">{t('manageEvents.cctvList')}</span>
                    </button>

                    <button
                        onClick={() => {
                            setActiveTab('ai_config');
                            setIsSidebarOpen(false);
                        }}
                        className={`
                            w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all
                            ${activeTab === 'ai_config'
                                ? 'bg-slate-800 text-white shadow-inner ring-1 ring-white/10'
                                : 'hover:bg-slate-800/50 hover:text-white'}
                        `}
                    >
                        <IoSettingsOutline size={20} />
                        <span className="font-medium text-sm">{t('manageEvents.aiConfig')}</span>
                    </button>
                </nav>

                <div className="p-4 border-t border-slate-800">
                    <button
                        onClick={onClose}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition-all font-medium text-sm"
                    >
                        <IoChevronBackOutline size={20} />
                        {t('manageEvents.exit')}
                    </button>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-w-0 bg-white shadow-inner relative">
                {/* Header */}
                <div className="flex items-center justify-between px-3 py-3 border-b border-slate-200 bg-white h-14 flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                            className="p-2 hover:bg-slate-100 rounded-lg transition-colors text-slate-600"
                            aria-label="Toggle Sidebar"
                        >
                            <IoMenu size={24} />
                        </button>
                        <div>
                            <h2 className="text-lg font-bold text-slate-900 leading-tight">
                                {activeTab === 'events' && t('manageEvents.title')}
                                {activeTab === 'cctv_list' && t('manageEvents.cctvList')}
                                {activeTab === 'ai_config' && t('manageEvents.aiConfig')}
                            </h2>
                        </div>
                    </div>

                    {activeTab === 'events' && (
                        <div className="flex items-center gap-3 text-xs font-medium text-slate-500 bg-slate-50 px-3 py-1.5 rounded-full border border-slate-100">
                            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                            Live Events
                        </div>
                    )}
                </div>

                {/* Switchable Content */}
                {activeTab === 'events' ? (
                    <>
                        {/* Filters Toolbar */}
                        <div className="px-3 py-2 border-b border-slate-200 bg-slate-50 flex flex-wrap gap-2 items-center flex-shrink-0 shadow-sm">
                            <DateRangePicker
                                fromDate={filters.fromDate}
                                toDate={filters.toDate}
                                onChange={(from, to) => updateFilters({ fromDate: from, toDate: to })}
                            />

                            <div className="relative group">
                                <IoSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-600 transition-colors" />
                                <input
                                    type="text"
                                    placeholder={t('manageEvents.filters.searchPlaceholder')}
                                    value={filters.cameraCode}
                                    onChange={(e) => updateFilters({ cameraCode: e.target.value })}
                                    className="pl-9 pr-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-slate-900/5 focus:border-slate-400 w-[180px] transition-all"
                                />
                            </div>

                            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar ml-auto">
                                <IoFilter size={16} className="text-slate-400 mr-1" />
                                {[
                                    { key: 'all', label: t('alerts.filter.all') },
                                    { key: 'smartphone', label: t('alerts.filter.smartphone') },
                                    { key: 'intruder', label: t('alerts.filter.intruder') },
                                    { key: 'fire', label: t('alerts.filter.fire') },
                                    { key: 'crowb', label: t('alerts.filter.crowb') },
                                    { key: 'crowb2', label: t('alerts.filter.crowb2') },
                                ].map(({ key, label }) => (
                                    <button
                                        key={key}
                                        onClick={() => updateFilters({ eventCode: key })}
                                        className={`
                                            px-4 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap flex items-center gap-2 border
                                            ${filters.eventCode === key
                                                ? 'bg-slate-900 text-white shadow-lg shadow-slate-900/20 border-slate-900'
                                                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400 hover:text-slate-900'
                                            }
                                        `}
                                    >
                                        <span>{label}</span>
                                        <span className={`text-[10px] min-w-[1.25rem] px-1 rounded-full ${filters.eventCode === key ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
                                            }`}>
                                            {counts && counts[key] !== undefined ? counts[key] : 0}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* List Content */}
                        <div className="flex-1 overflow-hidden flex relative bg-slate-50/50">
                            <div className={`
                                flex-1 flex flex-col overflow-hidden transition-all duration-300 ease-in-out
                                ${selectedEvent ? 'mr-[24rem]' : 'mr-0'} 
                            `}>
                                <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
                                    {loading ? (
                                        <div className="flex flex-col items-center justify-center h-full gap-4">
                                            <span className="loading loading-spinner loading-lg text-slate-400"></span>
                                            <div className="text-slate-400 font-medium text-sm tracking-wide">{t('manageEvents.loading')}</div>
                                        </div>
                                    ) : displayEvents.length === 0 ? (
                                        <div className="flex flex-col items-center justify-center h-full text-slate-300">
                                            <div className="p-8 rounded-full bg-white shadow-sm border border-slate-100 mb-4">
                                                <IoAlertCircle size={64} className="text-slate-200" />
                                            </div>
                                            <p className="text-lg font-bold text-slate-400 px-4 text-center">{t('manageEvents.empty.title', 'No events found')}</p>
                                        </div>
                                    ) : (
                                        <div className={`
                                            grid gap-6 pb-6
                                            grid-cols-1 md:grid-cols-2 
                                            ${selectedEvent
                                                ? 'lg:grid-cols-2 xl:grid-cols-3'
                                                : 'lg:grid-cols-3 xl:grid-cols-4 xxl:grid-cols-5'
                                            }
                                        `}>
                                            {displayEvents.map((event) => (
                                                <EventCard
                                                    key={event.id}
                                                    event={event}
                                                    onClick={() => setSelectedEvent(event)}
                                                    getEventLabel={getEventLabel}
                                                    getEventColor={getEventColor}
                                                    formatTime={formatTime}
                                                    selected={selectedEvent?.id === event.id}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Pagination */}
                                {!loading && displayEvents.length > 0 && (
                                    <div className="border-t border-slate-200 bg-white flex-shrink-0 z-10 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
                                        <Pagination
                                            currentPage={pagination.currentPage}
                                            totalPages={pagination.totalPages}
                                            hasNext={pagination.hasNext}
                                            hasPrev={pagination.hasPrev}
                                            totalItems={pagination.total}
                                            onPageChange={goToPage}
                                        />
                                    </div>
                                )}
                            </div>

                            {/* Sidebar Detail */}
                            <div className={`
                                w-[24rem] border-l border-slate-200 flex flex-col bg-white shadow-2xl z-20 
                                absolute top-0 right-0 bottom-0 h-full
                                transform transition-transform duration-300 ease-in-out
                                ${selectedEvent ? 'translate-x-0' : 'translate-x-full'}
                            `}>
                                {selectedEvent && (
                                    <>
                                        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-white h-16">
                                            <h3 className="font-bold text-slate-900">{t('manageEvents.eventDetail')}</h3>
                                            <button
                                                onClick={() => setSelectedEvent(null)}
                                                className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-slate-900"
                                            >
                                                <IoClose size={22} />
                                            </button>
                                        </div>

                                        <div className="flex-1 overflow-y-auto p-5 space-y-6">
                                            {selectedEvent.fullUrl && (
                                                <div
                                                    className="rounded-2xl overflow-hidden border border-slate-200 cursor-zoom-in group relative shadow-md bg-slate-900"
                                                    onClick={() => setShowImageViewer(true)}
                                                >
                                                    <img
                                                        src={selectedEvent.fullUrl}
                                                        alt="Full event"
                                                        className="w-full h-64 object-contain transition-transform duration-500 group-hover:scale-105"
                                                        loading="lazy"
                                                        onLoad={(e) => {
                                                            setImgDims({ w: e.target.naturalWidth, h: e.target.naturalHeight });
                                                        }}
                                                    />
                                                    <BoundingBoxOverlay boxes={selectedEvent.boxes} imgDims={imgDims} />
                                                    <div className="absolute inset-x-0 bottom-0 p-4 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <span className="text-white text-xs font-semibold flex items-center gap-2">
                                                            <IoSearch size={14} /> Click to zoom
                                                        </span>
                                                    </div>
                                                </div>
                                            )}

                                            <div className="space-y-4">
                                                <div className="bg-slate-50 rounded-2xl p-5 border border-slate-100 space-y-5">
                                                    <div>
                                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t('manageEvents.eventType')}</label>
                                                        <div className="mt-2">
                                                            <span className={`inline-block px-3 py-1.5 rounded-xl text-xs font-bold border-2 ${getEventColor(selectedEvent.event_code)}`}>
                                                                {getEventLabel(selectedEvent.event_code)}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-6">
                                                        <div>
                                                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t('manageEvents.camera')}</label>
                                                            <p className="text-sm font-black text-slate-900 mt-1">{selectedEvent.camera_code || 'N/A'}</p>
                                                        </div>
                                                        <div>
                                                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t('manageEvents.id')}</label>
                                                            <p className="text-sm font-mono font-bold text-slate-500 mt-1">#{selectedEvent.id}</p>
                                                        </div>
                                                    </div>
                                                    <div>
                                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{t('manageEvents.time')}</label>
                                                        <p className="text-sm font-semibold text-slate-700 mt-1">{formatTime(selectedEvent.created_unix)}</p>
                                                    </div>
                                                </div>

                                                {currentConfig.factoryId === 'vg' &&
                                                    ['smartphone', 'intruder', 'fire'].includes(selectedEvent.event_code) &&
                                                    !selectedEvent.status && (
                                                        <div className="pt-4 border-t border-slate-100">
                                                            <label className="text-[10px] font-bold text-slate-400 capitalize tracking-widest block mb-3">
                                                                {t('manageEvents.feedback.title')}
                                                            </label>
                                                            <div className="grid grid-cols-2 gap-3">
                                                                <button
                                                                    onClick={async () => {
                                                                        setDownloading(true);
                                                                        const res = await updateEventStatus(selectedEvent.id, 'true');
                                                                        if (res.success) {
                                                                            setSelectedEvent(prev => ({ ...prev, status: 'true' }));
                                                                        }
                                                                        setDownloading(false);
                                                                    }}
                                                                    disabled={downloading}
                                                                    className="flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all border-2 bg-white text-green-600 border-green-600 hover:bg-green-50"
                                                                >
                                                                    <IoCheckmarkCircleOutline size={18} />
                                                                    {t('manageEvents.feedback.correct')}
                                                                </button>
                                                                <button
                                                                    onClick={async () => {
                                                                        setDownloading(true);
                                                                        const res = await updateEventStatus(selectedEvent.id, 'fail');
                                                                        if (res.success) {
                                                                            setSelectedEvent(prev => ({ ...prev, status: 'fail' }));
                                                                        }
                                                                        setDownloading(false);
                                                                    }}
                                                                    disabled={downloading}
                                                                    className="flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm transition-all border-2 bg-white text-red-600 border-red-600 hover:bg-red-50"
                                                                >
                                                                    <IoClose size={18} />
                                                                    {t('manageEvents.feedback.incorrect')}
                                                                </button>
                                                            </div>
                                                        </div>
                                                    )}

                                                {selectedEvent.status && (
                                                    <div className="pt-4 border-t border-slate-100">
                                                        <label className="text-[10px] font-bold text-slate-400 capitalize tracking-widest block mb-3">
                                                            {t('manageEvents.feedback.title')}
                                                        </label>
                                                        <div className={`
                                                            flex items-center justify-center gap-2 py-3 rounded-xl font-bold text-sm border-2
                                                            ${selectedEvent.status === 'true'
                                                                ? 'bg-green-50 text-green-700 border-green-200'
                                                                : 'bg-red-50 text-red-700 border-red-200'}
                                                        `}>
                                                            {selectedEvent.status === 'true' ? <IoCheckmarkCircleOutline size={18} /> : <IoClose size={18} />}
                                                            {selectedEvent.status === 'true' ? t('manageEvents.feedback.correct') : t('manageEvents.feedback.incorrect')}
                                                        </div>
                                                    </div>
                                                )}

                                                {selectedEvent.fullUrl && (
                                                    <button
                                                        onClick={() => handleDownload(selectedEvent.fullUrl, `event_${selectedEvent.camera_code}_${selectedEvent.id}.jpg`)}
                                                        disabled={downloading}
                                                        className="w-full py-4 rounded-2xl bg-slate-900 text-white font-bold text-sm shadow-xl shadow-slate-900/20 hover:bg-slate-800 active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-3 transition-all"
                                                    >
                                                        {downloading ? <span className="loading loading-spinner loading-xs"></span> : <IoDownload size={18} />}
                                                        {downloading ? t('manageEvents.downloading') : t('manageEvents.downloadImage')}
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    </>
                ) : activeTab === 'cctv_list' ? (
                    <div className="flex-1 overflow-hidden flex flex-col bg-slate-50 p-2">
                        <div className="bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden flex flex-col h-full">
                            {/* Health Stats Summary */}
                            <div className="grid grid-cols-4 gap-2 p-2 bg-slate-50/50 border-b border-slate-100">
                                <div className="bg-white p-2 rounded-xl border border-slate-200 shadow-sm">
                                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-tight">{t('manageEvents.stats.total')}</p>
                                    <p className="text-xl font-black text-slate-900 mt-1">{camStats.total}</p>
                                </div>
                                <div className="bg-white p-2 rounded-xl border border-green-100 shadow-sm">
                                    <p className="text-[9px] font-bold text-green-500 uppercase tracking-widest leading-tight">{t('manageEvents.stats.online')}</p>
                                    <div className="flex items-center gap-2 mt-1">
                                        <p className="text-xl font-black text-green-600">{camStats.online}</p>
                                        <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse shadow-[0_0_8px_rgba(34,197,94,0.4)]" />
                                    </div>
                                </div>
                                <div className="bg-white p-2 rounded-xl border border-orange-100 shadow-sm">
                                    <p className="text-[9px] font-bold text-orange-500 uppercase tracking-widest leading-tight">{t('manageEvents.stats.warning')}</p>
                                    <p className="text-xl font-black text-orange-600 mt-1">{camStats.warning}</p>
                                </div>
                                <div className="bg-white p-2 rounded-xl border border-red-100 shadow-sm">
                                    <p className="text-[9px] font-bold text-red-500 uppercase tracking-widest leading-tight">{t('manageEvents.stats.offline')}</p>
                                    <p className="text-xl font-black text-red-600 mt-1">{camStats.offline}</p>
                                </div>
                            </div>

                            <div className="flex items-center justify-between gap-4 py-3 border-b border-slate-100 bg-slate-50/10 px-3">
                                <div className="flex items-center gap-2 text-slate-400 group">
                                    <IoVideocamOutline size={18} />
                                    <h3 className="text-sm font-bold text-slate-800 tracking-tight">{t('manageEvents.cctvList')}</h3>
                                </div>

                                <div className="flex items-center gap-3">
                                    <div className="relative group w-64">
                                        <IoSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-slate-900 transition-colors" size={14} />
                                        <input
                                            type="text"
                                            placeholder={t('manageEvents.filters.searchPlaceholder')}
                                            value={camSearchTerm}
                                            onChange={(e) => setCamSearchTerm(e.target.value)}
                                            className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:ring-4 focus:ring-slate-900/5 focus:border-slate-400 transition-all outline-none"
                                        />
                                    </div>
                                    <button
                                        onClick={() => {
                                            setUpdateStatus({ type: '', message: '' });
                                            setIsAddingCam(true);
                                        }}
                                        className="flex items-center gap-2 px-4 py-2 bg-slate-900 text-white rounded-lg hover:bg-slate-800 transition-all shadow-lg shadow-slate-900/10 text-[11px] font-bold"
                                    >
                                        <IoAddCircleOutline size={16} />
                                        {t('manageEvents.addCamera')}
                                    </button>
                                </div>
                            </div>

                            <div className="flex-1 overflow-auto">
                                <table className="w-full text-left border-collapse min-w-[1200px]">
                                    <thead className="sticky top-0 bg-white z-10">
                                        <tr className="text-[10px] uppercase font-bold text-slate-500 bg-slate-100/80 shadow-sm border-b border-slate-200">
                                            <th className="px-4 py-4 border-r border-slate-200/50 cursor-pointer hover:bg-slate-200/50 transition-colors group" onClick={() => handleSort('id')}>
                                                <div className="flex items-center justify-between gap-1">
                                                    ID
                                                    <span className={`transition-opacity ${camSortField === 'id' ? 'opacity-100' : 'opacity-0 group-hover:opacity-30'}`}>
                                                        {camSortOrder === 'ASC' ? '↑' : '↓'}
                                                    </span>
                                                </div>
                                            </th>
                                            <th className="px-4 py-4 border-r border-slate-200/50 cursor-pointer hover:bg-slate-200/50 transition-colors group" onClick={() => handleSort('code')}>
                                                <div className="flex items-center justify-between gap-1">
                                                    {t('manageEvents.table.code')}
                                                    <span className={`transition-opacity ${camSortField === 'code' ? 'opacity-100' : 'opacity-0 group-hover:opacity-30'}`}>
                                                        {camSortOrder === 'ASC' ? '↑' : '↓'}
                                                    </span>
                                                </div>
                                            </th>
                                            <th className="px-4 py-4 border-r border-slate-200/50 cursor-pointer hover:bg-slate-200/50 transition-colors group" onClick={() => handleSort('cctv_status')}>
                                                <div className="flex items-center justify-between gap-1 text-[9px]">
                                                    Status
                                                    <span className={`transition-opacity ${camSortField === 'cctv_status' ? 'opacity-100' : 'opacity-0 group-hover:opacity-30'}`}>
                                                        {camSortOrder === 'ASC' ? '↑' : '↓'}
                                                    </span>
                                                </div>
                                            </th>
                                            <th className="px-4 py-4 border-r border-slate-200/50">{t('manageEvents.table.location')}</th>
                                            <th className="px-4 py-4 border-r border-slate-200/50 cursor-pointer hover:bg-slate-200/50 transition-colors group" onClick={() => handleSort('username')}>
                                                <div className="flex items-center justify-between gap-1">
                                                    {t('manageEvents.table.username')}
                                                    <span className={`transition-opacity ${camSortField === 'username' ? 'opacity-100' : 'opacity-0 group-hover:opacity-30'}`}>
                                                        {camSortOrder === 'ASC' ? '↑' : '↓'}
                                                    </span>
                                                </div>
                                            </th>
                                            <th className="px-4 py-4 border-r border-slate-200/50">{t('manageEvents.table.password')}</th>
                                            <th className="px-4 py-4 border-r border-slate-200/50 cursor-pointer hover:bg-slate-200/50 transition-colors group" onClick={() => handleSort('ip')}>
                                                <div className="flex items-center justify-between gap-1">
                                                    {t('manageEvents.table.ip')}
                                                    <span className={`transition-opacity ${camSortField === 'ip' ? 'opacity-100' : 'opacity-0 group-hover:opacity-30'}`}>
                                                        {camSortOrder === 'ASC' ? '↑' : '↓'}
                                                    </span>
                                                </div>
                                            </th>
                                            <th className="px-4 py-4 border-r border-slate-200/50 cursor-pointer hover:bg-slate-200/50 transition-colors group" onClick={() => handleSort('threshold')}>
                                                <div className="flex items-center justify-between gap-1">
                                                    {t('manageEvents.table.threshold')}
                                                    <span className={`transition-opacity ${camSortField === 'threshold' ? 'opacity-100' : 'opacity-0 group-hover:opacity-30'}`}>
                                                        {camSortOrder === 'ASC' ? '↑' : '↓'}
                                                    </span>
                                                </div>
                                            </th>
                                            <th className="px-4 py-4 border-r border-slate-200/50 cursor-pointer hover:bg-slate-200/50 transition-colors group" onClick={() => handleSort('created_at')}>
                                                <div className="flex items-center justify-between gap-1">
                                                    {t('manageEvents.table.createdAt')}
                                                    <span className={`transition-opacity ${camSortField === 'created_at' ? 'opacity-100' : 'opacity-0 group-hover:opacity-30'}`}>
                                                        {camSortOrder === 'ASC' ? '↑' : '↓'}
                                                    </span>
                                                </div>
                                            </th>
                                            <th className="px-4 py-4 border-r border-slate-200/50 cursor-pointer hover:bg-slate-200/50 transition-colors group" onClick={() => handleSort('updated_at')}>
                                                <div className="flex items-center justify-between gap-1">
                                                    {t('manageEvents.table.updatedAt')}
                                                    <span className={`transition-opacity ${camSortField === 'updated_at' ? 'opacity-100' : 'opacity-0 group-hover:opacity-30'}`}>
                                                        {camSortOrder === 'ASC' ? '↑' : '↓'}
                                                    </span>
                                                </div>
                                            </th>
                                            <th className="px-4 py-4 text-center">{t('manageEvents.table.actions')}</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {manageCams.map((cam) => (
                                            <tr key={cam.id} className="hover:bg-blue-50/50 even:bg-slate-50/30 transition-colors group">
                                                <td className="px-4 py-4 text-xs font-mono text-slate-400 border-r border-slate-100">#{cam.id}</td>
                                                <td className="px-4 py-4 text-sm font-bold text-slate-900 border-r border-slate-100">{cam.code}</td>
                                                <td className="px-4 py-4 border-r border-slate-100">
                                                    <div className="flex items-center gap-2 min-w-[70px]">
                                                        <div className={`w-2 h-2 rounded-full ${cam.cctv_status === 'online' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' :
                                                            cam.cctv_status === 'warning' ? 'bg-orange-500 animate-pulse' :
                                                                'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.4)]'
                                                            }`} />
                                                        <span className={`text-[10px] font-bold uppercase ${cam.cctv_status === 'online' ? 'text-green-600' :
                                                            cam.cctv_status === 'warning' ? 'text-orange-600' :
                                                                'text-red-600'
                                                            }`}>
                                                            {cam.cctv_status || 'online'}
                                                        </span>
                                                        {cam.alert_muted === 1 && (
                                                            <div className="text-slate-400" title="Alert Muted">
                                                                <IoNotificationsOffOutline size={10} />
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-4 py-4 text-sm text-slate-600 font-medium border-r border-slate-100">{parseLocation(cam.location)}</td>
                                                <td className="px-4 py-4 text-xs text-slate-500 border-r border-slate-100">{cam.username}</td>
                                                <td className="px-4 py-4 text-xs text-slate-500 font-mono border-r border-slate-100">
                                                    <div className="flex items-center gap-2">
                                                        <span>{visiblePasswords[cam.id] ? cam.password : '••••••••'}</span>
                                                        <button
                                                            onClick={() => togglePasswordVisibility(cam.id)}
                                                            className="text-slate-400 hover:text-slate-600 transition-colors"
                                                            title={visiblePasswords[cam.id] ? "Hide Password" : "Show Password"}
                                                        >
                                                            {visiblePasswords[cam.id] ? <IoEyeOffOutline size={14} /> : <IoEyeOutline size={14} />}
                                                        </button>
                                                    </div>
                                                </td>
                                                <td className="px-4 py-4 text-xs text-slate-600 font-mono border-r border-slate-100">{cam.ip}</td>
                                                <td className="px-4 py-4 border-r border-slate-100">
                                                    <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-bold border border-slate-200">
                                                        {cam.threshold}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-4 text-[10px] text-slate-400 border-r border-slate-100">{cam.created_at}</td>
                                                <td className="px-4 py-4 text-[10px] text-slate-400 border-r border-slate-100">{cam.updated_at}</td>
                                                <td className="px-4 py-4 text-center">
                                                    <div className="flex items-center justify-center gap-2">
                                                        <button
                                                            onClick={() => {
                                                                setUpdateStatus({ type: '', message: '' });
                                                                setEditingCam({ ...cam });
                                                            }}
                                                            className="p-2 bg-white text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-900 hover:text-white hover:border-slate-900 transition-all shadow-sm flex items-center gap-2 text-[10px] font-bold"
                                                        >
                                                            <IoPencilOutline size={12} />
                                                            {t('manageEvents.edit')}
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                setConfiguringAi(cam);
                                                                setActiveTab('ai_config');
                                                                setIsSidebarOpen(false);
                                                            }}
                                                            className="p-2 bg-white text-blue-600 border border-slate-200 rounded-lg hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-all shadow-sm flex items-center gap-2 text-[10px] font-bold"
                                                            title={t('manageEvents.aiConfig')}
                                                        >
                                                            <IoSettingsOutline size={12} />
                                                            AI Config
                                                        </button>
                                                        {cam.alert_muted ? (
                                                            <button
                                                                className="p-2 border rounded-lg transition-all shadow-sm flex items-center gap-2 text-[10px] font-bold bg-slate-100 text-slate-400 border-slate-200 cursor-default"
                                                                title="Alert Muted"
                                                                disabled
                                                            >
                                                                <IoNotificationsOffOutline size={12} />
                                                                {t('manageEvents.alertMuted')}
                                                            </button>
                                                        ) : cam.cctv_status !== 'online' ? (
                                                            <button
                                                                onClick={() => handleAckAlert(cam.code)}
                                                                className="p-2 border rounded-lg transition-all shadow-sm flex items-center gap-2 text-[10px] font-bold bg-white text-orange-600 border-slate-200 hover:bg-orange-50 hover:border-orange-200"
                                                                title="Đã tiếp nhận thông tin lỗi"
                                                            >
                                                                <IoNotificationsOutline size={12} />
                                                                {t('manageEvents.checkCamera')}
                                                            </button>
                                                        ) : null}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* CCTV Pagination */}
                            {!camsLoading && manageCams.length > 0 && (
                                <div className="border-t border-slate-200 bg-white flex-shrink-0 z-10">
                                    <Pagination
                                        currentPage={camPagination.currentPage}
                                        totalPages={camPagination.totalPages}
                                        hasNext={camPagination.currentPage < camPagination.totalPages}
                                        hasPrev={camPagination.currentPage > 1}
                                        totalItems={camPagination.total}
                                        onPageChange={(page) => fetchCams(page)}
                                    />
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    /* AI Config Content */
                    <div className="flex-1 overflow-hidden relative bg-slate-100 p-4">
                        <div className="w-full h-full bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden relative">
                            <iframe
                                src={`ai_config.html?v=1.0.2&api_base=${encodeURIComponent(currentConfig.apiBase)}&camera_code=${encodeURIComponent(configuringAi?.code || '')}`}
                                className="w-full h-full"
                                title="CCTV AI Config"
                                style={{ border: 'none' }}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Edit Camera Modal */}
            {editingCam && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm">
                    <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200 animate-in fade-in zoom-in duration-200">
                        <div className="flex items-center justify-between p-6 border-b border-slate-100 bg-slate-50/50">
                            <h3 className="text-xl font-bold text-slate-900">{t('manageEvents.table.editTitle')}</h3>
                            <button onClick={() => setEditingCam(null)} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400">
                                <IoClose size={24} />
                            </button>
                        </div>

                        <form onSubmit={handleUpdateCam} className="p-6 space-y-6">
                            <div className="space-y-4 max-h-[60vh] overflow-y-auto px-1 pr-3 scrollbar-thin scrollbar-thumb-slate-200">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">{t('manageEvents.table.code')}</label>
                                        <input
                                            type="text"
                                            value={editingCam.code}
                                            onChange={(e) => setEditingCam({ ...editingCam, code: e.target.value })}
                                            className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-4 focus:ring-slate-900/5 focus:border-slate-400 transition-all font-bold text-slate-900 uppercase"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">{t('manageEvents.table.ip')}</label>
                                        <input
                                            type="text"
                                            value={editingCam.ip}
                                            onChange={(e) => setEditingCam({ ...editingCam, ip: e.target.value })}
                                            className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-4 focus:ring-slate-900/5 focus:border-slate-400 transition-all font-mono"
                                            placeholder="10.x.x.x"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">{t('manageEvents.table.username')}</label>
                                        <input
                                            type="text"
                                            value={editingCam.username || ''}
                                            onChange={(e) => setEditingCam({ ...editingCam, username: e.target.value })}
                                            className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-4 focus:ring-slate-900/5 focus:border-slate-400 transition-all text-sm"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">{t('manageEvents.table.password')}</label>
                                        <input
                                            type="text"
                                            value={editingCam.password || ''}
                                            onChange={(e) => setEditingCam({ ...editingCam, password: e.target.value })}
                                            className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-4 focus:ring-slate-900/5 focus:border-slate-400 transition-all text-sm"
                                        />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">{t('manageEvents.table.threshold')}</label>
                                        <input
                                            type="number"
                                            step="0.01"
                                            value={editingCam.threshold || 0}
                                            onChange={(e) => setEditingCam({ ...editingCam, threshold: parseFloat(e.target.value) })}
                                            className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-4 focus:ring-slate-900/5 focus:border-slate-400 transition-all"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">{t('manageEvents.table.updatedAt')}</label>
                                        <input
                                            type="text"
                                            value={editingCam.updated_at || ''}
                                            disabled
                                            className="w-full px-4 py-3 bg-slate-100 border border-slate-200 rounded-xl text-slate-400 text-xs font-mono cursor-not-allowed"
                                        />
                                    </div>
                                </div>

                                <div>
                                    <label className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl border border-slate-200 cursor-pointer hover:bg-slate-100 transition-colors group mb-4">
                                        <div className="relative inline-flex items-center">
                                            <input
                                                type="checkbox"
                                                checked={!!editingCam.is_monitored}
                                                onChange={(e) => setEditingCam({ ...editingCam, is_monitored: e.target.checked ? 1 : 0 })}
                                                className="sr-only"
                                            />
                                            <div className={`w-10 h-5 rounded-full transition-colors ${editingCam.is_monitored ? 'bg-slate-900' : 'bg-slate-300'}`}>
                                                <div className={`absolute top-1 left-1.5 w-3 h-3 bg-white rounded-full transition-transform ${editingCam.is_monitored ? 'translate-x-4' : ''}`} />
                                            </div>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[10px] font-black text-slate-900 uppercase tracking-tight">Giám sát sức khỏe</span>
                                            <span className="text-[9px] text-slate-400 font-bold">Tự động báo Mail nếu camera mất hình quá 1 phút</span>
                                        </div>
                                    </label>
                                </div>

                                <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">{t('manageEvents.table.location')}</label>
                                    <div className="space-y-2">
                                        {['vi', 'en', 'cn'].map(lang => (
                                            <div key={lang} className="flex items-center gap-2">
                                                <span className="w-8 text-[10px] font-bold text-slate-300 uppercase">{lang}</span>
                                                <input
                                                    type="text"
                                                    value={(() => {
                                                        try {
                                                            const loc = typeof editingCam.location === 'string' ? JSON.parse(editingCam.location) : editingCam.location;
                                                            return (loc && loc[lang]) || '';
                                                        } catch (e) { return ''; }
                                                    })()}
                                                    onChange={(e) => {
                                                        let newLoc = {};
                                                        try {
                                                            newLoc = typeof editingCam.location === 'string' ? JSON.parse(editingCam.location) : editingCam.location;
                                                            if (typeof newLoc !== 'object' || newLoc === null) newLoc = {};
                                                        } catch (err) { newLoc = {}; }
                                                        newLoc[lang] = e.target.value;
                                                        setEditingCam({ ...editingCam, location: newLoc });
                                                    }}
                                                    className="flex-1 px-3 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-slate-900/5 focus:border-slate-400 text-xs transition-all"
                                                    placeholder={`Location in ${lang}`}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {updateStatus.message && (
                                <div className={`p-4 rounded-xl flex items-center gap-3 text-sm font-bold ${updateStatus.type === 'error' ? 'bg-red-50 text-red-500' :
                                    updateStatus.type === 'success' ? 'bg-green-50 text-green-600' : 'bg-slate-50 text-slate-500'
                                    }`}>
                                    {updateStatus.type === 'loading' ? <span className="loading loading-spinner loading-xs"></span> : <IoCheckmarkCircleOutline size={20} />}
                                    {updateStatus.message}
                                </div>
                            )}

                            <div className="flex gap-3 mt-4">
                                <button
                                    type="button"
                                    onClick={() => setEditingCam(null)}
                                    className="flex-1 py-3 px-4 rounded-xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition-all"
                                >
                                    {t('button.cancel')}
                                </button>
                                <button
                                    type="submit"
                                    disabled={updateStatus.type === 'loading'}
                                    className="flex-2 py-3 px-6 rounded-xl bg-slate-900 text-white font-bold hover:bg-slate-800 shadow-xl shadow-slate-900/20 active:scale-95 disabled:opacity-50 transition-all"
                                >
                                    {t('manageEvents.save')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Image Viewer Overlay */}
            {showImageViewer && selectedEvent?.fullUrl && (
                <div
                    className="fixed inset-0 z-[100] bg-slate-950/95 flex items-center justify-center p-4 backdrop-blur-md"
                    onClick={() => setShowImageViewer(false)}
                >
                    <button
                        className="absolute top-8 right-8 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-all hover:rotate-90"
                        onClick={() => setShowImageViewer(false)}
                    >
                        <IoClose size={32} />
                    </button>
                    <div className="relative max-w-full max-h-full transition-all duration-500 scale-100" onClick={e => e.stopPropagation()}>
                        <img
                            src={selectedEvent.fullUrl}
                            className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-[0_0_50px_rgba(255,255,255,0.1)] block border border-white/10"
                            alt="Zoomed Event"
                            onLoad={(e) => {
                                setZoomedImgDims({ w: e.target.naturalWidth, h: e.target.naturalHeight });
                            }}
                        />
                        <BoundingBoxOverlay boxes={selectedEvent.boxes} imgDims={zoomedImgDims} />
                    </div>
                </div>
            )}
            {isAddingCam && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl overflow-hidden border border-slate-100 flex flex-col max-h-[90vh]">
                        <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
                            <div>
                                <h3 className="text-lg font-bold text-slate-900">{t('manageEvents.addCamera')}</h3>
                            </div>
                            <button onClick={() => setIsAddingCam(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400">
                                <IoClose size={24} />
                            </button>
                        </div>

                        <div className="p-6 overflow-y-auto space-y-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Camera Code</label>
                                    <input
                                        type="text"
                                        placeholder="VD: CCTV_99"
                                        value={newCam.code}
                                        onChange={(e) => setNewCam({ ...newCam, code: e.target.value.toUpperCase() })}
                                        className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-4 focus:ring-slate-900/5 focus:border-slate-400 transition-all font-bold text-slate-900 uppercase text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">IP Address</label>
                                    <input
                                        type="text"
                                        placeholder="10.12.x.x"
                                        value={newCam.ip}
                                        onChange={(e) => setNewCam({ ...newCam, ip: e.target.value })}
                                        className="w-full px-4 py-2 border border-slate-200 rounded-xl focus:ring-4 focus:ring-slate-900/5 focus:border-slate-400 transition-all font-mono text-slate-600 text-xs"
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Username</label>
                                    <input
                                        type="text"
                                        value={newCam.username}
                                        onChange={(e) => setNewCam({ ...newCam, username: e.target.value })}
                                        className="w-full px-4 py-2 border border-slate-200 rounded-xl text-xs text-slate-600 bg-slate-50/50"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Password</label>
                                    <input
                                        type="text"
                                        value={newCam.password}
                                        onChange={(e) => setNewCam({ ...newCam, password: e.target.value })}
                                        className="w-full px-4 py-2 border border-slate-200 rounded-xl text-xs text-slate-600 bg-slate-50/50"
                                    />
                                </div>
                            </div>

                            <div>
                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Threshold (AI)</label>
                                <input
                                    type="number"
                                    step="0.1"
                                    min="0"
                                    max="1"
                                    value={newCam.threshold}
                                    onChange={(e) => setNewCam({ ...newCam, threshold: parseFloat(e.target.value) })}
                                    className="w-full px-4 py-2 border border-slate-200 rounded-xl font-bold text-slate-900 text-sm"
                                />
                            </div>

                            <div className="border-t border-slate-100 pt-4">
                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Location</label>
                                <div className="space-y-2">
                                    {['vi', 'en', 'cn'].map(lang => (
                                        <div key={lang} className="flex items-center gap-2">
                                            <span className="w-8 text-[10px] font-bold text-slate-300 uppercase">{lang}</span>
                                            <input
                                                type="text"
                                                value={newCam.location[lang]}
                                                onChange={(e) => {
                                                    const updatedLoc = { ...newCam.location, [lang]: e.target.value };
                                                    setNewCam({ ...newCam, location: updatedLoc });
                                                }}
                                                className="flex-1 px-3 py-1.5 border border-slate-200 rounded-lg text-xs"
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {updateStatus.message && (
                            <div className={`mx-6 p-4 rounded-xl flex items-center gap-3 text-sm font-bold ${updateStatus.type === 'error' ? 'bg-red-50 text-red-500' :
                                updateStatus.type === 'success' ? 'bg-green-50 text-green-600' : 'bg-slate-50 text-slate-500'
                                }`}>
                                {updateStatus.type === 'loading' ? <span className="loading loading-spinner loading-xs"></span> : <IoCheckmarkCircleOutline size={20} />}
                                {updateStatus.message}
                            </div>
                        )}

                        <div className="p-6 bg-slate-50 border-t border-slate-100 flex gap-3">
                            <button
                                onClick={() => setIsAddingCam(false)}
                                className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 rounded-xl hover:bg-white transition-all text-xs font-bold"
                            >
                                {t('manageEvents.cancel')}
                            </button>
                            <button
                                onClick={handleAddCam}
                                className="flex-[2] px-4 py-2 bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-all shadow-xl shadow-slate-900/10 text-xs font-bold flex items-center justify-center gap-2"
                            >
                                <IoSaveOutline size={16} />
                                {t('manageEvents.save')}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

import React from 'react';
import { useTranslation } from 'react-i18next';
import { IoCamera, IoCalendar } from 'react-icons/io5';

/**
 * Event Card Component - displays event information in a card layout
 * @param {Object} props
 * @param {Object} props.event - event data
 * @param {Function} props.onClick - callback when card is clicked
 * @param {Function} props.getEventLabel - function to get translated event label
 * @param {Function} props.getEventColor - function to get event color CSS classes
 * @param {Function} props.formatTime - function to format unix timestamp
 */
export default function EventCard({ event, onClick, getEventLabel, getEventColor, formatTime }) {
    return (
        <div
            className="border border-gray-200 rounded-lg overflow-hidden hover:shadow-lg transition-shadow cursor-pointer"
            onClick={onClick}
        >
            {/* Thumbnail */}
            <div className="relative h-40 bg-gray-100">
                {event.fullUrl ? (
                    <img
                        src={event.fullUrl}
                        alt="Event thumbnail"
                        className="w-full h-full object-cover"
                        onError={(e) => {
                            e.target.style.display = 'none';
                            e.target.parentElement.querySelector('.fallback-icon').style.display = 'flex';
                        }}
                    />
                ) : null}
                <div className="w-full h-full flex items-center justify-center text-gray-400 fallback-icon" style={{ display: event.fullUrl ? 'none' : 'flex' }}>
                    <IoCamera size={48} />
                </div>
            </div>

            {/* Info */}
            <div className="p-3">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className="px-2 py-1 rounded text-xs font-medium border bg-gray-100 text-gray-700 border-gray-300">
                        ID: {event.id}
                    </span>
                    <span
                        className={`inline-block px-2 py-0.5 rounded-lg text-[10px] font-bold border ${getEventColor(event.event_code)}`}
                    >
                        {getEventLabel(event.event_code)}
                    </span>
                </div>

                <div className="text-xs text-gray-600 space-y-1">
                    <div className="flex items-center gap-1">
                        <IoCamera size={12} />
                        <span className="font-medium">{event.camera_code || 'N/A'}</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <IoCalendar size={12} />
                        <span>{formatTime(event.created_unix)}</span>
                    </div>
                </div>
            </div>
        </div>
    );
}

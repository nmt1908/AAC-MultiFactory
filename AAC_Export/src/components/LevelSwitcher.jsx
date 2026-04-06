import { useTranslation } from 'react-i18next';
import { currentConfig } from '../config/factoryConfig';

export default function LevelSwitcher({ selectedFloor, onFloorChange }) {
    const { t } = useTranslation('common');
    const floors = currentConfig.floors || [];

    // Hiển thị nếu có nhiều hơn 1 tầng và flag useLevelSwitcher bật
    if (floors.length <= 1 || !currentConfig.useLevelSwitcher) return null;

    return (
        <div className="flex items-center bg-white shadow-md border border-slate-200 rounded-full h-9 px-1 overflow-hidden">
            {floors.map((floor) => {
                const isActive = selectedFloor === floor.id;
                const floorLabel = floor.id.replace('floor', ''); // Lấy số 1, 2, 3...

                return (
                    <button
                        key={floor.id}
                        onClick={() => onFloorChange(floor.id)}
                        className={`
                            relative h-7 px-3 rounded-full text-[11px] font-bold transition-all duration-200
                            ${isActive
                                ? 'bg-slate-900 text-white shadow-sm'
                                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'}
                        `}
                        title={t(floor.labelKey)}
                    >
                        {floorLabel}
                    </button>
                );
            })}
        </div>
    );
}

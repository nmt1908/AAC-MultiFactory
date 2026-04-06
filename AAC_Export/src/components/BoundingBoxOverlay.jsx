import { useMemo } from 'react';

// Helper Component for Bounding Box
export default function BoundingBoxOverlay({ boxes, imgDims }) {
    // Boxes should be passed directly as array from parent
    const safeBoxes = useMemo(() => {
        try {
            if (!boxes) return [];
            return typeof boxes === 'string' ? JSON.parse(boxes) : boxes;
        } catch (e) {
            console.error("Failed to parse box details:", e);
            return [];
        }
    }, [boxes]);

    if (!imgDims || imgDims.w === 0 || imgDims.h === 0 || safeBoxes.length === 0) return null;

    return (
        <div className="absolute inset-0 pointer-events-none">
            {safeBoxes.map((box, idx) => {
                // Determine style based on confidence or defaults
                const confidence = box.confidence ? Math.round(box.confidence * 100) : null;

                // Calculate position percentages
                const left = (box.x1 / imgDims.w) * 100;
                const top = (box.y1 / imgDims.h) * 100;
                const width = ((box.x2 - box.x1) / imgDims.w) * 100;
                const height = ((box.y2 - box.y1) / imgDims.h) * 100;

                return (
                    <div
                        key={idx}
                        className="absolute border-2 border-red-500 shadow-[0_0_4px_rgba(255,0,0,0.5)] z-10"
                        style={{
                            left: `${left}%`,
                            top: `${top}%`,
                            width: `${width}%`,
                            height: `${height}%`,
                        }}
                    >
                        {confidence !== null && (
                            <span className="absolute -top-6 left-0 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded shadow-sm font-bold">
                                {confidence}%
                            </span>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

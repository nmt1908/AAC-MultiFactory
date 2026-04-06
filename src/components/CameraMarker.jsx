import React, { memo, useMemo } from "react";
import { FaTemperatureQuarter } from "react-icons/fa6";
import { WiHumidity } from "react-icons/wi";
import { useTranslation } from "react-i18next";

const ALERT_COLOR_BY_EVENT = {
  fire: "#ff0d00ff",
  intruder: "#ff9500",
  smartphone: "#34c759",
  crowb: "#ff0044ff",
  crowb2: "#007aff",
  default: "#ff3b30",
};

function CameraMarkerImpl({
  cam,
  cfg,
  showFov,
  editMode,
  selected,
  hovered,
  isHighlighted = false,

  // refs / setters
  cameraRefs,
  setHoveredId,

  // callbacks
  onSelectCamera,
  onInspectCamera,
  onViewCameraDetails,
  onUpdateCamera,
  onBeginDrag,
  onOpenContextMenu,
}) {
  const { t, i18n } = useTranslation("common");
  // normalize key (avoid number vs string mismatch)
  const camKey = useMemo(() => String(cam.id), [cam.id]);

  const isTri = cam.type === "upper" || cam.type === "lower" || cam.type?.startsWith("floor");
  const isCircle = cam.type === "cam360" || cam.type === "cam360_upper" || cam.type?.startsWith("cam360_floor");

  const codeLabel = cam.code || "";
  const showLabelForThis = codeLabel && (selected || hovered);

  const eventCode = cam.alertCode?.toLowerCase?.() || null;
  const alertColor = cam.alertColor
    ? cam.alertColor
    : eventCode
      ? ALERT_COLOR_BY_EVENT[eventCode] || ALERT_COLOR_BY_EVENT.default
      : ALERT_COLOR_BY_EVENT.default;

  let zIndex = 40;
  if (cam.alarm) zIndex += 30;
  if (selected) zIndex += 10;
  if (hovered) zIndex += 20;

  const IconComp = cfg.icon;

  return (
    <div>
      {/* FOV */}
      {showFov && (
        <>
          {isTri && (
            <svg className="absolute overflow-visible pointer-events-none" style={{ left: `${cam.x}%`, top: `${cam.y}%` }}>
              <polygon
                points={`0,0 ${cam.range || 100},-${(cam.range || 100) / 2.6} ${cam.range || 100},${(cam.range || 100) / 2.6}`}
                fill={cfg.fovFill}
                stroke={cfg.fovStroke}
                strokeWidth="2"
                transform={`rotate(${cam.angle || 0})`}
              />
            </svg>
          )}

          {isCircle && (
            <svg className="absolute overflow-visible pointer-events-none" style={{ left: `${cam.x}%`, top: `${cam.y}%` }}>
              <circle cx="0" cy="0" r={cam.radius || 80} fill={cfg.fovFill} stroke={cfg.fovStroke} strokeWidth="2" />
            </svg>
          )}
        </>
      )}

      {/* ICON + LABEL */}
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        style={{ left: `${cam.x}%`, top: `${cam.y}%`, zIndex }}
      >
        {/* Hover/Selected label */}
        {showLabelForThis && (
          <div
            className={`
              absolute left-1/2 bottom-full
              px-2.5 py-1.5 rounded-lg
              text-[11px] font-semibold
              text-white shadow-lg border border-black/10
              pointer-events-none whitespace-nowrap flex flex-col items-center
              ${cam.isSensor
                ? cam.isOff
                  ? "bg-slate-500"
                  : cam.isBreached
                    ? "bg-orange-500"
                    : cfg.bgClass
                : cfg.bgClass
              }
            `}
            style={{
              transform: 'translateX(-50%) scale(var(--labelScale, 1))',
              transformOrigin: 'bottom center',
              bottom: 'calc(100% + 1px * var(--labelScale, 1))',
            }}
          >
            <span>{codeLabel}</span>

            {cam.isSensor && (
              <>
                {cam.isOff ? (
                  <span className="text-[9px] opacity-90 mt-0.5">{t("sensor.disconnected")}</span>
                ) : cam.currentReading ? (
                  <div className="flex flex-col gap-1.5 border-t border-white/20 mt-1 pt-1 w-full">
                    {/* Temperature Row */}
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5">
                        <FaTemperatureQuarter className="w-3.5 h-3.5 text-white flex-shrink-0" />
                        <span className="text-[12px] font-medium">{t("sensor.temperature")}:</span>
                        <span className="text-[12px] font-bold ml-auto">{cam.currentReading.temperature}°C</span>
                      </div>
                      <div className="relative w-full h-[5px] mt-1.5">
                        {/* Triangle marker - positioned ABOVE the bar */}
                        <div
                          className="absolute w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[8px] border-t-red-600"
                          style={{
                            left: `${Math.max(0, Math.min(100, ((cam.currentReading.temperature - (cam.sensorConfig?.temp_low ?? 0)) / ((cam.sensorConfig?.temp_high ?? 100) - (cam.sensorConfig?.temp_low ?? 0))) * 100))}%`,
                            transform: 'translateX(-50%)',
                            top: '-8px'
                          }}
                        />
                        {/* Progress bar */}
                        <div className="w-full h-full rounded-full overflow-hidden" style={{ background: 'linear-gradient(to right, #22c55e 0%, #eab308 50%, #ef4444 100%)' }} />
                      </div>
                      <div className="flex justify-between text-[10px] opacity-75 px-0.5 mt-0.5">
                        <span>{cam.sensorConfig?.temp_low ?? "0"} - {cam.sensorConfig?.temp_high ?? "100"}°C</span>
                        <span className="text-red-300">&gt;{cam.sensorConfig?.temp_high ?? "100"}°C</span>
                      </div>
                    </div>

                    {/* Humidity Row */}
                    <div className="flex flex-col gap-0.5">
                      <div className="flex items-center gap-1.5">
                        <WiHumidity className="w-4 h-4 text-white flex-shrink-0" />
                        <span className="text-[12px] font-medium">{t("sensor.humidity")}:</span>
                        <span className="text-[12px] font-bold ml-auto">{cam.currentReading.humidity}%</span>
                      </div>
                      <div className="relative w-full h-[5px] mt-1.5">
                        {/* Triangle marker - positioned ABOVE the bar */}
                        <div
                          className="absolute w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[8px] border-t-red-600"
                          style={{
                            left: `${Math.max(0, Math.min(100, ((cam.currentReading.humidity - (cam.sensorConfig?.hum_low ?? 0)) / ((cam.sensorConfig?.hum_high ?? 100) - (cam.sensorConfig?.hum_low ?? 0))) * 100))}%`,
                            transform: 'translateX(-50%)',
                            top: '-8px'
                          }}
                        />
                        {/* Progress bar */}
                        <div className="w-full h-full rounded-full overflow-hidden" style={{ background: 'linear-gradient(to right, #22c55e 0%, #eab308 50%, #ef4444 100%)' }} />
                      </div>
                      <div className="flex justify-between text-[10px] opacity-75 px-0.5 mt-0.5">
                        <span>{cam.sensorConfig?.hum_low ?? "0"} - {cam.sensorConfig?.hum_high ?? "100"}%</span>
                        <span className="text-red-300">&gt;{cam.sensorConfig?.hum_high ?? "100"}%</span>
                      </div>
                    </div>

                    {/* Last Update Time */}
                    <div className="text-[11px] opacity-75 text-center mt-1 pt-1 border-t border-white/20">
                      {t("sensor.updatedAt")}: {cam.currentReading.receivedAt ? new Date(cam.currentReading.receivedAt).toLocaleTimeString(i18n.language.startsWith('vi') ? 'vi-VN' : i18n.language.startsWith('en') ? 'en-US' : 'zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>
        )}

        {/* Real-time sensor label (when NOT hovered/selected) */}
        {cam.isSensor && cam.currentReading && cam.status === "working" && !showLabelForThis && (
          <div className="absolute left-1/2 -translate-x-1/2 pointer-events-none whitespace-nowrap flex flex-col items-center gap-0.5"
            style={{
              fontSize: "calc(9px * var(--labelScale, 1))",
              top: "calc(-1 * var(--labelOffsetPx, 22px))",
            }}
          >
            <div className={`px-1.5 py-0.5 rounded bg-white/90 shadow-sm border border-emerald-200 text-[10px] font-bold ${cam.healthStatus === "good" ? "text-emerald-700" : "text-red-700"}`}>
              {cam.currentReading.temperature}°C | {cam.currentReading.humidity}%
            </div>
            {cam.currentReading.receivedAt && (
              <div className="px-1 py-0.5 rounded bg-black/60 text-white text-[7px] font-medium">
                {new Date(cam.currentReading.receivedAt).toLocaleTimeString(i18n.language.startsWith('vi') ? 'vi-VN' : i18n.language.startsWith('en') ? 'en-US' : 'zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>
            )}
          </div>
        )}

        {/* Wrapper icon (tether ref) */}
        <div
          ref={(el) => {
            if (el) cameraRefs.current[camKey] = el;
            else delete cameraRefs.current[camKey];
          }}
          className="relative flex items-center justify-center pointer-events-auto"
          style={{
            transform: "scale(var(--iconScale, 1))",
            transformOrigin: "center center",
          }}
          onMouseEnter={() => setHoveredId(cam.id)}
          onMouseLeave={() => setHoveredId((prev) => (prev === cam.id ? null : prev))}
          onClick={(e) => {
            e.stopPropagation();
            if (editMode) onSelectCamera?.(cam.id);
            else onInspectCamera?.(cam);
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            if (editMode) return;
            onViewCameraDetails?.(cam);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();

            if (editMode) {
              onOpenContextMenu?.(e.clientX, e.clientY, cam);
            } else {
              onViewCameraDetails?.(cam);
            }
          }}
          onWheel={(e) => {
            if (!editMode || !selected || !isTri) return;
            e.preventDefault();
            e.stopPropagation();
            const delta = e.deltaY < 0 ? 5 : -5;
            onUpdateCamera?.(cam.id, { angle: (cam.angle || 0) + delta });
          }}
        >
          {selected && <div className="pointer-events-none absolute inset-0 -m-1 rounded-full border-2 border-sky-500" />}

          {/* Alert ring - optimized for performance */}
          {cam.alarm && (
            <div
              className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center"
              style={{
                width: '64px',
                height: '64px',
                left: '50%',
                top: '50%',
                marginLeft: '-32px',
                marginTop: '-32px',
              }}
              aria-hidden="true"
            >
              <div
                className="alert-pulse absolute rounded-full"
                style={{
                  width: '100%',
                  height: '100%',
                  border: `3px solid ${alertColor}`,
                  boxShadow: `0 0 12px ${alertColor}`,
                }}
              />
            </div>
          )}

          {/* Main icon */}
          <div
            className={`relative z-10 w-8 h-8 rounded-full border-2 border-white shadow-md flex items-center justify-center ${cam.isSensor && cam.isOff ? 'bg-gray-400' : cfg.bgClass
              }`}
            style={{
              cursor: editMode ? "grab" : "pointer",
              animation: isHighlighted ? 'cameraPulse 1s ease-in-out 3' : 'none',
              willChange: isHighlighted ? 'transform' : 'auto',
            }}
            onMouseDown={(e) => {
              if (!editMode) return;
              e.stopPropagation();
              onBeginDrag?.(cam.id, cam.x ?? 0, cam.y ?? 0);
            }}
          >
            {cfg.dualIcon ? (
              <div className="flex -space-x-1 items-center justify-center">
                <FaTemperatureQuarter className="w-3.5 h-3.5 text-white" />
                <WiHumidity className="w-4 h-4 text-white" />
              </div>
            ) : (
              <IconComp className="w-5 h-5 text-white" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const CameraMarker = memo(
  CameraMarkerImpl,
  (prev, next) =>
    prev.cam === next.cam &&
    prev.cfg === next.cfg &&
    prev.showFov === next.showFov &&
    prev.editMode === next.editMode &&
    prev.selected === next.selected &&
    prev.hovered === next.hovered &&
    prev.isHighlighted === next.isHighlighted
);

export default CameraMarker;

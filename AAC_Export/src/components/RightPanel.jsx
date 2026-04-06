// src/components/RightPanel.jsx
import { GiCctvCamera } from "react-icons/gi";
import { TbDeviceComputerCamera } from "react-icons/tb";
import { BsFillInfoCircleFill } from "react-icons/bs";
import { FaListAlt } from "react-icons/fa";
import { WiHumidity } from "react-icons/wi";
import { FaTemperatureQuarter } from "react-icons/fa6";
import { useState, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { currentConfig } from "../config/factoryConfig";

export default function RightPanel({
  isOpen,
  toggle,
  editMode,
  placingType,
  onPlaceTypeChange,
  selectedCamera,
  onUpdateSelectedCamera,
  onClickSave,
  onClickSaveSensor,
  unmappedCameras = [],
  onPickCameraCode,
  unmappedTotal = 0,
  alerts = [],
  onAlertClick,
  viewCamera = null,
  seenAlertIds = [],
}) {
  const { t, i18n } = useTranslation("common");

  const [showHowTo, setShowHowTo] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [editSubMode, setEditSubMode] = useState("camera");

  // ===== ALERT FILTER (VIEW MODE) =====
  // values: all | smartphone | fire | intruder | crowb | unknown
  const [alertEventFilter, setAlertEventFilter] = useState("all");

  const seenSet = useMemo(() => new Set(seenAlertIds || []), [seenAlertIds]);

  const getEventLabelKey = useCallback((code) => {
    if (!code) return "alerts.events.unknown";
    const c = String(code).toLowerCase();
    switch (c) {
      case "crowb":
        return "alerts.events.crowb";
      case "crowb2":
        return "alerts.events.crowb2";
      case "intruder":
        return "alerts.events.intruder";
      case "fire":
        return "alerts.events.fire";
      case "smartphone":
        return "alerts.events.smartphone";
      default:
        return "alerts.events.unknown";
    }
  }, []);

  // ===== helper format time từ created_unix (seconds) =====
  const formatAlertTime = useCallback((unixSec) => {
    if (!unixSec) return "";
    const d = new Date(unixSec * 1000);
    try {
      return d.toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      return d.toISOString().substring(11, 19);
    }
  }, []);

  const handleChangeType = (type) => {
    const nextType = placingType === type ? null : type;
    onPlaceTypeChange(nextType);

    if (!selectedCamera || !onUpdateSelectedCamera) return;

    // 🔹 Floor type (dynamic)
    if (type?.startsWith("floor")) {
      onUpdateSelectedCamera({
        type,
        isSensor: false,
        range: selectedCamera.range || 100,
        angle: typeof selectedCamera.angle === "number" ? selectedCamera.angle : 0,
        radius: undefined,
      });
      return;
    }

    // 🔹 Sensor type
    if (type?.startsWith("sensor_")) {
      onUpdateSelectedCamera({
        type: "sensor",
        isSensor: true,
        sensor_type: type.split("_")[1],
        range: undefined,
        angle: undefined,
        radius: undefined,
      });
      return;
    }

    // 🔹 Circle type: cả cam360, cam360_upper & cam360_floorN
    let finalType = type;
    if (currentConfig.factoryId === 'vg' && type === 'cam360_lower') {
      finalType = 'cam360';
    }

    if (type === "cam360" || type === "cam360_upper" || type?.startsWith("cam360_floor") || finalType === 'cam360') {
      onUpdateSelectedCamera({
        type: finalType,
        isSensor: false,
        radius: selectedCamera.radius || 30,
        range: undefined,
        angle: undefined,
      });
    } else {
      onUpdateSelectedCamera({
        type: finalType,
        isSensor: false,
        range: selectedCamera.range || 100,
        angle: typeof selectedCamera.angle === "number" ? selectedCamera.angle : 0,
        radius: undefined,
      });
    }
  };

  // ===== FILTER LIST UNMAPPED THEO SEARCH VÀ SUB-MODE =====
  const filteredUnmapped = useMemo(() => {
    let list = unmappedCameras;

    // 1. Phân loại theo mode (Camera vs Sensor)
    if (editMode) {
      list = list.filter((cam) => {
        const isCamMode = editSubMode === "camera";
        const isSensorMode = editSubMode === "sensor";

        // Strict fallback isolation
        const containsCCTV = cam.code && String(cam.code).toUpperCase().includes("CCTV");

        if (isSensorMode) {
          // Chỉ lấy cảm biến (cam.isSensor = true), loại bỏ hoàn toàn các mã có chữ CCTV 
          return cam.isSensor === true && !containsCCTV;
        } else if (isCamMode) {
          // Chỉ lấy camera (cam.isSensor = false/undefined), giữ lại các mã có chữ CCTV hoặc các camera khác
          return !cam.isSensor || containsCCTV;
        }

        return true;
      });
    }

    // 2. Search
    if (!searchTerm.trim()) return list;

    const term = searchTerm.toLowerCase();
    return list.filter((cam) => {
      const code = cam.code?.toLowerCase() || "";
      const locObj = cam.location_json || {};
      const locStr = Object.values(locObj).join(" ").toLowerCase();
      return code.includes(term) || locStr.includes(term);
    });
  }, [unmappedCameras, searchTerm, editSubMode, editMode]);

  const unmappedTotalFiltered = filteredUnmapped.length;

  const renderUnmappedSection = () => {
    if (!editMode) return null;

    const langKey = i18n.language?.startsWith("vi")
      ? "vi"
      : i18n.language?.startsWith("en")
        ? "en"
        : "cn";

    return (
      <div className="mt-4 pt-3 border-t border-slate-200 flex flex-col min-h-0">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-10 h-10 rounded-md bg-slate-100 flex items-center justify-center">
            <FaListAlt className="text-slate-600 text-[30px]" />
          </div>

          <p className="text-xs font-semibold text-slate-700">
            {editSubMode === "sensor" ? t("sensor.typeDefault") : t("unmapped.title")}
            <span className="text-[11px] font-normal text-slate-500">({unmappedTotalFiltered})</span>
          </p>
        </div>

        {/* SEARCH */}
        <div className="mb-2">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t("unmapped.searchPlaceholder")}
            className="w-full rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500/40 focus:border-slate-500"
          />
        </div>

        {/* LIST */}
        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {filteredUnmapped.map((cam) => {
            const loc = cam.location_json || {};
            const locLabel = loc[langKey] ?? "";

            return (
              <button
                key={cam.code}
                onClick={() => onPickCameraCode && onPickCameraCode(cam.code)}
                className="w-full text-left px-3 py-2 bg-slate-50 border border-slate-200 rounded-md hover:bg-slate-100 transition flex items-center justify-between text-xs"
              >
                <div className="min-w-0">
                  <div className="font-semibold truncate flex items-center gap-1.5">
                    {cam.isSensor && (
                      <div className={`flex -space-x-1 items-center bg-white border border-slate-100 rounded-sm px-0.5 shadow-sm`}>
                        <FaTemperatureQuarter className={`w-2.5 h-2.5 ${currentConfig.factoryId === 'ch' ? 'text-[#36656B]' : (cam.sensor_type === 'upper' ? 'text-[#36656B]' : 'text-[#75B06F]')}`} />
                        <WiHumidity className={`w-3 h-3 ${currentConfig.factoryId === 'ch' ? 'text-[#36656B]' : (cam.sensor_type === 'upper' ? 'text-[#36656B]' : 'text-[#75B06F]')}`} />
                      </div>
                    )}
                    {cam.code}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate flex items-center justify-between">
                    <span>{locLabel}</span>
                    {cam.isSensor && cam.currentReading && (
                      <span className="ml-2 font-medium text-slate-600">
                        {cam.currentReading.temperature}°C | {cam.currentReading.humidity}%
                      </span>
                    )}
                  </div>
                </div>

                {/* Indicator: sensor shows sensorStatus, camera shows status */}
                {cam.isSensor ? (
                  <span
                    className={`ml-2 w-2.5 h-2.5 flex-shrink-0 rounded-full ${cam.sensorStatus === "on"
                      ? (currentConfig.factoryId === 'ch' ? "bg-[#36656B]" : (cam.sensor_type === 'upper' ? "bg-[#36656B]" : "bg-[#75B06F]"))
                      : "bg-red-500"
                      }`}
                  />
                ) : (
                  <span
                    className={`ml-2 w-2.5 h-2.5 flex-shrink-0 rounded-full ${cam.status === "working" ? "bg-emerald-500" : "bg-red-500"
                      }`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  // ==========================
  // ALERT LIST: OPTIMIZE
  // ==========================
  const processedAlerts = useMemo(() => {
    // precompute fields to avoid doing it inside render map()
    return (alerts || []).map((alert) => {
      const eventCodeRaw = alert?.event_code;
      const eventCode = eventCodeRaw ? String(eventCodeRaw).toLowerCase() : "unknown";
      const eventKey = getEventLabelKey(eventCode);
      const eventText = t(eventKey);

      const imageUrl = alert.fullUrl || alert.thumbUrl || "";
      const isSeen = seenSet.has(alert.id);
      const timeText = formatAlertTime(alert.created_unix);

      return {
        ...alert,
        __eventCode: eventCode || "unknown",
        __eventText: eventText,
        __imageUrl: imageUrl,
        __isSeen: isSeen,
        __timeText: timeText,
      };
    });
    // NOTE: t() changes when language changes -> include i18n.language
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerts, seenSet, formatAlertTime, getEventLabelKey, i18n.language]);

  const alertCounts = useMemo(() => {
    const counts = {
      all: processedAlerts.length,
      smartphone: 0,
      fire: 0,
      intruder: 0,
      crowb: 0,
      crowb2: 0,
      unknown: 0,
    };
    for (const a of processedAlerts) {
      const k = a.__eventCode || "unknown";
      if (counts[k] === undefined) counts.unknown += 1;
      else counts[k] += 1;
    }
    return counts;
  }, [processedAlerts]);

  const filteredAlerts = useMemo(() => {
    if (alertEventFilter === "all") return processedAlerts;
    return processedAlerts.filter((a) => (a.__eventCode || "unknown") === alertEventFilter);
  }, [processedAlerts, alertEventFilter]);

  const alertFilterOptions = useMemo(() => {
    return [
      { value: "all", label: t("alerts.filter.all") },
      { value: "smartphone", label: t("alerts.filter.smartphone") },
      { value: "fire", label: t("alerts.filter.fire") },
      { value: "intruder", label: t("alerts.filter.intruder") },
      { value: "crowb", label: t("alerts.filter.crowb") },
      { value: "crowb2", label: t("alerts.filter.crowb2") },
      { value: "unknown", label: t("alerts.filter.unknown") },
    ];
  }, [i18n.language, t]);


  // ====== ALERT LIST (VIEW MODE) ======
  const renderAlertsOnly = () => {
    if (!processedAlerts.length) {
      return (
        <div className="flex-1 p-5 text-sm text-slate-700 space-y-2">
          <p className="text-xs font-semibold text-slate-700">{t("alerts.emptyTitle")}</p>
          <p className="text-[11px] text-slate-500">{t("alerts.emptyDesc")}</p>
        </div>
      );
    }

    return (
      <div className="flex-1 p-5 text-sm text-slate-700 space-y-3 min-h-0">
        <div className="space-y-3">
          {/* TITLE */}
          {/* <div>
            <p className="text-xs font-semibold text-red-600">{t("alerts.listTitle")}</p>
            <p className="text-[11px] text-slate-500">{t("alerts.listDesc")}</p>
          </div> */}

          {/* FILTER (below title) */}
          <div className="flex items-end gap-2">
            <div className="flex-1 min-w-0">
              <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                {t("alerts.filter.label", "Event")}
              </label>

              <select
                value={alertEventFilter}
                onChange={(e) => setAlertEventFilter(e.target.value)}
                className="w-full h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500/20"
              >
                {alertFilterOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label} ({alertCounts[opt.value] ?? 0})
                  </option>
                ))}
              </select>

            </div>

            {/* COUNT nhỏ bên phải (tuỳ chọn) */}
            {/* <div className="pb-1 flex-shrink-0 text-[10px] font-mono text-slate-400">
              {(alertCounts[alertEventFilter] ?? 0)}/{(alertCounts.all ?? 0)}
            </div> */}
          </div>
        </div>


        <div className="space-y-3 max-h-[calc(100vh-170px)] overflow-y-auto pr-1">
          {filteredAlerts.map((alert) => {
            const isSeen = alert.__isSeen;
            const imageUrl = alert.__imageUrl;

            return (
              <button
                key={alert.id}
                onClick={() => onAlertClick && onAlertClick(alert)}
                className={`
                  w-full text-left rounded-xl border
                  flex flex-col overflow-hidden transition
                  ${isSeen
                    ? "border-slate-200 bg-slate-50/90 hover:bg-slate-100/90 opacity-80"
                    : "border-red-100 bg-red-50/70 hover:bg-red-100/80"
                  }
                `}
              >
                {imageUrl && (
                  <div className="w-full h-40 bg-black/70">
                    <img src={imageUrl} alt={`Alert ${alert.camera_code}`} className="w-full h-full object-cover" />
                  </div>
                )}

                <div className="px-3 pb-2 pt-2 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800 truncate">
                      {alert.camera_code || "—"}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono text-slate-500">{alert.__timeText}</span>
                      <span className={`w-1.5 h-1.5 rounded-full ${isSeen ? "bg-slate-300" : "bg-red-500"}`} />
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-700 leading-snug">{alert.__eventText}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  // ====== CAMERA INFO ONLY (viewCamera != null) ======
  const renderCameraInfoOnly = () => {
    const cam = viewCamera;
    const langKey = i18n.language?.startsWith("vi")
      ? "vi"
      : i18n.language?.startsWith("en")
        ? "en"
        : "cn";

    if (!cam) {
      return (
        <div className="flex-1 p-5 text-sm text-slate-700 space-y-2">
          <p className="text-xs text-slate-500">{t("panel.noCamera")}</p>
        </div>
      );
    }

    const isCircle = cam.type === "cam360" || cam.type === "cam360_upper" || cam.type?.startsWith("cam360_floor");
    const isSensor = cam.isSensor;

    const locLabel = cam.location_json?.[langKey] || Object.values(cam.location_json || {})[0] || "";

    const typeLabel = (() => {
      if (isSensor) {
        if (cam.sensor_type?.startsWith("floor")) {
          const floorNum = cam.sensor_type.replace("floor", "");
          return t(`floor.${floorNum}`);
        }
        return cam.sensor_type === "upper" ? t("sensor.typeUpper") : cam.sensor_type === "lower" ? t("sensor.typeLower") : t("sensor.typeDefault");
      }

      if (cam.type?.startsWith("cam360_floor")) {
        const floorNum = cam.type.replace("cam360_floor", "");
        return t("panel.cam360Floor", { floor: t(`floor.${floorNum}`) });
      }

      if (cam.type?.startsWith("floor")) {
        const floorNum = cam.type.replace("floor", "");
        return t("panel.cameraFloor", { floor: t(`floor.${floorNum}`) });
      }

      switch (cam.type) {
        case "upper": return t("camera.typeUpper");
        case "lower": return t("camera.typeLower");
        case "cam360": return t("camera.type360");
        case "cam360_upper": return t("camera.type360Upper");
        default: return cam.type || "—";
      }
    })();

    const mappedAt = cam.created_at || "—";

    return (
      <div className="flex-1 p-5 text-sm text-slate-700 space-y-5">
        <div className="space-y-1">
          <p className="text-xs font-semibold text-slate-600">
            {isSensor ? t("camera.deviceInfoTitle") : t("camera.infoTitle")}
          </p>
          <p className="text-xs text-slate-500">
            {isSensor ? t("camera.sensorCode") : t("camera.code")}: <span className="font-mono font-semibold">{cam.code || "—"}</span>
          </p>
          {locLabel && (
            <p className="text-xs text-slate-500">
              {t("camera.locationLabel")}: <span className="font-semibold">{locLabel}</span>
            </p>
          )}
        </div>

        {/* For sensors: show temperature/humidity data */}
        {isSensor ? (
          <>
            <div className="space-y-1 text-xs text-slate-600">
              <p className="font-semibold">{t("camera.sensorDataTitle")}</p>
              <p className="text-slate-500">
                {t("camera.type")}: <span className="font-semibold">{typeLabel}</span>
              </p>
              {cam.currentReading?.temperature !== undefined && cam.currentReading?.temperature !== null && (
                <p className="text-slate-500">
                  {t("sensor.temperature")}: <span className="font-semibold text-orange-600">{cam.currentReading.temperature}°C</span>
                </p>
              )}
              {cam.currentReading?.humidity !== undefined && cam.currentReading?.humidity !== null && (
                <p className="text-slate-500">
                  {t("sensor.humidity")}: <span className="font-semibold text-blue-600">{cam.currentReading.humidity}%</span>
                </p>
              )}
              <p className="text-slate-500">
                {t("camera.location")}: <span className="font-mono">x: {cam.x?.toFixed(1) ?? "—"}, y: {cam.y?.toFixed(1) ?? "—"}</span>
              </p>
            </div>

            <div className="space-y-1 text-xs text-slate-600">
              <p className="font-semibold">{t("camera.layoutInfo")}</p>
              <p className="text-slate-500">
                {t("camera.mappedAt")}: <span className="font-mono">{mappedAt}</span>
              </p>
            </div>
          </>
        ) : (
          /* For cameras: show normal camera info */
          <>
            <div className="space-y-1 text-xs text-slate-600">
              <p className="font-semibold">{t("camera.configTitle")}</p>
              <p className="text-slate-500">
                {t("camera.type")}: <span className="font-semibold">{typeLabel}</span>
              </p>

              {isCircle ? (
                <p className="text-slate-500">
                  {t("camera.radius")}: <span className="font-semibold">{cam.radius ?? "—"}</span>
                </p>
              ) : (
                <>
                  <p className="text-slate-500">
                    {t("camera.viewDistance")}: <span className="font-semibold">{cam.range ?? "—"}</span>
                  </p>
                  <p className="text-slate-500">
                    {t("camera.rotationAngle")}: <span className="font-semibold">{cam.angle ?? "0"}</span>°
                  </p>
                </>
              )}

              <p className="text-slate-500">
                {t("camera.location")}: <span className="font-mono">x: {cam.x?.toFixed(1) ?? "—"}, y: {cam.y?.toFixed(1) ?? "—"}</span>
              </p>
            </div>

            <div className="space-y-1 text-xs text-slate-600">
              <p className="font-semibold">{t("camera.layoutInfo")}</p>
              <p className="text-slate-500">
                {t("camera.mappedAt")}: <span className="font-mono">{mappedAt}</span>
              </p>
            </div>
          </>
        )}
      </div>
    );
  };

  // =============== EDIT MODE CONTENT ================
  const renderEditContent = () => {
    const isCircle = selectedCamera && (selectedCamera.type === "cam360" || selectedCamera.type === "cam360_upper" || selectedCamera.type?.startsWith("cam360_floor"));

    return (
      <div className="flex-1 flex flex-col p-5 text-sm text-slate-700 min-h-0 space-y-4">
        {/* SUB-MODE SELECTOR */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
            {t("panel.editSubModeLabel")}
          </label>
          <select
            value={editSubMode}
            onChange={(e) => setEditSubMode(e.target.value)}
            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500/20"
          >
            <option value="camera">{t("panel.editSubModeCamera")}</option>
            <option value="sensor">{t("panel.editSubModeSensor")}</option>
          </select>
        </div>

        {/* HOW TO USE */}
        <div className="border border-slate-200 rounded-lg p-3 bg-slate-50">
          <button
            onClick={() => setShowHowTo((v) => !v)}
            className="flex items-center justify-between w-full text-xs font-semibold text-slate-600"
          >
            <div className="flex items-center gap-2">
              <BsFillInfoCircleFill className="text-slate-500 text-sm" />
              {t("panel.helpTitle")}
            </div>
            <span>{showHowTo ? "−" : "+"}</span>
          </button>

          {showHowTo && (
            <div className="mt-2 space-y-1 text-xs text-slate-500">
              <p>{t("panel.help1")}</p>
              <p>{t("panel.help2")}</p>
              <p>{t("panel.help3")}</p>
            </div>
          )}
        </div>

        {/* CHỌN LOẠI CAMERA */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-slate-600">{t("panel.typeLabel")}</p>
          <div className="flex flex-wrap gap-2">
            {editSubMode === "camera" ? (
              <>
                <p className="w-full text-[10px] font-bold text-slate-400 mt-1 uppercase italic">{t("panel.cameraDirectional")}</p>
                {currentConfig.floors?.map((f) => (
                  <TypeButton
                    key={f.id}
                    active={placingType === f.id}
                    bgClass={f.id === 'lower' ? "bg-amber-400" : "bg-orange-500"}
                    Icon={GiCctvCamera}
                    label={t(f.labelKey)}
                    onClick={() => handleChangeType(f.id)}
                  />
                ))}

                <p className="w-full text-[10px] font-bold text-slate-400 mt-2 uppercase italic">{t("panel.camera360")}</p>
                {currentConfig.floors?.map((f) => (
                  <TypeButton
                    key={`360_${f.id}`}
                    active={placingType === `cam360_${f.id}`}
                    bgClass={f.id === 'upper' ? "bg-indigo-500" : "bg-sky-500"}
                    Icon={TbDeviceComputerCamera}
                    label={t(f.labelKey)}
                    onClick={() => handleChangeType(`cam360_${f.id}`)}
                  />
                ))}
              </>
            ) : (
              <>
                <p className="w-full text-[10px] font-bold text-slate-400 mt-1 uppercase italic">{t("deviceMode.sensors")}</p>
                {currentConfig.floors?.map((f) => {
                  const sId = `sensor_${f.id}`;
                  return (
                    <TypeButton
                      key={sId}
                      active={placingType === sId}
                      bgClass={currentConfig.factoryId === 'ch' ? "bg-[#36656B]" : (f.id === 'lower' ? "bg-[#75B06F]" : "bg-[#36656B]")}
                      Icon={({ className }) => (
                        <div className={`flex -space-x-1 items-center justify-center ${className}`}>
                          <FaTemperatureQuarter className="w-3 h-3 text-white" />
                          <WiHumidity className="w-3.5 h-3.5 text-white" />
                        </div>
                      )}
                      label={t(f.labelKey)}
                      onClick={() => handleChangeType(sId)}
                    />
                  );
                })}
              </>
            )}
          </div>
        </div>

        {/* CAMERA/SENSOR ĐANG CHỌN */}
        {selectedCamera ? (
          <div className="space-y-4 pt-2 border-t border-slate-200">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span className="font-semibold">
                  {selectedCamera.isSensor ? t("panel.currentSensor") : t("panel.currentCam")}
                </span>
                <span className="text-[11px] text-slate-500">
                  {selectedCamera.isSensor ? t("panel.currentSensorCode") : t("panel.currentCode")}&nbsp;<b>{selectedCamera.code || "—"}</b>
                </span>
              </div>
              <input
                type="text"
                value={selectedCamera.code || ""}
                onChange={(e) => onUpdateSelectedCamera({ code: e.target.value.toUpperCase() })}
                placeholder={selectedCamera.isSensor ? "Sensor code (e.g. S001)" : "Camera code (e.g. E4040)"}
                className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500/40 focus:border-slate-500"
              />
            </div>

            {/* Only show range/angle for cameras, not sensors */}
            {!selectedCamera.isSensor && !isCircle && (
              <>
                <RangeBlock
                  title={t("panel.rangeLabel")}
                  value={selectedCamera.range || 100}
                  min={15}
                  max={100}
                  onChange={(val) => onUpdateSelectedCamera({ range: val })}
                />
                <RangeBlock
                  title={t("panel.angleLabel")}
                  value={selectedCamera.angle || 0}
                  min={-180}
                  max={180}
                  onChange={(val) => onUpdateSelectedCamera({ angle: val })}
                />
              </>
            )}

            {!selectedCamera.isSensor && isCircle && (
              <RangeBlock
                title={t("panel.radiusLabel")}
                value={selectedCamera.radius || 30}
                min={15}
                max={150}
                onChange={(val) => onUpdateSelectedCamera({ radius: val })}
              />
            )}
          </div>
        ) : (
          <p className="text-xs text-slate-400 pt-2 border-t border-slate-200">{t("panel.noCamera")}</p>
        )}

        {renderUnmappedSection()}
      </div>
    );
  };

  // =============== VIEW MODE CONTENT ================
  const renderViewContent = () => {
    if (viewCamera) return renderCameraInfoOnly();
    return renderAlertsOnly();
  };

  return (
    <div className="absolute inset-y-0 right-0 h-full z-10">
      <div
        className={`
          absolute inset-y-0 right-0
          h-full w-[24rem]
          bg-white/95 backdrop-blur-sm
          shadow-2xl rounded-l-3xl
          border-l border-slate-200
          flex flex-col
          transition-transform duration-300 ease-in-out
          ${isOpen ? "translate-x-0" : "translate-x-full"}
        `}
      >
        {/* HEADER */}
        <div className="p-5 border-b border-slate-200 flex-shrink-0">
          <h2 className="text-slate-900 font-semibold text-lg">
            {editMode
              ? t("panel.titleEdit")
              : viewCamera
                ? viewCamera.isSensor
                  ? t("panel.titleViewSensor")
                  : t("panel.titleView")
                : t("alerts.header")}
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            {editMode
              ? t("panel.subtitleEdit")
              : viewCamera
                ? viewCamera.isSensor
                  ? t("panel.subtitleViewSensor", "Chế độ xem: hiển thị thông tin cảm biến.")
                  : t("panel.subtitleView")
                : t("alerts.subtitle")}
          </p>
        </div>

        {/* BODY */}
        <div className="flex-1 min-h-0 overflow-y-auto">{editMode ? renderEditContent() : renderViewContent()}</div>

        {editMode && (
          <div className="mt-auto px-5 pb-4 pt-2 border-t border-slate-200 bg-white/90 flex-shrink-0">
            {editSubMode === "camera" ? (
              <button
                onClick={onClickSave}
                className="w-full h-9 rounded-full text-xs font-semibold bg-slate-900 text-white shadow-md hover:bg-slate-800"
              >
                {t("button.saveConfig")}
              </button>
            ) : (
              <button
                onClick={onClickSaveSensor}
                className="w-full h-9 rounded-full text-xs font-semibold bg-emerald-600 text-white shadow-md hover:bg-emerald-700"
              >
                {t("button.saveSensorConfig")}
              </button>
            )}
          </div>
        )}
      </div>

      {/* BUTTON TOGGLE PANEL */}
      <button
        onClick={toggle}
        className={`
          absolute top-1/2 -translate-y-1/2
          h-16 w-9
          flex items-center justify-center
          rounded-full
          bg-slate-900 text-slate-50
          shadow-xl border border-slate-900/70
          transition-all
          ${isOpen ? "right-[24rem]" : "right-0"}
        `}
      >
        <span className="text-lg">{isOpen ? "›" : "‹"}</span>
      </button>
    </div>
  );
}

/* --- SUB COMPONENTS --- */

function TypeButton({ active, bgClass, Icon, label, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`
        flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs transition
        ${active ? "border-slate-900 bg-slate-900/5 text-slate-900" : "border-slate-200 bg-white hover:bg-slate-50 text-slate-600"}
      `}
    >
      <span className={`w-6 h-6 rounded-full flex items-center justify-center ${bgClass}`}>
        <Icon className="w-4 h-4 text-white" />
      </span>
      {label}
    </button>
  );
}

function RangeBlock({ title, value, min, max, onChange }) {
  const { t } = useTranslation("common");
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-xs text-slate-600">
        <span className="font-semibold">{title}</span>
        <span>{value}</span>
      </div>

      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-slate-900" />

      <p className="text-[11px] text-slate-400">{t("panel.rangeHint")}</p>
    </div>
  );
}

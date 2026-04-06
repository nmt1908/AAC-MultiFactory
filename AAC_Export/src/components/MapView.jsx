import { useRef, useState, useEffect, useMemo, useCallback } from "react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { GiCctvCamera } from "react-icons/gi";
import { TbDeviceComputerCamera } from "react-icons/tb";
import { useTranslation } from "react-i18next";
import { currentConfig } from "../config/factoryConfig";
import ConfirmDialog from "./ConfirmDialog";
import CameraMarker from "./CameraMarker";
import LevelSwitcher from "./LevelSwitcher";

const CAMERA_TYPES = {
  upper: {
    icon: GiCctvCamera,
    bgClass: "bg-orange-500",
    textClass: "text-orange-500",
    fovFill: "rgba(249,115,22,0.22)",
    fovStroke: "rgba(194,65,12,0.7)",
    lineColor: "#f97316",
  },
  lower: {
    icon: GiCctvCamera,
    bgClass: "bg-amber-400",
    textClass: "text-amber-400",
    fovFill: "rgba(250,204,21,0.22)",
    fovStroke: "rgba(202,138,4,0.7)",
    lineColor: "#fbbf24",
  },
  cam360: {
    icon: TbDeviceComputerCamera,
    bgClass: "bg-sky-500",
    textClass: "text-sky-500",
    fovFill: "rgba(56,189,248,0.16)",
    fovStroke: "rgba(3,105,161,0.7)",
    lineColor: "#0ea5e9",
  },
  cam360_upper: {
    icon: TbDeviceComputerCamera,
    bgClass: "bg-indigo-500",
    textClass: "text-indigo-500",
    fovFill: "rgba(129,140,248,0.16)",
    fovStroke: "rgba(79,70,229,0.7)",
    lineColor: "#6366f1",
  },
  sensor: {
    bgClass: "bg-emerald-500",
    textClass: "text-emerald-500",
    fovFill: "rgba(16,185,129,0.1)",
    fovStroke: "rgba(5,150,105,0.7)",
    lineColor: "#10b981",
    dualIcon: true,
  },
  sensor_upper: {
    bgClass: "bg-[#36656B]", // Upstairs color
    textClass: "text-[#36656B]",
    fovFill: "rgba(54,101,107,0.1)",
    fovStroke: "rgba(54,101,107,0.7)",
    lineColor: "#36656B",
    dualIcon: true,
  },
  sensor_lower: {
    bgClass: "bg-[#75B06F]", // Downstairs color
    textClass: "text-[#75B06F]",
    fovFill: "rgba(117,176,111,0.1)",
    fovStroke: "rgba(117,176,111,0.7)",
    lineColor: "#75B06F",
    dualIcon: true,
  },
  sensor_floor: {
    bgClass: "bg-[#36656B]", // CH unified sensor color
    textClass: "text-[#36656B]",
    fovFill: "rgba(54,101,107,0.1)",
    fovStroke: "rgba(54,101,107,0.7)",
    lineColor: "#36656B",
    dualIcon: true,
  },
  // Dynamic floor styles fallback (optional if you want different colors)
  floor: {
    icon: GiCctvCamera,
    bgClass: "bg-orange-500",
    textClass: "text-orange-500",
    fovFill: "rgba(249,115,22,0.22)",
    fovStroke: "rgba(194,65,12,0.7)",
    lineColor: "#f97316",
  }
};

const MIN_CENTER_DIST_PERCENT = 0.3;

const getFilterOptions = (t, selectedFloor) => {
  const isVG = currentConfig.factoryId === 'vg';
  const floorsToMap = selectedFloor ? currentConfig.floors?.filter(f => f.id === selectedFloor) : currentConfig.floors;

  const floorFilters = floorsToMap?.map(f => ({
    value: f.id,
    label: isVG ? t(f.labelKey) : t("panel.cameraFloor", { floor: t(f.labelKey) })
  })) || [];

  const cam360FloorFilters = floorsToMap?.map(f => {
    let value = `cam360_${f.id}`;
    if (isVG && f.id === 'lower') value = 'cam360';
    return {
      value,
      label: isVG ? t(f.id === 'upper' ? 'filter.cam360Upper' : 'filter.cam360') : t("panel.cam360Floor", { floor: t(f.labelKey) })
    };
  }) || [];

  return [
    { value: "all", label: t("filter.all") },
    ...floorFilters,
    ...cam360FloorFilters,
  ];
};

const getSensorFilterOptions = (t, selectedFloor) => {
  const isVG = currentConfig.factoryId === 'vg';
  const floorsToMap = selectedFloor ? currentConfig.floors?.filter(f => f.id === selectedFloor) : currentConfig.floors;

  const floorFilters = floorsToMap?.map(f => ({
    value: `sensor_${f.id}`,
    label: isVG ? t(`sensorFilter.${f.id}`) : t("panel.sensorFloor", { floor: t(f.labelKey) })
  })) || [];

  return [
    { value: "all", label: t("sensorFilter.all") },
    ...floorFilters,
    { value: "sensor_on", label: t("sensorFilter.on") },
    { value: "sensor_off", label: t("sensorFilter.off") },
  ];
};

const getCombinedFilterOptions = (t, selectedFloor) => {
  const isVG = currentConfig.factoryId === 'vg';
  const floorsToMap = selectedFloor ? currentConfig.floors?.filter(f => f.id === selectedFloor) : currentConfig.floors;

  const baseFloors = floorsToMap?.map(f => ({
    value: f.id,
    label: isVG ? t(f.labelKey) : t("panel.cameraFloor", { floor: t(f.labelKey) })
  })) || [];

  const cam360Floors = floorsToMap?.map(f => {
    let value = `cam360_${f.id}`;
    if (isVG && f.id === 'lower') value = 'cam360';
    return {
      value,
      label: isVG ? t(f.id === 'upper' ? 'filter.cam360Upper' : 'filter.cam360') : t("panel.cam360Floor", { floor: t(f.labelKey) })
    };
  }) || [];

  const sensorFloors = floorsToMap?.map(f => ({
    value: `sensor_${f.id}`,
    label: isVG ? t(`sensorFilter.${f.id}`) : t("panel.sensorFloor", { floor: t(f.labelKey) })
  })) || [];

  return [
    { value: "all", label: t("filter.allDevices", "Tất cả thiết bị") },
    ...baseFloors,
    ...cam360Floors,
    ...sensorFloors,
    { value: "sensor_on", label: t("sensorFilter.on") },
    { value: "sensor_off", label: t("sensorFilter.off") },
  ];
};

export default function MapView({
  mapImage,
  cameras,
  editMode,
  selectedCameraId,
  highlightedCameraId,
  onMapClick,
  onSelectCamera,
  onUpdateCamera,
  onDeleteCamera,
  onDeleteSensor,
  onInspectCamera,
  onViewCameraDetails,
  alerts = [],
  focusCameraCode,
  inspectorLink,
  alignLeft = false,
  onZoomChange, // callback để thông báo zoom level cho parent
  selectedFloor,
  onFloorChange,
}) {
  const containerRef = useRef(null);

  const [draggingId, setDraggingId] = useState(null);
  const dragClickGuardRef = useRef(false);
  const dragStartRef = useRef(null);

  const { t } = useTranslation("common");

  const [contextMenu, setContextMenu] = useState({
    open: false,
    x: 0,
    y: 0,
    camera: null,
  });

  const [confirmState, setConfirmState] = useState({
    open: false,
    camera: null,
  });

  const [hoveredId, setHoveredId] = useState(null);
  const controlsRef = useRef(null);
  const lastFocusRef = useRef(null);

  // DOM refs của marker để tether (key = String(cam.id))
  const cameraRefs = useRef({});

  // ===== camerasById (O(1) lookup) =====
  const camerasById = useMemo(() => {
    const m = new Map();
    for (const c of cameras || []) {
      m.set(String(c.id), c);
    }
    return m;
  }, [cameras]);

  // =========================
  // SCALE -> CSS VARS (RAF)
  // =========================
  const scaleRef = useRef(1);
  const rafZoomVarsRef = useRef(0);
  const [showFov, setShowFov] = useState(false);

  const applyZoomVars = useCallback((scaleNext) => {
    const zoomClamped = Math.max(0.8, Math.min(scaleNext, 6));
    const iconScale = Math.max(0.1, Math.min(1, 1 / Math.pow(zoomClamped, 0.8)));
    const labelScale = Math.max(0.1, Math.min(1, 1 / Math.pow(zoomClamped, 0.7)));
    const labelOffsetPx = 22 * labelScale;

    const el = containerRef.current;
    if (el) {
      el.style.setProperty("--iconScale", String(iconScale));
      el.style.setProperty("--labelScale", String(labelScale));
      el.style.setProperty("--labelOffsetPx", `${labelOffsetPx}px`);
    }

    const nextShowFov = scaleNext > 1.05;
    setShowFov((prev) => (prev === nextShowFov ? prev : nextShowFov));
  }, []);

  const applyZoomVarsRaf = useCallback(
    (scaleNext) => {
      scaleRef.current = scaleNext;
      if (rafZoomVarsRef.current) return;
      rafZoomVarsRef.current = requestAnimationFrame(() => {
        rafZoomVarsRef.current = 0;
        applyZoomVars(scaleRef.current);
        // Notify parent component về zoom change
        if (onZoomChange) {
          onZoomChange(scaleRef.current);
        }
      });
    },
    [applyZoomVars, onZoomChange]
  );

  // =========================
  // TETHER LINE (RAF + skip setState)
  // =========================
  const [inspectorLine, setInspectorLine] = useState(null);
  const rafLineRef = useRef(0);
  const pendingLinkRef = useRef(undefined);
  const lastLineRef = useRef(null);

  const linesAlmostEqual = useCallback((a, b) => {
    if (a === b) return true;
    if (!a || !b) return false;
    const EPS = 0.5;
    return (
      Math.abs(a.x1 - b.x1) < EPS &&
      Math.abs(a.y1 - b.y1) < EPS &&
      Math.abs(a.x2 - b.x2) < EPS &&
      Math.abs(a.y2 - b.y2) < EPS &&
      a.color === b.color
    );
  }, []);

  const buildInspectorLine = useCallback(
    (linkOverride) => {
      const link = linkOverride ?? inspectorLink;
      if (!link || !link.cameraId) return null;

      const camIdKey = String(link.cameraId);

      // O(1)
      const cam = camerasById.get(camIdKey);
      const camEl = cameraRefs.current[camIdKey];
      if (!cam || !camEl) return null;

      const rect = camEl.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;

      const x2 = link.centerX;
      const y2 = link.centerY;

      const dx = x2 - cx;
      const dy = y2 - cy;
      const dist = Math.hypot(dx, dy) || 1;

      const iconRadius = rect.width / 2 + 4;
      const x1 = cx + (dx / dist) * iconRadius;
      const y1 = cy + (dy / dist) * iconRadius;

      const cfg = CAMERA_TYPES[cam.type] || {};
      const color = cfg.lineColor || cfg.fovStroke || "rgba(15,23,42,0.9)";

      return { x1, y1, x2, y2, color };
    },
    [camerasById, inspectorLink]
  );

  const recalcInspectorLineRaf = useCallback(
    (linkOverride) => {
      // Resolve the effective link
      const link = linkOverride !== undefined ? linkOverride : inspectorLink;
      pendingLinkRef.current = link;

      // IMMEDIATE CLEAR if link is null (fix delay issue)
      if (!link) {
        if (rafLineRef.current) {
          cancelAnimationFrame(rafLineRef.current);
          rafLineRef.current = 0;
        }
        setInspectorLine(null);
        lastLineRef.current = null;
        return;
      }

      if (rafLineRef.current) return;

      rafLineRef.current = requestAnimationFrame(() => {
        rafLineRef.current = 0;

        const next = buildInspectorLine(pendingLinkRef.current);

        if (linesAlmostEqual(lastLineRef.current, next)) return;

        lastLineRef.current = next;
        setInspectorLine(next);
      });
    },
    [buildInspectorLine, linesAlmostEqual, inspectorLink]
  );

  // Cleanup RAFs
  useEffect(() => {
    return () => {
      if (rafZoomVarsRef.current) {
        cancelAnimationFrame(rafZoomVarsRef.current);
        rafZoomVarsRef.current = 0;
      }
      if (rafLineRef.current) {
        cancelAnimationFrame(rafLineRef.current);
        rafLineRef.current = 0;
      }
    };
  }, []);

  // ===== FILTER STATE (view mode) =====
  const [filterMode, setFilterMode] = useState("all");
  const [filterOpen, setFilterOpen] = useState(false);

  // ===== DEVICE MODE: all | cameras | sensors =====
  const [deviceMode, setDeviceMode] = useState("all");

  const toggleDeviceMode = useCallback(() => {
    setDeviceMode((prev) => {
      if (prev === "all") return "cameras";
      if (prev === "cameras") return "sensors";
      return "all";
    });
    // Reset filter to "all" when switching modes
    setFilterMode("all");
  }, []);

  const closeContextMenu = useCallback(() => {
    setContextMenu({ open: false, x: 0, y: 0, camera: null });
  }, []);

  const openDeleteConfirm = useCallback(
    (camera) => {
      closeContextMenu();

      // Check if it's a sensor
      const isSensor = camera?.isSensor;
      const deleteHandler = isSensor ? onDeleteSensor : onDeleteCamera;

      if (!camera?.hasLayout || !camera?.code) {
        deleteHandler && deleteHandler(camera.id, { localOnly: true });
        return;
      }
      setConfirmState({ open: true, camera });
    },
    [closeContextMenu, onDeleteCamera, onDeleteSensor]
  );

  const closeConfirm = useCallback(() => {
    setConfirmState({ open: false, camera: null });
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (confirmState.camera) {
      const isSensor = confirmState.camera.isSensor;
      const deleteHandler = isSensor ? onDeleteSensor : onDeleteCamera;
      deleteHandler && deleteHandler(confirmState.camera.id);
    }
    closeConfirm();
  }, [confirmState.camera, onDeleteCamera, onDeleteSensor, closeConfirm]);

  // ===== Open context menu callback (stable) =====
  const onOpenContextMenu = useCallback((x, y, cam) => {
    setContextMenu({ open: true, x, y, camera: cam });
  }, []);

  // ---- Hotkey: Delete selected camera ----
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!editMode) return;
      if (!selectedCameraId) return;

      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target.isContentEditable) return;

      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();

        const cam = camerasById.get(String(selectedCameraId));
        if (!cam) return;

        const isSensor = cam.isSensor;
        const deleteHandler = isSensor ? onDeleteSensor : onDeleteCamera;

        if (!cam.hasLayout || !cam.code) {
          deleteHandler && deleteHandler(cam.id, { localOnly: true });
          return;
        }

        setConfirmState({ open: true, camera: cam });
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editMode, selectedCameraId, camerasById, onDeleteCamera, onDeleteSensor]);

  // auto-zoom tới camera khi click alert
  useEffect(() => {
    if (!focusCameraCode) {
      lastFocusRef.current = null;
      return;
    }
    if (!containerRef.current || !controlsRef.current) return;

    if (lastFocusRef.current === focusCameraCode) return;
    lastFocusRef.current = focusCameraCode;

    const cam = (cameras || []).find((c) => c.code && c.code === focusCameraCode);
    if (!cam || typeof cam.x !== "number" || typeof cam.y !== "number") return;

    const contentW = containerRef.current.offsetWidth || 1;
    const contentH = containerRef.current.offsetHeight || 1;

    const currentScale = scaleRef.current || 1;
    const targetScale = Math.max(currentScale, 2.4);

    const cx = (cam.x / 100) * contentW;
    const cy = (cam.y / 100) * contentH;

    const positionX = -(cx * targetScale - contentW / 2);
    const positionY = -(cy * targetScale - contentH / 2);

    controlsRef.current.setTransform(positionX, positionY, targetScale, 300, "easeOut");
  }, [focusCameraCode, cameras]);

  // inspectorLink / camerasById đổi -> recalc line
  useEffect(() => {
    recalcInspectorLineRaf();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inspectorLink, camerasById]);

  const filteredCameras = useMemo(() => {
    if (!cameras) return [];

    let result = cameras;

    // 1. Apply device mode filter (view mode only)
    if (!editMode) {
      if (deviceMode === "cameras") {
        result = result.filter((cam) => !cam.isSensor);
      } else if (deviceMode === "sensors") {
        result = result.filter((cam) => cam.isSensor);
      }
      // deviceMode === "all" → no filter
    }

    // 2. Apply type/status filter (view mode only)
    if (!editMode && filterMode !== "all") {
      result = result.filter((cam) => {
        // Dynamic floor-based filtering (covers both camera and sensor floors)
        if (filterMode.startsWith("floor") || filterMode.startsWith("sensor_floor") || filterMode.startsWith("cam360_floor")) {
          if (filterMode.startsWith("sensor_")) {
            const targetFloorId = filterMode.replace("sensor_", "");
            return cam.isSensor && cam.sensor_type === targetFloorId;
          } else if (filterMode.startsWith("cam360_")) {
            const targetFloorId = filterMode.replace("cam360_", "");
            return !cam.isSensor && cam.type === `cam360_${targetFloorId}`;
          } else {
            return !cam.isSensor && cam.type === filterMode;
          }
        }

        // Camera type filters (legacy or specific)
        if (filterMode === "upper" || filterMode === "lower" || filterMode === "cam360" || filterMode === "cam360_upper") {
          return !cam.isSensor && cam.type === filterMode;
        }

        // Sensor specific filters
        if (filterMode === "sensor_upper") {
          return cam.isSensor && cam.sensor_type === "upper";
        }
        if (filterMode === "sensor_lower") {
          return cam.isSensor && cam.sensor_type === "lower";
        }
        if (filterMode === "sensor_on") {
          return cam.isSensor && cam.sensorStatus === "on";
        }
        if (filterMode === "sensor_off") {
          return cam.isSensor && (cam.sensorStatus === "off" || cam.isOff);
        }

        // Status filters (cameras)
        if (filterMode === "status_on") {
          const status = typeof cam.status === "string" ? cam.status.toLowerCase() : "";
          return !cam.isSensor && status !== "off";
        }
        if (filterMode === "status_off") {
          const status = typeof cam.status === "string" ? cam.status.toLowerCase() : "";
          return !cam.isSensor && status === "off";
        }

        return true;
      });
    }

    return result;
  }, [cameras, filterMode, deviceMode, editMode]);

  const totalCamerasOnMap = useMemo(() => {
    if (!cameras) return 0;
    const allOnMap = cameras.filter((c) => typeof c.x === "number" && typeof c.y === "number");

    // Count based on device mode
    if (deviceMode === "cameras") {
      return allOnMap.filter((c) => !c.isSensor).length;
    } else if (deviceMode === "sensors") {
      return allOnMap.filter((c) => c.isSensor).length;
    }
    // deviceMode === "all" - count all devices
    return allOnMap.length;
  }, [cameras, deviceMode]);

  const currentFilterLabel = useMemo(() => {
    // For "all" filter in each mode
    if (filterMode === "all") {
      if (deviceMode === "all") {
        return t("filter.allDevices", "Tất cả thiết bị");
      } else if (deviceMode === "sensors") {
        return t("sensorFilter.all");
      } else {
        return t("filter.all");
      }
    }

    // For other filters, use normal logic
    const options = deviceMode === "all" ? getCombinedFilterOptions(t, selectedFloor) : deviceMode === "sensors" ? getSensorFilterOptions(t, selectedFloor) : getFilterOptions(t, selectedFloor);
    const found = options.find((f) => f.value === filterMode);
    return found?.label || t("filter.all");
  }, [filterMode, deviceMode, t]);

  // begin drag (stable)
  const onBeginDrag = useCallback(
    (id, x, y) => {
      dragClickGuardRef.current = false;
      setDraggingId(id);
      dragStartRef.current = { id, x, y };
      onSelectCamera?.(id);
    },
    [onSelectCamera]
  );

  return (
    <div className="absolute inset-0 overflow-hidden bg-white">
      <TransformWrapper
        initialScale={0.85}
        minScale={0.85}
        maxScale={8}
        wheel={{ step: 0.3 }}
        doubleClick={{ disabled: true }}
        panning={{ velocityDisabled: true }}
        onTransformed={(_ref, state) => {
          if (state && typeof state.scale === "number") {
            applyZoomVarsRaf(state.scale);
          }
          recalcInspectorLineRaf();
        }}
      >
        {({ zoomIn, zoomOut, resetTransform, setTransform }) => {
          controlsRef.current = { setTransform };

          const handleReset = () => resetTransform();

          const handleMove = (e) => {
            if (e.buttons === 1) dragClickGuardRef.current = true;

            if (!draggingId || !editMode) return;
            if (!containerRef.current) return;

            const rect = containerRef.current.getBoundingClientRect();
            const cxNew = e.clientX - rect.left;
            const cyNew = e.clientY - rect.top;

            const xPercent = (cxNew / rect.width) * 100;
            const yPercent = (cyNew / rect.height) * 100;

            onUpdateCamera(draggingId, { x: xPercent, y: yPercent });
          };

          const stopDragging = () => {
            if (!draggingId || !editMode) {
              setDraggingId(null);
              return;
            }

            const dragged = camerasById.get(String(draggingId));

            if (dragged) {
              const tooClose = (cameras || []).some((c) => {
                if (String(c.id) === String(dragged.id)) return false;
                if (
                  typeof c.x !== "number" ||
                  typeof c.y !== "number" ||
                  typeof dragged.x !== "number" ||
                  typeof dragged.y !== "number"
                ) {
                  return false;
                }
                const dx = c.x - dragged.x;
                const dy = c.y - dragged.y;
                const dist = Math.hypot(dx, dy);
                return dist < MIN_CENTER_DIST_PERCENT;
              });

              if (tooClose && dragStartRef.current && String(dragStartRef.current.id) === String(dragged.id)) {
                onUpdateCamera(dragged.id, { x: dragStartRef.current.x, y: dragStartRef.current.y });
              }
            }

            setDraggingId(null);
          };

          return (
            <>
              {/* Controls */}
              <div className="absolute left-4 bottom-4 z-20 flex gap-2 items-center">
                <button
                  onClick={() => zoomOut()}
                  className="h-9 w-9 rounded-full bg-white shadow-md border border-slate-200 flex items-center justify-center text-slate-700 hover:bg-slate-50"
                >
                  −
                </button>
                <button
                  onClick={() => zoomIn()}
                  className="h-9 w-9 rounded-full bg-white shadow-md border border-slate-200 flex items-center justify-center text-slate-700 hover:bg-slate-50"
                >
                  +
                </button>
                <button
                  onClick={handleReset}
                  className="px-3 h-9 rounded-full bg-white shadow-md border border-slate-200 text-xs text-slate-600 hover:bg-slate-50"
                >
                  {t("map.reset")}
                </button>

                {/* Level Switcher (CH only) */}
                <LevelSwitcher selectedFloor={selectedFloor} onFloorChange={onFloorChange} />

                {/* Device Mode Toggle */}
                {!editMode && (
                  <button
                    onClick={toggleDeviceMode}
                    className="px-3 h-9 rounded-full bg-white shadow-md border border-slate-200 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5"
                  >
                    {deviceMode === "all" && (
                      <>
                        <span className="text-emerald-500">●</span>
                        <span>{t("deviceMode.all", "All")}</span>
                      </>
                    )}
                    {deviceMode === "cameras" && (
                      <>
                        <span className="text-blue-500">●</span>
                        <span>{t("deviceMode.cameras", "Cameras")}</span>
                      </>
                    )}
                    {deviceMode === "sensors" && (
                      <>
                        <span className="text-orange-500">●</span>
                        <span>{t("deviceMode.sensors", "Sensors")}</span>
                      </>
                    )}
                  </button>
                )}

                {!editMode && (
                  <div className="relative">
                    <button
                      onClick={() => setFilterOpen((open) => !open)}
                      className="px-3 h-9 rounded-full bg-white shadow-md border border-slate-200 text-[11px] text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                    >
                      <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
                      <span className="truncate max-w-[160px]">{currentFilterLabel}</span>
                      {filterMode === "all" && <span className="text-[11px] text-slate-500">({totalCamerasOnMap})</span>}
                    </button>

                    {filterOpen && (
                      <div className="absolute bottom-11 left-0 z-30 bg-white rounded-xl shadow-xl border border-slate-200 text-xs text-slate-700 min-w-[220px] overflow-hidden">
                        {(deviceMode === "all" ? getCombinedFilterOptions(t, selectedFloor) : deviceMode === "sensors" ? getSensorFilterOptions(t, selectedFloor) : getFilterOptions(t, selectedFloor)).map((opt) => (
                          <button
                            key={opt.value}
                            onClick={() => {
                              setFilterMode(opt.value);
                              setFilterOpen(false);
                            }}
                            className={`w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 ${filterMode === opt.value ? "bg-slate-100 font-semibold" : ""
                              }`}
                          >
                            <span>{opt.label}</span>
                            {opt.value === "all" && <span className="text-[11px] text-slate-500">({totalCamerasOnMap})</span>}
                            {filterMode === opt.value && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 ml-auto" />}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* MAP */}
              <TransformComponent
                wrapperClass="w-full h-full"
                contentClass="w-full h-full"
                wrapperStyle={{ width: "100%", height: "100%" }}
                contentStyle={{ width: "100%", height: "100%" }}
              >
                <div className="w-full h-full flex items-center justify-center">
                  <div
                    ref={containerRef}
                    className={`relative ${editMode ? "cursor-crosshair" : "cursor-default"}`}
                    style={{
                      aspectRatio: currentConfig.aspectRatio,
                      width: "auto",
                      maxWidth: "100%",
                      maxHeight: "100%",
                      ["--iconScale"]: 1,
                      ["--labelScale"]: 1,
                      ["--labelOffsetPx"]: "22px",
                    }}
                    onMouseDown={() => {
                      dragClickGuardRef.current = false;
                    }}
                    onMouseMove={handleMove}
                    onMouseUp={stopDragging}
                    onMouseLeave={stopDragging}
                    onClick={(e) => {
                      if (dragClickGuardRef.current) {
                        dragClickGuardRef.current = false;
                        return;
                      }
                      if (!editMode || !onMapClick) return;
                      if (!containerRef.current) return;

                      const rect = containerRef.current.getBoundingClientRect();
                      const x = ((e.clientX - rect.left) / rect.width) * 100;
                      const y = ((e.clientY - rect.top) / rect.height) * 100;
                      onMapClick(x, y);
                    }}
                  >
                    {/* Render ALL floor map images to keep them decoded in DOM memory, toggling visibility with CSS */}
                    {currentConfig.factoryId === 'ch' && currentConfig.floors ? (
                      <>
                        <img
                          src={currentConfig.mapImage}
                          alt="overview-map"
                          className="w-full h-full select-none pointer-events-none"
                          style={{ display: !selectedFloor ? 'block' : 'none' }}
                        />
                        {currentConfig.floors.map(f => (
                          <img
                            key={f.id}
                            src={f.mapImage}
                            alt={`map-${f.id}`}
                            className="w-full h-full select-none pointer-events-none"
                            style={{ display: selectedFloor === f.id ? 'block' : 'none' }}
                          />
                        ))}
                      </>
                    ) : (
                      <img src={mapImage} alt="map" className="w-full h-full select-none pointer-events-none opacity-100" />
                    )}

                    {filteredCameras.map((cam, idx) => {
                      let cfg = CAMERA_TYPES[cam.type];

                      // Handle specific sensor types
                      if (cam.isSensor) {
                        if (cam.sensor_type?.startsWith("floor")) {
                          cfg = CAMERA_TYPES.sensor_floor;
                        } else if (cam.sensor_type === 'upper') {
                          cfg = CAMERA_TYPES.sensor_upper;
                        } else if (cam.sensor_type === 'lower') {
                          cfg = CAMERA_TYPES.sensor_lower;
                        } else {
                          cfg = CAMERA_TYPES.sensor;
                        }
                      } else if (cam.type?.startsWith("cam360_floor")) {
                        cfg = CAMERA_TYPES.cam360;
                      } else if (cam.type?.startsWith("floor")) {
                        cfg = CAMERA_TYPES.floor; // Fallback for floor-based styles
                      }

                      if (!cfg) return null;

                      return (
                        <CameraMarker
                          key={`${cam.id}-${idx}`}
                          cam={cam}
                          cfg={cfg}
                          showFov={editMode || showFov}
                          editMode={editMode}
                          selected={selectedCameraId === cam.id}
                          hovered={hoveredId === cam.id}
                          isHighlighted={highlightedCameraId === cam.code}
                          cameraRefs={cameraRefs}
                          setHoveredId={setHoveredId}
                          onSelectCamera={onSelectCamera}
                          onInspectCamera={onInspectCamera}
                          onViewCameraDetails={onViewCameraDetails}
                          onUpdateCamera={onUpdateCamera}
                          onBeginDrag={onBeginDrag}
                          onOpenContextMenu={onOpenContextMenu}
                        />
                      );
                    })}
                  </div>
                </div>
              </TransformComponent>

              {contextMenu.open && <div className="fixed inset-0 z-30" onClick={closeContextMenu} />}

              {contextMenu.open && contextMenu.camera && (
                <div
                  className="fixed z-40 bg-white rounded-xl shadow-xl border border-slate-200 text-xs text-slate-700"
                  style={{ top: contextMenu.y + 8, left: contextMenu.x + 8 }}
                >
                  <button
                    className="block w-full text-left px-3 py-2 text-red-600 hover:bg-red-50"
                    onClick={() => openDeleteConfirm(contextMenu.camera)}
                  >
                    {t("button.delete")}
                  </button>
                </div>
              )}

              <ConfirmDialog
                open={confirmState.open}
                title={
                  confirmState.camera?.isSensor
                    ? t("deleteSensor.title")
                    : t("delete.title")
                }
                description={
                  confirmState.camera
                    ? confirmState.camera.isSensor
                      ? `${t("deleteSensor.descriptionPrefix")} ${confirmState.camera.code || "?"} ${t("deleteSensor.descriptionSuffix")}`
                      : `${t("delete.descriptionPrefix")} ${confirmState.camera.code || "?"} ${t("delete.descriptionSuffix")}`
                    : ""
                }
                confirmLabel={t("button.delete")}
                cancelLabel={t("button.cancel")}
                onCancel={closeConfirm}
                onConfirm={handleConfirmDelete}
                variant="danger"
              />
            </>
          );
        }}
      </TransformWrapper>

      {/* tether line */}
      {inspectorLine && (
        <svg className="pointer-events-none fixed inset-0 z-30" width="100%" height="100%">
          <line
            x1={inspectorLine.x1}
            y1={inspectorLine.y1}
            x2={inspectorLine.x2}
            y2={inspectorLine.y2}
            stroke={inspectorLine.color}
            strokeWidth="3"
            strokeLinecap="round"
          />
          <circle cx={inspectorLine.x2} cy={inspectorLine.y2} r="5" fill="#0f172a" />
          <circle cx={inspectorLine.x2} cy={inspectorLine.y2} r="3" fill={inspectorLine.color} />
        </svg>
      )}
    </div>
  );
}

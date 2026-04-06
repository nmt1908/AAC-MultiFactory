import { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

// Custom hooks
import { useLocalStorage } from '../hooks/useLocalStorage';
import { useSensorWebSocket } from '../hooks/useSensorWebSocket';
import { useInspector } from '../hooks/useInspector';
import { useAlertDialog } from '../hooks/useAlertDialog';
import { useAlertsApi } from '../hooks/useAlertsApi';
import { useLayoutApi } from '../hooks/useLayoutApi';
import { useSensorApi } from '../hooks/useSensorApi';
import { useUnmappedCameras } from '../hooks/useUnmappedCameras';

// Components
import MapView from '../components/MapView';
import RightPanel from '../components/RightPanel';
import ConfirmDialog from '../components/ConfirmDialog';
import AlertDialog from '../components/AlertDialog';
import TopBar from '../components/TopBar';
import AlertImageDialog from '../components/AlertImageDialog';
import InspectorWindow from '../components/InspectorWindow';
import InspectorFullscreen from '../components/InspectorFullscreen';

import { currentConfig } from '../config/factoryConfig';
const mapImage = currentConfig.mapImage;

// Lottie animations
import successAnim from '../assets/lotties/successAnimation.json';
import failedAnim from '../assets/lotties/failedAnimation.json';

const DEFAULT_RANGES = {
  upper: 100,
  lower: 100,
  cam360: 30,
  cam360_upper: 30,
};

const FISHEYE_EXCEPT_CODES = ['B2006_WR', 'B2009_WR'];

export default function Home({ userData, onLogout, onNavigateToManage }) {
  const { t, i18n } = useTranslation('common');
  const [mapKey, setMapKey] = useState(0);

  // ===== Custom Hooks =====
  const [seenAlertIds, setSeenAlertIds] = useLocalStorage('cctv_seen_alert_ids_v1', []);
  const { sensorReadings, setSensorReadings } = useSensorWebSocket();
  const { inspector, openInspector, closeInspector, toggleFullscreen, updateInspectorPosition, updateInspectorSize } = useInspector();
  const { alertState, showAlert, closeAlert } = useAlertDialog();

  // ===== State =====
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [mapZoom, setMapZoom] = useState(0.85); // Track map zoom level
  const [editMode, setEditMode] = useState(false);
  const [alarmState, setAlarmState] = useState({});
  const [placingType, setPlacingType] = useState(null);
  const [selectedCameraId, setSelectedCameraId] = useState(null);
  const [selectedFloor, setSelectedFloor] = useState(() => {
    if (currentConfig.factoryId === 'vg') return null;
    return currentConfig.floors?.length > 0 ? currentConfig.floors[0].id : null;
  });
  const [confirmSave, setConfirmSave] = useState(false);
  const [confirmSaveSensor, setConfirmSaveSensor] = useState(false);
  const [viewCamera, setViewCamera] = useState(null);
  const [focusCameraCode, setFocusCameraCode] = useState(null);
  const [viewedAlert, setViewedAlert] = useState(null);
  const [highlightedCameraId, setHighlightedCameraId] = useState(null);

  // ===== API Hooks =====
  const { cameras, setCameras, saveLayout, deleteCamera: apiDeleteCamera, deleteSensor: apiDeleteSensor } = useLayoutApi();
  const { sensorDetails, saveSensorLayout, getSensorListForAllCctv } = useSensorApi();
  const { allCctv, setAllCctv, totalUnmapped } = useUnmappedCameras();

  // Panel state change handler cho alerts API
  const handlePanelStateChange = useCallback(({ isPanelOpen: newPanelOpen, viewCamera: newViewCamera }) => {
    if (newPanelOpen !== undefined) setIsPanelOpen(newPanelOpen);
    if (newViewCamera !== undefined) setViewCamera(newViewCamera);
  }, []);

  const { alerts } = useAlertsApi(seenAlertIds, editMode, viewCamera, viewedAlert, handlePanelStateChange);

  // ===== Effects =====
  // Add sensors to allCctv when sensorDetails loads
  useEffect(() => {
    const sensorList = getSensorListForAllCctv();
    if (sensorList.length === 0) return;

    setAllCctv((prev) => {
      const existingCodes = new Set(prev.map((c) => c.code));
      const newSensors = sensorList.filter((s) => !existingCodes.has(s.code));
      return [...prev, ...newSensors];
    });
  }, [getSensorListForAllCctv, setAllCctv]);

  // Update cameras with sensor details
  useEffect(() => {
    if (sensorDetails.length === 0) return;

    setCameras((prev) =>
      prev.map((cam) => {
        if (!cam.isSensor) return cam;

        const sensor = sensorDetails.find((d) => d.device_id === cam.code);
        if (!sensor) return cam;

        return {
          ...cam,
          ...sensor,
          id: cam.id,
          code: cam.code,
          isSensor: true, // Force preserve
          sensor_type: cam.sensor_type || sensor.sensor_type,
        };
      })
    );
  }, [sensorDetails, setCameras]);

  // Initial load of sensor readings from API
  useEffect(() => {
    if (sensorDetails.length === 0) return;

    setSensorReadings((prev) => {
      const next = { ...prev };
      let changed = false;
      sensorDetails.forEach((s) => {
        // Only initialize if not already present in readings (to avoid overwriting fresh WS data)
        if (s.device_id && !next[s.device_id] && s.temperature !== undefined) {
          // Use server timestamp if available to accurately calculate on/off status
          const serverTime = s.timestamp ? new Date(s.timestamp).getTime() : Date.now();

          next[s.device_id] = {
            temperature: s.temperature,
            humidity: s.humidity,
            timestamp: s.timestamp || new Date().toISOString(),
            receivedAt: serverTime,
          };
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [sensorDetails, setSensorReadings]);

  // Remount MapView only on fullscreen change (not on every resize)
  useEffect(() => {
    const handleFullscreenChange = () => {
      setMapKey((prev) => prev + 1);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  // ===== Memoized Values =====
  const selectedCamera = useMemo(
    () => cameras.find((c) => c.id === selectedCameraId) || null,
    [cameras, selectedCameraId]
  );

  const activeMapImage = useMemo(() => {
    if (currentConfig.factoryId === 'ch' && currentConfig.floors && selectedFloor) {
      const floor = currentConfig.floors.find(f => f.id === selectedFloor);
      return floor?.mapImage || currentConfig.mapImage;
    }
    return currentConfig.mapImage; // defaults to mapCH
  }, [selectedFloor]);

  const usedCodes = useMemo(
    () =>
      new Set(
        cameras
          .filter((c) => c.id !== selectedCameraId)
          .map((c) => c.code?.trim())
          .filter(Boolean)
      ),
    [cameras, selectedCameraId]
  );

  const unmappedCameras = useMemo(() => {
    return allCctv
      .filter((c) => c.code && !usedCodes.has(c.code))
      .map((cam) => {
        if (!cam.isSensor) return cam;

        const reading = sensorReadings[cam.code];

        // Calculate sensor status: on/off based on 5-minute timeout
        let sensorStatus = 'off';
        if (reading?.receivedAt) {
          const now = Date.now();
          if (now - reading.receivedAt < 5 * 60 * 1000) {
            sensorStatus = 'on';
          }
        }

        return {
          ...cam,
          sensorStatus,
          currentReading: reading,
        };
      });
  }, [allCctv, usedCodes, sensorReadings]);

  const latestAlertByCode = useMemo(() => {
    const map = {};
    for (const a of alerts) {
      if (!a.camera_code || map[a.camera_code.trim()]) continue;
      map[a.camera_code.trim()] = a;
    }
    return map;
  }, [alerts]);

  const cctvByCode = useMemo(() => {
    const map = {};
    for (const c of allCctv) {
      if (c.code) map[c.code] = c;
    }
    return map;
  }, [allCctv]);

  const seenIdSet = useMemo(() => new Set(seenAlertIds || []), [seenAlertIds]);

  const camerasForMap = useMemo(() => {
    // Filter by floor if multiple floors exist
    const filteredByFloor = cameras.filter(cam => {
      if (currentConfig.factoryId !== 'ch') return true;
      if (!selectedFloor) return true; // Show all if no floor selected (Overview)

      if (cam.isSensor) {
        return cam.sensor_type === selectedFloor;
      }

      // Camera type for floor-based layout
      return cam.type === selectedFloor || cam.type === `cam360_${selectedFloor}`;
    });

    return filteredByFloor.map((cam) => {
      const key = cam.code || String(cam.id);

      const extra =
        cam.code && cctvByCode[cam.code]
          ? {
            status: cctvByCode[cam.code].status,
            location_json: cctvByCode[cam.code].location_json,
          }
          : {};

      // For sensors, calculate status + threshold breaches
      let sensorData = {};
      let isBreached = false;
      let isOff = false;

      if (cam.isSensor && cam.code) {
        const reading = sensorReadings[cam.code];
        const detail = sensorDetails.find((d) => d.device_id === cam.code);
        const config = detail?.sensorConfig;

        let sensorStatus = 'off';
        if (reading?.receivedAt) {
          const now = Date.now();
          if (now - reading.receivedAt < 5 * 60 * 1000) {
            sensorStatus = 'on';
          }
        }
        isOff = sensorStatus === 'off';

        // Check range
        if (config && reading && sensorStatus === 'on') {
          const { temp_low, temp_high, hum_low, hum_high } = config;
          const { temperature, humidity } = reading;
          if (
            (temp_low != null && temperature < temp_low) ||
            (temp_high != null && temperature > temp_high) ||
            (hum_low != null && humidity < hum_low) ||
            (hum_high != null && humidity > hum_high)
          ) {
            isBreached = true;
          }
        }

        sensorData = {
          sensorStatus,
          currentReading: reading,
          sensorConfig: config,
          isBreached,
          isOff,
        };
      }

      const rawAlert = cam.code ? latestAlertByCode[cam.code] : null;

      // Nếu alert đã xem rồi → bỏ
      const alertObj =
        rawAlert && rawAlert.id != null && seenIdSet.has(rawAlert.id) ? null : rawAlert;

      let alertColor = null;
      if (alertObj?.event_code === 'fire') alertColor = 'red';
      else if (alertObj?.event_code === 'intruder') alertColor = 'yellow';
      else if (alertObj?.event_code === 'smartphone') alertColor = 'green';
      else if (cam.isSensor) {
        if (isOff) alertColor = '#94a3b8';
        else if (isBreached) alertColor = '#f97316';
      }

      return {
        ...cam,
        ...extra,
        ...sensorData,

        // alarm when: manual, alert chưa xem, hoặc sensor lỗi/vượt ngưỡng
        alarm: !!alarmState[key] || !!alertObj || (cam.isSensor && (isBreached || isOff)),

        alertThumb: alertObj?.thumbUrl || null,
        alertFull: alertObj?.fullUrl || null,
        alertCode: alertObj?.event_code || null,
        alertTime: alertObj?.created_unix || null,
        alertColor,
      };
    });
  }, [cameras, selectedFloor, alarmState, cctvByCode, latestAlertByCode, seenIdSet, sensorReadings, sensorDetails]);

  const isInspector360 = useMemo(
    () =>
      inspector.open &&
      inspector.camera &&
      !FISHEYE_EXCEPT_CODES.includes(inspector.camera.code) &&
      (inspector.camera.type === 'cam360' || inspector.camera.type === 'cam360_upper'),
    [inspector]
  );

  const inspectorLink = useMemo(() => {
    if (!inspector.open || editMode || inspector.mode !== 'window' || !inspector.camera) {
      return null;
    }

    return {
      cameraId: inspector.camera.id,
      centerX: inspector.x + inspector.width / 2,
      centerY: inspector.y + inspector.height / 2,
    };
  }, [inspector, editMode]);

  // ===== Event Handlers (Memoized) =====
  const handleMapClick = useCallback(
    (x, y) => {
      if (!editMode || !placingType) return;

      const id = crypto.randomUUID?.() ?? Date.now().toString();

      const isCircle = placingType.startsWith('cam360');
      const isSensorPlacing = placingType.startsWith('sensor_');

      let finalType = isSensorPlacing ? 'sensor' : placingType;
      if (currentConfig.factoryId === 'vg' && finalType === 'cam360_lower') {
        finalType = 'cam360';
      }

      const newCam = {
        id,
        x,
        y,
        type: finalType,
        isSensor: isSensorPlacing,
        sensor_type: isSensorPlacing ? placingType.split('_')[1] : undefined,
        code: '',
        hasLayout: false,
        range: isCircle || isSensorPlacing ? undefined : DEFAULT_RANGES[finalType] ?? 100,
        angle: isCircle || isSensorPlacing ? undefined : 0,
        radius: isCircle ? DEFAULT_RANGES[finalType] ?? 30 : undefined,
        status: 'working',
      };

      setCameras((prev) => [...prev, newCam]);
      setSelectedCameraId(id);
      setViewCamera?.(null);
    },
    [editMode, placingType, setCameras]
  );

  const handleSelectCamera = useCallback(
    (id) => {
      if (!editMode) return;
      setSelectedCameraId(id);
    },
    [editMode]
  );

  const handleUpdateCamera = useCallback(
    (id, patch) => {
      setCameras((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
    },
    [setCameras]
  );

  const handleDeleteCamera = useCallback(
    async (id, options = {}) => {
      const cam = cameras.find((c) => c.id === id);
      if (!cam) return;

      const removeLocal = () => {
        setCameras((prev) => prev.filter((c) => c.id !== id));

        setAlarmState((prev) => {
          const next = { ...prev };
          if (cam.code) delete next[cam.code];
          return next;
        });

        if (selectedCameraId === id) {
          setSelectedCameraId(null);
        }

        if (inspector.camera?.id === id) {
          closeInspector();
        }
      };

      // Local only or not yet saved
      if (options.localOnly || !cam.hasLayout || !cam.code) {
        removeLocal();
        return;
      }

      try {
        await apiDeleteCamera(cam.code);
        removeLocal();

        showAlert({
          title: t('delete.successTitle'),
          message: t('delete.successMessage', { code: cam.code || cam.id }),
          animationData: successAnim,
        });
      } catch (err) {
        console.error('Delete layout failed:', err);
        showAlert({
          title: t('delete.failedTitle'),
          message: t('delete.failedMessage'),
          animationData: failedAnim,
        });
      }
    },
    [cameras, selectedCameraId, inspector.camera, setCameras, closeInspector, apiDeleteCamera, showAlert, t]
  );

  const handleDeleteSensor = useCallback(
    async (id, options = {}) => {
      const sensor = cameras.find((c) => c.id === id);
      if (!sensor || !sensor.isSensor) return;

      const removeLocal = () => {
        setCameras((prev) => prev.filter((c) => c.id !== id));

        if (selectedCameraId === id) {
          setSelectedCameraId(null);
        }

        if (inspector.camera?.id === id) {
          closeInspector();
        }
      };

      // Local only or not yet saved (check if has x,y coordinates from DB)
      if (options.localOnly || !sensor.hasLayout || !sensor.code) {
        removeLocal();
        return;
      }

      try {
        await apiDeleteSensor(sensor.code);
        removeLocal();

        showAlert({
          title: t('deleteSensor.successTitle'),
          message: t('deleteSensor.successMessage', { code: sensor.code || sensor.id }),
          animationData: successAnim,
        });
      } catch (err) {
        console.error('Delete sensor layout failed:', err);
        showAlert({
          title: t('deleteSensor.failedTitle'),
          message: t('deleteSensor.failedMessage'),
          animationData: failedAnim,
        });
      }
    },
    [cameras, selectedCameraId, inspector.camera, setCameras, closeInspector, apiDeleteSensor, showAlert, t]
  );

  const toggleEditMode = useCallback(() => {
    setEditMode((m) => !m);
    if (!editMode) {
      setIsPanelOpen(true);
      setViewCamera(null);
    } else {
      setSelectedCameraId(null);
      setPlacingType(null);
      closeInspector();
      setViewCamera(null);
    }
  }, [editMode, closeInspector]);

  const handleClickSave = useCallback(() => {
    if (!editMode) return;

    const hasMissingCode = cameras.some((cam) => !cam.code || !cam.code.trim());

    if (hasMissingCode) {
      showAlert({
        title: t('save.failedTitle'),
        message: t('save.failedMessage'),
        animationData: failedAnim,
      });
      return;
    }

    setConfirmSave(true);
  }, [editMode, cameras, showAlert, t]);

  const handleClickSaveSensor = useCallback(() => {
    if (!editMode) return;

    // Get all sensors that are on the map
    const sensorsOnMap = cameras.filter((c) => c.isSensor && c.code && c.code.trim());

    // Check for invalid sensor codes
    const validSensorCodes = new Set(sensorDetails.map((s) => s.device_id));
    const invalidSensors = sensorsOnMap.filter((sensor) => !validSensorCodes.has(sensor.code));

    if (invalidSensors.length > 0) {
      const invalidCodes = invalidSensors.map((s) => s.code).join(', ');
      showAlert({
        title: t('save.failedTitle'),
        message: t('save.invalidSensorMessage', { codes: invalidCodes }),
        animationData: failedAnim,
      });
      return;
    }

    setConfirmSaveSensor(true);
  }, [editMode, cameras, sensorDetails, showAlert, t, failedAnim]);

  const handleConfirmSave = useCallback(async () => {
    setConfirmSave(false);

    try {
      await saveLayout(cameras);

      setCameras((prev) => prev.map((c) => ({ ...c, hasLayout: true })));

      setIsPanelOpen(false);
      setEditMode(false);
      setPlacingType(null);
      setSelectedCameraId(null);
      closeInspector();

      showAlert({
        title: t('save.successTitle'),
        message: t('save.successMessage'),
        animationData: successAnim,
      });
    } catch (err) {
      console.error('Save CCTV layout failed:', err);
      showAlert({
        title: t('save.failedTitle'),
        message: t('save.failedGenericMessage'),
        animationData: failedAnim,
      });
    }
  }, [cameras, saveLayout, setCameras, closeInspector, showAlert, t]);

  const handleConfirmSaveSensor = useCallback(async () => {
    setConfirmSaveSensor(false);
    try {
      await saveSensorLayout(cameras);

      setCameras((prev) => prev.map((c) => (c.isSensor ? { ...c, hasLayout: true } : c)));

      showAlert({
        title: t('save.successTitle'),
        message: t('save.successMessage'),
        animationData: successAnim,
      });

      setIsPanelOpen(false);
      setEditMode(false);
      setPlacingType(null);
      setSelectedCameraId(null);
    } catch (err) {
      console.error('Save sensor layout failed:', err);
      showAlert({
        title: t('save.failedTitle'),
        message: t('save.failedGenericMessage'),
        animationData: failedAnim,
      });
    }
  }, [cameras, saveSensorLayout, setCameras, showAlert, t]);

  const handleInspectCamera = useCallback(
    (camera) => {
      if (editMode) return;
      // Requests: Sensor click should NOT open inspector
      if (camera.isSensor) return;
      openInspector(camera);
    },
    [editMode, openInspector]
  );

  const handleViewCameraDetails = useCallback(
    (camera) => {
      if (editMode) return;

      setViewCamera(camera);
      setSelectedCameraId(null);
      setIsPanelOpen(true);
    },
    [editMode]
  );

  const handlePickCameraCode = useCallback(
    (code) => {
      if (!editMode || !selectedCamera) return;

      const item = allCctv.find((c) => c.code === code);
      const patch = { code };
      if (item?.isSensor) {
        patch.type = 'sensor';
        patch.isSensor = true;
      }

      handleUpdateCamera(selectedCamera.id, patch);
    },
    [editMode, selectedCamera, allCctv, handleUpdateCamera]
  );

  const handleAlertClick = useCallback(
    (alert) => {
      if (!alert) return;

      // Smart grouping: mark similar alerts as seen
      // Find all alerts from same camera, same event, within 30 seconds
      const TIME_WINDOW = 30; // seconds
      const clickedTime = alert.created_unix;
      const clickedCamera = alert.camera_code;
      const clickedEvent = alert.event_code?.toLowerCase?.();

      const similarAlertIds = alerts
        .filter((a) => {
          if (!a.id || a.id === alert.id) return false;
          if (a.camera_code !== clickedCamera) return false;
          if (a.event_code?.toLowerCase?.() !== clickedEvent) return false;

          // Within 30 second window
          const timeDiff = Math.abs(a.created_unix - clickedTime);
          return timeDiff <= TIME_WINDOW;
        })
        .map((a) => a.id)
        .filter((id) => id != null);

      // Mark clicked alert + similar alerts as seen
      const idsToMark = [alert.id, ...similarAlertIds].filter((id) => id != null);

      if (idsToMark.length > 0) {
        setSeenAlertIds((prev) => {
          const newSet = new Set(prev);
          idsToMark.forEach((id) => newSet.add(id));
          return Array.from(newSet);
        });
      }

      setViewedAlert(alert);

      if (!alert.camera_code) return;
      const cam = cameras.find((c) => c.code && c.code === alert.camera_code);
      if (!cam) return;

      setFocusCameraCode(alert.camera_code);

      if (editMode) {
        setSelectedCameraId(cam.id);
      }
    },
    [cameras, editMode, setSeenAlertIds, alerts]
  );

  const setLang = useCallback(
    (lng) => {
      i18n.changeLanguage(lng);
    },
    [i18n]
  );

  const handleFloorChange = useCallback((floorId) => {
    setSelectedFloor(floorId);
    if (editMode) {
      if (placingType) {
        let placingFloorId = null;
        if (currentConfig.factoryId === 'vg') {
          if (placingType.includes('upper')) placingFloorId = 'upper';
          else if (placingType.includes('lower') || placingType === 'cam360') placingFloorId = 'lower';
          else placingFloorId = placingType;
        } else {
          if (placingType.startsWith('sensor_')) placingFloorId = placingType.replace('sensor_', '');
          else if (placingType.startsWith('cam360_')) placingFloorId = placingType.replace('cam360_', '');
          else placingFloorId = placingType;
        }
        if (placingFloorId && placingFloorId !== floorId) {
          setPlacingType(null);
        }
      }

      // Deselect camera to prevent editing invisible cross-floor cameras
      setSelectedCameraId(null);

      // Clean up newly placed incomplete cameras that have no code, which would otherwise block saving other floors
      setCameras((prev) => prev.filter((cam) => cam.hasLayout || (cam.code && cam.code.trim() !== '')));
    }
  }, [editMode, placingType, setCameras]);

  const handlePlaceTypeChange = useCallback((type) => {
    setPlacingType(type);
    if (!type) return;

    let floorId = null;
    if (currentConfig.factoryId === 'vg') {
      if (type.includes('upper')) floorId = 'upper';
      else if (type.includes('lower') || type === 'cam360') floorId = 'lower';
      else floorId = type;
    } else {
      if (type.startsWith('sensor_')) floorId = type.replace('sensor_', '');
      else if (type.startsWith('cam360_')) floorId = type.replace('cam360_', '');
      else floorId = type;
    }

    const isValidFloor = currentConfig.floors?.some(f => f.id === floorId);
    if (isValidFloor) {
      setSelectedFloor(floorId);
    }
  }, []);

  const handleTogglePanel = useCallback(() => {
    if (!isPanelOpen) setViewCamera(null);
    setIsPanelOpen((v) => !v);
  }, [isPanelOpen]);

  const handleInspectorDragStop = useCallback(
    (x, y) => {
      updateInspectorPosition(x, y);
    },
    [updateInspectorPosition]
  );

  const handleInspectorResizeStop = useCallback(
    (width, height, x, y) => {
      updateInspectorSize(width, height, x, y);
    },
    [updateInspectorSize]
  );

  // ===== Render =====
  return (
    <div className="fixed inset-0 bg-white overflow-hidden">
      {/* MAP - chỉ đẩy map khi zoom chưa quá 50% */}
      <div
        className={`
          relative h-full flex-1
          transition-[margin-right] duration-300 ease-out
          ${isPanelOpen && mapZoom < 1.5 && currentConfig.useSidePanelMargin ? 'mr-[360px]' : 'mr-0'}
        `}
      >
        <MapView
          key={mapKey}
          mapImage={activeMapImage}
          selectedFloor={selectedFloor}
          onFloorChange={handleFloorChange}
          cameras={camerasForMap}
          editMode={editMode}
          alerts={alerts}
          focusCameraCode={focusCameraCode}
          selectedCameraId={editMode ? selectedCameraId : null}
          highlightedCameraId={highlightedCameraId}
          onMapClick={handleMapClick}
          onSelectCamera={handleSelectCamera}
          onUpdateCamera={handleUpdateCamera}
          onDeleteCamera={handleDeleteCamera}
          onDeleteSensor={handleDeleteSensor}
          onInspectCamera={handleInspectCamera}
          onViewCameraDetails={handleViewCameraDetails}
          inspectorLink={inspectorLink}
          alignLeft={isPanelOpen}
          onZoomChange={setMapZoom}
        />
      </div>

      {/* TOP BAR */}
      <TopBar
        editMode={editMode}
        onToggleEditMode={toggleEditMode}
        onChangeLanguage={setLang}
        onManageClick={onNavigateToManage}
        userData={userData}
        onLogout={onLogout}
      />

      {/* RIGHT PANEL */}
      <RightPanel
        isOpen={isPanelOpen}
        toggle={handleTogglePanel}
        editMode={editMode}
        placingType={placingType}
        onPlaceTypeChange={handlePlaceTypeChange}
        selectedCamera={selectedCamera}
        onUpdateSelectedCamera={(patch) => handleUpdateCamera(selectedCameraId, patch)}
        onClickSave={handleClickSave}
        onClickSaveSensor={handleClickSaveSensor}
        unmappedCameras={unmappedCameras}
        onPickCameraCode={handlePickCameraCode}
        unmappedTotal={unmappedCameras.length}
        alerts={alerts}
        onAlertClick={handleAlertClick}
        viewCamera={viewCamera}
        seenAlertIds={seenAlertIds}
      />

      {/* Confirm dialogs */}
      <ConfirmDialog
        open={confirmSave}
        title={t('save.confirmTitle')}
        description={t('save.confirmDesc')}
        confirmLabel={t('button.confirm')}
        cancelLabel={t('button.cancel')}
        onCancel={() => setConfirmSave(false)}
        onConfirm={handleConfirmSave}
      />

      <ConfirmDialog
        open={confirmSaveSensor}
        title={t('save.confirmTitle')}
        description={t('save.confirmDesc')}
        confirmLabel={t('button.confirm')}
        cancelLabel={t('button.cancel')}
        onCancel={() => setConfirmSaveSensor(false)}
        onConfirm={handleConfirmSaveSensor}
      />

      {/* Alert dialog (success / failed) */}
      <AlertDialog
        open={alertState.open}
        title={alertState.title}
        message={alertState.message}
        onClose={closeAlert}
        animationData={alertState.animationData}
        loop={true}
      />

      {/* Alert Image Dialog */}
      <AlertImageDialog
        alert={viewedAlert}
        onClose={() => {
          // Highlight the camera for 3 seconds
          if (viewedAlert?.camera_code) {
            setHighlightedCameraId(viewedAlert.camera_code);
            setTimeout(() => setHighlightedCameraId(null), 3000);
          }
          setViewedAlert(null);
        }}
      />

      {/* Inspector Window Mode */}
      <InspectorWindow
        inspector={inspector}
        onClose={closeInspector}
        onToggleFullscreen={toggleFullscreen}
        onDragStop={handleInspectorDragStop}
        onResizeStop={handleInspectorResizeStop}
      />

      {/* Inspector Fullscreen Mode */}
      <InspectorFullscreen
        inspector={inspector}
        onClose={closeInspector}
        onToggleFullscreen={toggleFullscreen}
      />
    </div>
  );
}

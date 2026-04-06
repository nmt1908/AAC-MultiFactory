import mapVG from '../assets/images/mapNetCang_cropped3.png';
import mapCH from '../assets/images/LatestMapChiHungNetCang.png';
import mapCHTang1 from '../assets/images/CH_Tang1.png';
import mapCHTang2 from '../assets/images/CH_Tang2.png';
import mapCHTang3 from '../assets/images/CH_Tang3.png';
import mapCHTang4 from '../assets/images/CH_Tang4.png';
import mapCHTang5 from '../assets/images/CH_Tang5.png';

const configs = {
    vg: {
        name: 'Nhà máy VG',
        apiBase: 'http://gmo021.cansportsvg.com/api/cctv',
        snapshotBase: 'http://10.13.34.154:8001/api/cctv/proxy/snapshot',
        sensorApiBase: 'http://10.13.34.166:4002/external/recent-readings',
        sensorConfigBase: 'http://10.13.34.166:4002/external/sensor-configs',
        sensorWsBase: 'ws://10.13.34.166:4002/external/ws',
        storageBase: 'http://gmo021.cansportsvg.com/api/storage/app/cctv/',
        mapImage: mapVG,
        aspectRatio: "9187 / 4448",
        useSidePanelMargin: true,
        useLevelSwitcher: false,
        floors: [
            { id: 'lower', labelKey: 'camera.typeLower' },
            { id: 'upper', labelKey: 'camera.typeUpper' },
        ],
    },
    ch: {
        name: 'Nhà máy CH',
        apiBase: 'http://10.1.1.101:8001/api/cctv',
        snapshotBase: 'http://10.1.1.101:8001/api/cctv/snapshot',
        sensorApiBase: 'http://10.1.1.250:4002/external/recent-readings',
        sensorConfigBase: 'http://10.1.1.250:4002/external/sensor-configs',
        sensorWsBase: 'ws://10.1.1.250:4002/external/ws',
        storageBase: 'http://10.1.1.101:8001/api/storage/',
        mapImage: mapCH,
        aspectRatio: "9332 / 6096",
        useSidePanelMargin: false,
        useLevelSwitcher: true,
        floors: [
            { id: 'floor1', labelKey: 'floor.1', mapImage: mapCHTang1 },
            { id: 'floor2', labelKey: 'floor.2', mapImage: mapCHTang2 },
            { id: 'floor3', labelKey: 'floor.3', mapImage: mapCHTang3 },
            { id: 'floor4', labelKey: 'floor.4', mapImage: mapCHTang4 },
            { id: 'floor5', labelKey: 'floor.5', mapImage: mapCHTang5 },
        ],
    },
};

const factoryId = import.meta.env.VITE_FACTORY_ID || 'vg';
const selectedConfig = configs[factoryId] || configs.vg;
export const currentConfig = { ...selectedConfig, factoryId };

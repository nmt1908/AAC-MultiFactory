<?php

namespace App\Http\Controllers;

use App\WarningMdl;
use App\cctvMdl;
use App\cctvCategoryMdl;
use App\cctvAreaMdl;
use App\msgCenterMsgDataTbl;
use App\cctv_layoutMdl;
use App\sensorMdl;
use App\employeeStatusMdl;
use DateTime;
use Carbon\Carbon;
use Illuminate\Http\Request;
use Illuminate\Support\Str; // Import Str để tạo token ngẫu nhiên

class cctvCtrl extends Controller
{

  public function downloadImg(Request $req)
  {
    $filename = $req->input('photo');
    $storagePath = storage_path('app/cctv/' . $filename);

    if (!file_exists($storagePath)) {
      return response()->json(['error' => 'File not found', 'path' => $storagePath], 404);
    }

    return response()->download($storagePath);
  }
  public function addNewArea(Request $req)
  {
    $area = $req->input('area');
    $m = cctvAreaMdl::create([
      'area' => json_encode($area),
    ]);
    return [
      'ret_code' => 0,
      'msg' => 'Created new area',
      'data' => $m,
    ];
  }
  public function addNewPurpose(Request $req)
  {
    $purpose_code = $req->input('purpose_code');
    $purpose = $req->input('purpose');
    $m = cctvCategoryMdl::create([
      'purpose_code' => $purpose_code,
      'category' => json_encode($purpose),
    ]);
    return [
      'ret_code' => 0,
      'msg' => 'Created new purpose',
      'data' => $m,
    ];
  }
  public function filterDataWhenSelectedChanges(Request $req)
  {
    $location = $req->input('location');
    $area = $req->input('area');
    $category = $req->input('category');

    // Bắt đầu truy vấn từ model cctvMdl với điều kiện status là 'working'
    $cctvs = cctvMdl::where('status', 'working');

    if ($location) {
      $cctvs = $cctvs->whereRaw('JSON_EXTRACT(location, "$.en") = ?', [$location]);
    }
    if ($area) {
      // $cctvs->area: ["1","2"....]
      // tìm xem area 1,2,3.... có trong mảng $cctvs->area không? 
      $cctvs = $cctvs->whereRaw('JSON_CONTAINS(area, ?)', [$area]);
    }
    if ($category) {
      $cctvs = $cctvs->whereRaw('JSON_CONTAINS(category, ?)', [$category]);
    }
    // $camerasSelected = tổng hợp các giá trị cột code
    $camerasSelected = $cctvs->pluck('code')->toArray();



    // $camerasSelected = $cctvs->pluck('code')->toArray();


    return response()->json(['camerasSelected' => $camerasSelected]);
  }
  public function getListToFilter()
  {
    // cctvMdl lấy tất cả giá trị cột location và lọc trùng lặp
    $locations = cctvMdl::select('location', 'code')->distinct()->get();
    $areas = cctvAreaMdl::all();
    $category = cctvCategoryMdl::all();
    return [
      'locations' => $locations,
      'areas' => $areas,
      'category' => $category,
    ];
  }
  public function getListCategory()
  {
    return cctvCategoryMdl::all();
  }
  public function getListArea()
  {
    return cctvAreaMdl::all();
  }
  public function getLocationByCodeCamera(Request $req)
  {
    $code = $req->input('code');
    $camera = cctvMdl::where('code', $code)->first();
    if ($camera) {
      return [
        'location' => $camera->location,
      ];
    } else {
      return [
        'Nofound',
      ];
    }
  }
  public function cameras()
  {
    return [
      'ret_code' => 0,
      'data' => cctvMdl::get(),
    ];
  }
  public function warnSyno(Request $req)
  {
    if ($req->hasFile('photo')) {
      $path = $req->file('photo')->store('cctv');
      $msg = (':rotating_light: ' . $req->ip);
      $t = [
        'msg_type' => 'm',
        'msg_method' => 'notify',
        'target' => 'VG-CCTV',
        'msg_subject' => '[VG-CCTV] New warning',
        'msg_body' => $msg,
        'msg_url' => 'http://gmo021.cansportsvg.com/api/storage/app/' . $path,
      ];
      msgCenterMsgDataTbl::insert($t);
      return [
        'ret_code' => 0,
        'msg' => 'Warned in Syno chat',
        'photo_path' => 'http://gmo021.cansportsvg.com/api/storage/app/' . $path,
      ];
    } else {
      return [
        'ret_code' => -1,
        'msg' => 'No photo uploaded',
      ];
    }
  }
  public function warning(Request $req)
  {
    $code = $req->code;
    $date = $req->date;
    if (!$code) {
      return [
        'ret_code' => -2,
        'msg' => 'CCTV code is required',
      ];
    }
    if (!$date) {
      return [
        'ret_code' => -3,
        'msg' => 'Captured date is required',
      ];
    }
    if ($req->hasFile('photo')) {
      $originalName = $req->file('photo')->getClientOriginalName();
      $path = "cctv/{$req->date}/{$req->code}";
      $req->file('photo')->storeAs($path, $originalName);
      $x = [];
      if ($req->hasFile('rois')) {
        $roiPath = $path . '/rois';
        foreach ($req->file('rois') as $roi) {
          $name = $roi->getClientOriginalName();
          $x[] = $name;
          $roi->storeAs($roiPath, $name);
        }
      }
      return [
        'ret_code' => 0,
        'msg' => "Photo {$originalName} has been stored in the cctv directory.",
        'photo_path' => 'http://gmo021.cansportsvg.com/api/storage/app/' . $path . '/' . $originalName,
        'rois' => $x,
      ];
    }
    return [
      'ret_code' => -1,
      'msg' => 'No file uploaded',
    ];
  }
  // dashboard
  public function removePhoto(Request $req)
  {
    $path = $req->photoData;
    if (file_exists(storage_path('app/cctv/' . $path))) {
      unlink(storage_path('app/cctv/' . $path));
      return [
        'ret_code' => 0,
        'msg' => 'File removed',
      ];
    } else {
      return [
        'ret_code' => -1,
        'msg' => 'File not found',
      ];
    }
  }

  public function getReport(Request $req)
  {
    $date = $req->input('date', date('Ymd'));
    $root = storage_path('app/cctv/');
    $directoryPath = $root . $date;

    if (!is_dir($directoryPath)) {
      return [];
    }

    $folderNames = array_filter(scandir($directoryPath), function ($item) use ($directoryPath) {
      return $item !== '.' && $item !== '..'
        && is_dir($directoryPath . '/' . $item)
        && $item !== 'thumbshot'
        && $item !== 'fullshot';
    });

    $timeslotList = [];

    if ($req->has('timeslot_list')) {
      $timeslotList = $req->timeslot_list;
    } else {
      for ($h = 0; $h < 24; $h++) {
        $timeslotList[] = sprintf("%02d:00", $h);
        $timeslotList[] = sprintf("%02d:30", $h);
      }
    }
    $resultList = [];
    foreach ($folderNames as $folderName) {
      $res = ['code' => $folderName] + array_fill_keys($timeslotList, []);
      $files = new \FilesystemIterator($directoryPath . '/' . $folderName);
      foreach ($files as $file) {
        if ($file->isFile()) {
          $time = $file->getBasename('.jpg');
          // echo json_encode(strpos($time, 'frame'));
          if (strpos($time, 'frame') !== false) {
            $time = str_replace('frame_', '', $time);
          }
          $hh = substr($time, 0, 2);
          $mm = substr($time, 2, 2);
          if ($mm >= 0 && $mm <= 15) {
            $slot = "$hh:00";
          } else if ($mm > 15 && $mm <= 30) {
            $slot = "$hh:15";
          } else if ($mm > 30 && $mm <= 45) {
            $slot = "$hh:30";
          } else if ($mm > 45) {
            $slot = "$hh:45";
          }
          $res[$slot][] = $date . '/' . $folderName . '/' . $file->getBasename();
        }
      }
      $resultList[] = $res;
    }

    $codes = array_column($resultList, 'code');

    // Truy vấn cctvMdl để lấy thông tin tương ứng với các mã code
    $cctvInfos = cctvMdl::whereIn('code', $codes)
      ->select('code', 'location', 'area', 'category')
      ->get()
      ->keyBy('code');

    // Gắn thông tin từ cctvMdl vào $resultList
    foreach ($resultList as &$result) {
      $code = $result['code'];
      if (isset($cctvInfos[$code])) {
        $result['location'] = $cctvInfos[$code]->location;
        $result['area'] = $cctvInfos[$code]->area;
        $result['category'] = $cctvInfos[$code]->category;
      }
    }

    return $resultList;
  }

  // management
  function getCctv()
  {
    // return cctvMdl::orderBy('updated_at', 'desc')->get();
    $cctvs = cctvMdl::orderBy('updated_at', 'desc')->get();

    // Duyệt qua từng CCTV để lấy thông tin category
    foreach ($cctvs as $cctv) {
      $categoryIds = json_decode($cctv->category);
      if (is_array($categoryIds)) {
        // Truy vấn bảng cctvCategoryMdl để lấy thông tin category
        $categories = cctvCategoryMdl::whereIn('id', $categoryIds)->get();
        $cctv->categories = $categories;
      }
      $areaId = JSON_decode($cctv->area);
      if (is_array($areaId)) {
        $areas = cctvAreaMdl::whereIn('id', $areaId)->get();
        $cctv->areas = $areas;
      }
    }

    return $cctvs;
  }
  // function addCctv(Request $req)
  // {
  //   $e = cctvMdl::where($req->only(["ip"]))->first();
  //   if ($e) {
  //     return [
  //       'ret_code' => -1,
  //       'msg' => 'CCTV already exists',
  //       'data' => $e,
  //     ];
  //   }
  //   $m = cctvMdl::create($req->only(['code', 'ip', 'location', 'status', 'category']));
  //   return [
  //     'ret_code' => 0,
  //     'msg' => 'Created new CCTV',
  //     'data' => $m,
  //   ];
  // }


  public function addCctv(Request $req)
  {
    $e = cctvMdl::where('ip', $req->input('ip'))->first();

    if ($e) {
      return [
        'ret_code' => -1,
        'msg' => 'CCTV đã tồn tại',
        'data' => $e,
      ];
    }

    // Decode location from JSON string
    $location = json_decode($req->input('location'), true);

    // Handle area and category inputs
    $area = $req->input('area');
    $category = $req->input('category');

    // Validate and sanitize area and category as arrays
    if (!is_array($area)) {
      $area = explode(',', $area); // Convert string to array if needed
    }

    if (!is_array($category)) {
      $category = explode(',', $category); // Convert string to array if needed
    }

    // Create CCTV record
    $m = cctvMdl::create([
      'code' => $req->input('code'),
      'ip' => $req->input('ip'),
      'threshold' => $req->input('threshold'),
      'location' => json_encode($location), // Save location as JSON string
      'status' => $req->input('status'),
      'area' => json_encode($area), // Save area as JSON string
      'category' => json_encode($category), // Save category as JSON string
    ]);

    return [
      'ret_code' => 0,
      'msg' => 'Tạo mới CCTV thành công',
      'data' => $m,
    ];
  }

  public function editCctv(Request $req)
  {
    $m = cctvMdl::find($req->id);
    if ($m == null) {
      return [
        'ret_code' => -1,
        'msg' => 'CCTV not found',
      ];
    }

    // Chuyển đổi area thành chuỗi JSON nếu cần thiết
    $area = $req->input('area');
    if (!is_array($area)) {
      $area = explode(',', $area);
    }
    // $areaJson = json_encode($area);
    $areaJson = empty($area) ? null : json_encode($area);

    // Chuyển đổi category thành chuỗi JSON
    $category = $req->input('category');
    if (is_string($category)) {
      $category = json_decode($category, true);
    }
    if (!is_array($category)) {
      $category = explode(',', $category);
    }
    // $categoryJson = json_encode($category);
    $categoryJson = empty($category) ? null : json_encode($category);

    try {
      $m->code = $req->input('code');
      $m->threshold = $req->input('threshold');
      $m->ip = $req->input('ip');
      $m->location = $req->input('location');
      $m->area = $areaJson;
      $m->status = $req->input('status');
      $m->category = $categoryJson;
      $m->save();
      return [
        'ret_code' => 0,
        'msg' => 'CCTV updated successfully',
        'data' => $m,
      ];
    } catch (\Exception $e) {
      return [
        'ret_code' => -1,
        'msg' => 'Failed to update CCTV',
        'error' => $e->getMessage(),
      ];
    }
  }
  public function editCctv__(Request $req)
  {
    // Tìm CCTV theo ID
    $m = cctvMdl::find($req->id);
    if ($m == null) {
      return [
        'ret_code' => -1,
        'msg' => 'CCTV not found',
      ];
    }

    try {
      // Cập nhật thông tin CCTV
      $m->code = $req->input('code');
      $m->ip = $req->input('ip');
      $m->location = $req->input('location');
      $m->status = $req->input('status');
      $m->category = $req->input('category');
      $m->save();

      return [
        'ret_code' => 0,
        'msg' => 'CCTV updated successfully',
        'data' => $m,
      ];
    } catch (\Exception $e) {
      // Xử lý lỗi nếu có
      return [
        'ret_code' => -1,
        'msg' => 'Failed to update CCTV',
        'error' => $e->getMessage(),
      ];
    }
  }
  /**
   * GET /api/cctv/layout
   * Lấy layout camera trên map.
   * Gộp layout + thông tin camera (ip, location…) nếu cần.
   */
  public function getCctvLayout()
  {
    // Lấy dữ liệu CCTV (giữ nguyên như cũ)
    $rows = cctv_layoutMdl::from('cctv_layout_tbl as l')
      ->join('cctv_tbl as c', 'c.code', '=', 'l.camera_code')
      ->selectRaw('
            l.id,
            l.camera_code,
            l.x_percent,
            l.y_percent,
            l.cam_type,
            l.view_distance,
            l.view_angle,
            l.view_radius,
            l.created_at,
            
            c.ip,
            c.location as location_json,
            c.status
        ')
      ->orderBy('l.camera_code')
      ->get();


    $sensors = sensorMdl::select(
      'device_id',
      'location',
      'x_percent',
      'y_percent',
      'sensor_type',
      'created_at'
    )->get();

    return [
      'ret_code' => 0,
      'msg' => 'OK',
      'data' => $rows,
      'sensors' => $sensors,
    ];
  }



  /**
   * POST /api/cctv/layout
   * Body:
   * {
   *   "items": [
   *     {
   *       "camera_code": "B1002",
   *       "cam_type": "upper",
   *       "x_percent": 30.123,
   *       "y_percent": 40.456,
   *       "view_distance": 100,
   *       "view_angle": 45,
   *       "view_radius": null
   *     },
   *     ...
   *   ]
   * }
   *
   * Logic: upsert theo camera_code (có thì update, không có thì insert).
   */

  public function saveSensorLayout(Request $req)
  {
    $items = $req->input('items', []);

    if (!is_array($items) || count($items) === 0) {
      return [
        'ret_code' => -1,
        'msg' => 'No layout items to save',
      ];
    }

    try {
      foreach ($items as $item) {
        if (empty($item['device_id']) || empty($item['location'])) {
          continue; // Bỏ qua nếu thiếu device_id hoặc location (cả 2 đều NOT NULL)
        }

        // UPDATE hoặc INSERT tùy theo tồn tại
        sensorMdl::updateOrCreate(
          ['device_id' => $item['device_id']], // điều kiện tìm
          [
            'location' => $item['location'],
            'x_percent' => isset($item['x_percent']) ? (float) $item['x_percent'] : null,
            'y_percent' => isset($item['y_percent']) ? (float) $item['y_percent'] : null,
            'sensor_type' => $item['sensor_type'] ?? null,
          ]
        );
      }

      return [
        'ret_code' => 0,
        'msg' => 'Layout saved successfully',
      ];
    } catch (\Throwable $e) {
      return [
        'ret_code' => -2,
        'msg' => 'Failed to save layout',
        'error' => $e->getMessage(),
      ];
    }
  }

  public function saveCctvLayout(Request $req)
  {
    $items = $req->input('items', []);

    if (!is_array($items) || count($items) === 0) {
      return [
        'ret_code' => -1,
        'msg' => 'No layout items to save',
      ];
    }

    try {
      foreach ($items as $item) {
        if (empty($item['camera_code'])) {
          continue;
        }

        // UPDATE hoặc INSERT tùy theo tồn tại
        cctv_layoutMdl::updateOrCreate(
          ['camera_code' => $item['camera_code']],  // điều kiện tìm
          [
            'x_percent' => isset($item['x_percent']) ? (float) $item['x_percent'] : 0,
            'y_percent' => isset($item['y_percent']) ? (float) $item['y_percent'] : 0,
            'cam_type' => $item['cam_type'] ?? 'upper',
            'view_distance' => isset($item['view_distance']) ? (float) $item['view_distance'] : null,
            'view_angle' => isset($item['view_angle']) ? (float) $item['view_angle'] : null,
            'view_radius' => isset($item['view_radius']) ? (float) $item['view_radius'] : null,
          ]
        );
      }

      return [
        'ret_code' => 0,
        'msg' => 'Layout saved successfully',
      ];
    } catch (\Throwable $e) {

      return [
        'ret_code' => -2,
        'msg' => 'Failed to save layout',
        'error' => $e->getMessage(),
      ];
    }
  }
  public function deleteCctvLayout(Request $req)
  {
    $cameraCode = $req->input('camera_code');

    if (!$cameraCode) {
      return [
        'ret_code' => -1,
        'msg' => 'camera_code is required',
      ];
    }

    // kiểm tra tồn tại
    $row = cctv_layoutMdl::where('camera_code', $cameraCode)->first();
    if (!$row) {
      return [
        'ret_code' => -2,
        'msg' => "Layout not found for camera_code = {$cameraCode}",
      ];
    }

    $row->delete();

    return [
      'ret_code' => 0,
      'msg' => "Deleted layout for {$cameraCode}",
    ];
  }
  public function deleteSensorLayout(Request $req)
  {
    $device_id = $req->input('device_id');

    if (!$device_id) {
      return [
        'ret_code' => -1,
        'msg' => 'camera_code is required',
      ];
    }

    // kiểm tra tồn tại
    $row = sensorMdl::where('device_id', $device_id)->first();
    if (!$row) {
      return [
        'ret_code' => -2,
        'msg' => "Layout not found for camera_code = {$device_id}",
      ];
    }

    $row->delete();

    return [
      'ret_code' => 0,
      'msg' => "Deleted layout for {$device_id}",
    ];
  }
  public function getUnmappedCctvForLayout()
  {
    // lấy list code đã có layout
    $layoutCodes = cctv_layoutMdl::pluck('camera_code')->toArray();

    $q = cctvMdl::query()
      // ->where('status', 'working')
      ->orderBy('code');

    if (!empty($layoutCodes)) {
      $q->whereNotIn('code', $layoutCodes);
    }

    // chỉ cần vài cột cơ bản
    $rows = $q->get(['code', 'location', 'status']);

    // tổng số camera chưa map
    $total = $rows->count();

    return [
      'ret_code' => 0,
      'msg' => 'OK',
      'total_unmapped' => $total,
      'data' => $rows,
    ];
  }


  public function insertWarningFromAVG(Request $req)
  {
    $cameraCode = $req->input('camera_code');
    $eventCode = $req->input('event_code');

    // SỬA: Nhận 'boxes' thay vì x, y riêng lẻ
    // Backend Python sẽ gửi 'boxes' dưới dạng chuỗi JSON
    $boxes = $req->input('boxes');

    if (!$cameraCode || !$eventCode) {
      return [
        'ret_code' => -1,
        'msg' => 'camera_code and event_code are required',
      ];
    }
    // Get current date for folder structure
    $date = date('Ymd');
    $basePath = storage_path('app/cctv/' . $date);
    // Create directories if they don't exist
    $fullshotDir = $basePath . '/fullshot';
    $thumbshotDir = $basePath . '/thumbshot';
    if (!is_dir($fullshotDir)) {
      mkdir($fullshotDir, 0755, true);
    }
    if (!is_dir($thumbshotDir)) {
      mkdir($thumbshotDir, 0755, true);
    }
    $fullshotPath = null;
    $thumbshotPath = null;
    // Handle fullshot file upload
    if ($req->hasFile('fullshot_url')) {
      $fullshotFile = $req->file('fullshot_url');
      $timestamp = date('His');
      $fullshotFilename = "{$cameraCode}_{$timestamp}_full.jpg";
      $fullshotFile->move($fullshotDir, $fullshotFilename);
      $fullshotPath = $date . '/fullshot/' . $fullshotFilename;
    }
    // Handle thumbshot file upload
    if ($req->hasFile('thumbshot_url')) {
      $thumbshotFile = $req->file('thumbshot_url');
      $timestamp = date('His');
      $thumbshotFilename = "{$cameraCode}_{$timestamp}_thumb.jpg";
      $thumbshotFile->move($thumbshotDir, $thumbshotFilename);
      $thumbshotPath = $date . '/thumbshot/' . $thumbshotFilename;
    }
    // Create record with file paths AND boxes
    // Note: Đảm bảo Model WarningMdl đã có 'boxes' trong $fillable
    $m = WarningMdl::create([
      'camera_code' => $cameraCode,
      'event_code' => $eventCode,
      'thumbshot_url' => $thumbshotPath,
      'fullshot_url' => $fullshotPath,
      'boxes' => $boxes, // Lưu danh sách tọa độ (JSON)
    ]);
    return [
      'ret_code' => 0,
      'msg' => 'Inserted warning from AVG',
      'data' => $m,
    ];
  }

  /**
   * Cập nhật trạng thái Đúng/Sai cho sự kiện (Chỉ áp dụng tại VG)
   */
  public function updateEventStatus(Request $req)
  {
    $id = $req->input('id');
    $status = $req->input('status'); // 'true' hoặc 'fail'

    if (!$id || !$status) {
      return [
        'ret_code' => -1,
        'msg' => 'ID and Status are required',
      ];
    }

    $event = WarningMdl::find($id);
    if (!$event) {
      return [
        'ret_code' => -1,
        'msg' => 'Event not found',
      ];
    }

    $event->status = $status;
    $event->save();

    return [
      'ret_code' => 0,
      'msg' => 'Status updated successfully',
      'data' => $event,
    ];
  }

  public function getRecentWarnings(Request $req)
  {
    // số phút gần nhất cần lấy, default 10, giới hạn 1–60 cho an toàn
    $minutes = (int) $req->input('minutes', 240);
    // if ($minutes <= 0 || $minutes > 60) {
    //     $minutes = 10;
    // }

    $query = WarningMdl::query()
      ->select([
        'id',
        'camera_code',
        'event_code',
        'thumbshot_url',
        'fullshot_url',
        'created_at',
      ])
      ->where('created_at', '>=', Carbon::now()->subMinutes($minutes))
      ->orderBy('created_at', 'desc');

    // optional: filter theo camera_code
    if ($req->filled('camera_code')) {
      $query->where('camera_code', $req->input('camera_code'));
    }

    $rows = $query->get()->map(function ($row) {
      return [
        'id' => $row->id,
        'camera_code' => $row->camera_code,
        'event_code' => $row->event_code,
        'thumbshot_url' => $row->thumbshot_url,
        'fullshot_url' => $row->fullshot_url,
        'created_at' => $row->created_at,
        // tiện cho FE:
        'created_unix' => strtotime($row->created_at),
      ];
    });

    return [
      'ret_code' => 0,
      'msg' => 'OK',
      'data' => $rows,
    ];
  }

  public function checkEmployeeStatus(Request $req)
  {
    try {
      $empno = $req->input('empno');
      $currentIp = $req->ip();
      // 1. Tìm nhân viên (Logic tìm flexible)
      $employee = employeeStatusMdl::where('empno', $empno)->first();

      // Nếu không tìm thấy và empno có số 0 ở đầu -> Thử bỏ số 0 tìm lại
      if (!$employee && substr($empno, 0, 1) === '0') {
        $empnoNoZero = ltrim($empno, '0');
        $employee = employeeStatusMdl::where('empno', $empnoNoZero)->first();
      }
      if ($employee) {
        $fingerprint = $req->input('fingerprint_hash');

        // 2. Timeout Check (30 giây Siêu nhanh)
        $lastActivity = $employee->last_activity ? Carbon::parse($employee->last_activity) : null;
        $isTimedOut = $lastActivity ? $lastActivity->diffInSeconds(now()) > 30 : true;

        // 3. Concurrent Login Check TRÊN DẤU VÂN TAY (Fingerprint)
        if ($employee->isOnline && !$isTimedOut) {
          // Chỉ chặn nếu TRÌNH DUYỆT KHÁC (Fingerprint hash khác nhau và không phải NULL)
          if ($employee->fingerprint_hash && $employee->fingerprint_hash !== $fingerprint) {
            return response()->json([
              'allow' => false,
              'reason' => 'concurrent_login',
              'detected_ip' => $employee->ip ?? 'Unknown',
              'is_manager' => 0
            ]);
          }
        }

        // 4. Cấp mã Phiên (Session) và Mã gia hạn (Refresh)
        $sessionToken = Str::random(40);
        $refreshToken = Str::random(60); // Mã gia hạn 7 ngày

        $employee->isOnline = 1;
        $employee->ip = $currentIp;
        $employee->session_token = $sessionToken;
        $employee->refresh_token = $refreshToken; // Lưu vào DB
        $employee->fingerprint_hash = $fingerprint; // Lưu vân tay máy tính
        $employee->last_activity = now();
        $employee->save();

        return response()->json([
          'allow' => true,
          'session_token' => $sessionToken,
          'refresh_token' => $refreshToken, // Trả về cho React lưu 7 ngày
          'is_manager' => $employee->is_manager
        ]);
      }
      return response()->json([
        'allow' => false,
        'is_manager' => 0
      ]);
    } catch (\Exception $e) {
      return response()->json([
        'allow' => false,
        'reason' => 'server_error',
        'message' => $e->getMessage()
      ], 200);
    }
  }
  public function heartbeat(Request $req)
  {
    $empno = $req->input('empno');

    // Tìm nhân viên (Flexible)
    $employee = employeeStatusMdl::where('empno', $empno)->first();
    if (!$employee && substr($empno, 0, 1) === '0') {
      $empnoNoZero = ltrim($empno, '0');
      $employee = employeeStatusMdl::where('empno', $empnoNoZero)->first();
    }

    if ($employee) {
      $token = $req->input('session_token');
      $fingerprint = $req->input('fingerprint_hash');

      // KIỂM TRA: Nếu mã phiên (session_token) khớp 100%
      // Chúng ta sẽ cho phép và cập nhật luôn vân tay mới (để hỗ trợ đa tab trên Brave/Chromium)
      if ($employee->isOnline == 1 && $employee->session_token === $token) {

        // Cập nhật vân tay mới nếu có thay đổi (tự chữa lành lỗi đa tab)
        if ($employee->fingerprint_hash !== $fingerprint) {
          $employee->fingerprint_hash = $fingerprint;
        }

        $employee->last_activity = now();
        $employee->save();
        return response()->json(['status' => 'ok']);
      }

      return response()->json([
        'status' => 'ignored',
        'reason' => 'session_mismatch',
        'debug' => [
          'is_online' => $employee ? $employee->isOnline : 'no_emp',
          'token_match' => $employee ? ($employee->session_token === $token) : false,
        ],
        'message' => 'Phiên làm việc không hợp lệ hoặc đã đăng nhập từ thiết bị khác.'
      ]);
    }
    return response()->json(['status' => 'error'], 404);
  }
  public function refreshToken(Request $req)
  {
    $empno = $req->input('empno');
    $refreshToken = $req->input('refresh_token');
    $fingerprint = $req->input('fingerprint_hash');

    // Tìm nhân viên (Chỉ dựa trên empno và refresh_token để vượt qua bộ lọc của Brave/Chromium)
    $employee = employeeStatusMdl::where('empno', $empno)
      ->where('refresh_token', $refreshToken)
      ->first();

    if (!$employee && substr($empno, 0, 1) === '0') {
      $empnoNoZero = ltrim($empno, '0');
      $employee = employeeStatusMdl::where('empno', $empnoNoZero)
        ->where('refresh_token', $refreshToken)
        ->first();
    }

    // Kiểm tra xem refresh_token có còn hạn (7 ngày) không
    if ($employee) {
      $updatedAt = Carbon::parse($employee->updated_at);
      if ($updatedAt->diffInDays(now()) > 7) {
        return response()->json(['allow' => false, 'reason' => 'refresh_token_expired'], 401);
      }

      // KIỂM TRA ĐA TAB: Nới lỏng thời gian kiểm tra lên 5 phút
      // Nếu họ đang Online hoặc mới Offline gần đây, ta ưu tiên trả về mã phiên CŨ.
      $lastActivity = $employee->last_activity ? Carbon::parse($employee->last_activity) : null;
      $isRecentlyActive = $lastActivity ? $lastActivity->diffInMinutes(now()) < 5 : false;

      if (($employee->isOnline == 1 || $isRecentlyActive) && $employee->session_token) {
        // Cập nhật lại vân tay đề phòng trình duyệt đổi mã
        if ($employee->fingerprint_hash !== $fingerprint) {
          $employee->fingerprint_hash = $fingerprint;
        }
        $employee->isOnline = 1;
        $employee->last_activity = now();
        $employee->save();

        return response()->json([
          'allow' => true,
          'session_token' => $employee->session_token,
          'is_manager' => $employee->is_manager
        ]);
      }

      // Nếu đã Offline quá lâu -> Cấp Session Token hoàn toàn mới
      $newSessionToken = Str::random(40);
      $employee->session_token = $newSessionToken;
      $employee->isOnline = 1;
      $employee->last_activity = now();
      $employee->save();

      return response()->json([
        'allow' => true,
        'session_token' => $newSessionToken,
        'is_manager' => $employee->is_manager
      ]);
    }

    return response()->json(['allow' => false, 'reason' => 'invalid_refresh_token'], 401);
  }
  public function logout(Request $req)
  {
    $empno = $req->input('empno');

    // Tìm nhân viên (Flexible)
    $employee = employeeStatusMdl::where('empno', $empno)->first();
    if (!$employee && substr($empno, 0, 1) === '0') {
      $empnoNoZero = ltrim($empno, '0');
      $employee = employeeStatusMdl::where('empno', $empnoNoZero)->first();
    }

    if ($employee) {
      $employee->isOnline = 0;
      // Không nên set ip = null để khi máy khác vào còn biết IP nào đang chiếm
      $employee->save();
      return response()->json(['status' => 'logged_out']);
    }
    return response()->json(['status' => 'error'], 404);
  }
  public function getManageWarnings(Request $req)
  {
    // ===== PAGINATION PARAMETERS =====
    $page = max(1, (int) $req->input('page', 1));
    $perPage = min(100, max(1, (int) $req->input('per_page', 20)));
    // ===== BASE QUERY (Camera & Date filters only) =====
    $baseQuery = WarningMdl::query();
    // 1. Filter by camera_code
    if ($req->filled('camera_code')) {
      $baseQuery->where('camera_code', 'like', '%' . $req->input('camera_code') . '%');
    }
    // 2. Filter by date range
    if ($req->filled('from_date')) {
      try {
        $fromDate = Carbon::parse($req->input('from_date'))->startOfDay();
        $baseQuery->where('created_at', '>=', $fromDate);
      } catch (\Exception $e) {
      }
    }
    if ($req->filled('to_date')) {
      try {
        $toDate = Carbon::parse($req->input('to_date'))->endOfDay();
        $baseQuery->where('created_at', '<=', $toDate);
      } catch (\Exception $e) {
      }
    }
    // ===== CALCULATE COUNTS (Group by event_code) =====
    // We use the base query (without event_code filter) to get counts for all tabs
    $countQuery = clone $baseQuery;
    $rawCounts = $countQuery->select('event_code', \DB::raw('count(*) as total'))
      ->groupBy('event_code')
      ->pluck('total', 'event_code')
      ->toArray();
    // Calculate 'all' count
    $totalAll = array_sum($rawCounts);
    // Standardize counts
    $eventCounts = [
      'all' => $totalAll,
      'smartphone' => $rawCounts['smartphone'] ?? 0,
      'intruder' => $rawCounts['intruder'] ?? 0,
      'fire' => $rawCounts['fire'] ?? 0,
      'crowb' => $rawCounts['crowb'] ?? 0,
      'crowb2' => $rawCounts['crowb2'] ?? 0,
    ];
    // ===== MAIN QUERY (Apply Event Code Filter) =====
    $query = clone $baseQuery;

    $query->select([
      'id',
      'camera_code',
      'event_code',
      'thumbshot_url',
      'fullshot_url',
      'boxes',
      'status',
      'created_at',
      // 'details'removed to avoid SQL error
    ]);
    if ($req->filled('event_code') && $req->input('event_code') !== 'all') {
      $query->where('event_code', $req->input('event_code'));
    }
    // ===== SORTING =====
    $sortBy = $req->input('sort_by', 'created_at');
    $sortOrder = strtolower($req->input('sort_order', 'desc'));
    $allowedSortFields = ['id', 'camera_code', 'event_code', 'created_at'];
    if (!in_array($sortBy, $allowedSortFields))
      $sortBy = 'created_at';
    if (!in_array($sortOrder, ['asc', 'desc']))
      $sortOrder = 'desc';

    $query->orderBy($sortBy, $sortOrder);
    // ===== PAGINATION =====
    $total = $query->count();
    $offset = ($page - 1) * $perPage;

    $rows = $query->offset($offset)
      ->limit($perPage)
      ->get()
      ->map(function ($row) {
        return [
          'id' => $row->id,
          'camera_code' => $row->camera_code,
          'event_code' => $row->event_code,
          'thumbshot_url' => $row->thumbshot_url,
          'fullshot_url' => $row->fullshot_url,
          'boxes' => $row->boxes,
          'status' => $row->status,
          'created_at' => $row->created_at,
          'created_unix' => strtotime($row->created_at),
        ];
      });
    $totalPages = (int) ceil($total / $perPage);
    return [
      'ret_code' => 0,
      'msg' => 'OK',
      'data' => [
        'items' => $rows,
        'counts' => $eventCounts, // Return calculated counts
        'pagination' => [
          'current_page' => $page,
          'per_page' => $perPage,
          'total' => $total,
          'total_pages' => $totalPages,
          'has_next' => $page < $totalPages,
          'has_prev' => $page > 1,
        ],
      ],
    ];
  }

  public function getCctvList(Request $req)
  {
    $page = max(1, (int) $req->input('page', 1));
    $perPage = max(1, (int) $req->input('per_page', 15));
    $sortField = $req->input('sort_field', 'id');
    $sortOrder = strtoupper($req->input('sort_order', 'ASC')) === 'DESC' ? 'DESC' : 'ASC';

    $allowedSortFields = ['id', 'code', 'ip', 'status', 'created_at', 'updated_at'];
    if (!in_array($sortField, $allowedSortFields)) {
      $sortField = 'id';
    }

    $query = cctvMdl::query();

    $search = $req->input('search');
    if ($search) {
      $query->where(function ($q) use ($search) {
        $q->where('code', 'like', "%{$search}%")
          ->orWhere('ip', 'like', "%{$search}%")
          ->orWhere('location', 'like', "%{$search}%");
      });
    }

    $total = $query->count();
    $offset = ($page - 1) * $perPage;

    $items = $query->orderBy($sortField, $sortOrder)
      ->offset($offset)
      ->limit($perPage)
      ->get();

    $totalPages = (int) ceil($total / $perPage);

    $allStats = cctvMdl::query()->selectRaw('count(*) as total, 
        sum(case when cctv_status = "online" or cctv_status is null then 1 else 0 end) as online,
        sum(case when cctv_status = "warning" then 1 else 0 end) as warning,
        sum(case when cctv_status = "offline" then 1 else 0 end) as offline')
      ->first();

    return [
      'ret_code' => 0,
      'msg' => 'OK',
      'data' => $items,
      'stats' => [
        'total' => (int) $allStats->total,
        'online' => (int) $allStats->online,
        'warning' => (int) $allStats->warning,
        'offline' => (int) $allStats->offline,
      ],
      'pagination' => [
        'current_page' => $page,
        'per_page' => $perPage,
        'total' => $total,
        'total_pages' => $totalPages,
      ]
    ];
  }

  public function add_camera(Request $req)
  {
    $m = new cctvMdl();
    return $this->save_camera_logic($m, $req);
  }

  public function update_camera(Request $req)
  {
    $m = cctvMdl::find($req->id);
    if ($m == null) {
      return [
        'ret_code' => -1,
        'msg' => 'CCTV not found',
      ];
    }
    return $this->save_camera_logic($m, $req);
  }

  public function delete_camera(Request $req)
  {
    $m = cctvMdl::find($req->id);
    if ($m) {
      $m->delete();
      return [
        'ret_code' => 0,
        'msg' => 'CCTV deleted successfully',
      ];
    }
    return [
      'ret_code' => -1,
      'msg' => 'CCTV not found',
    ];
  }

  public function proxySnapshot(Request $req)
  {
    $ip = $req->input('ip');
    if (!$ip) {
      return response()->json(['error' => 'IP is required'], 400);
    }
    $url = "http://10.13.34.154:8001/api/cctv/proxy/snapshot?ip=" . $ip;

    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, 1);
    curl_setopt($ch, CURLOPT_BINARYTRANSFER, 1);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);
    $data = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($httpCode === 200) {
      return response($data)->header('Content-Type', 'image/jpeg');
    }
    return response($data, $httpCode == 0 ? 502 : $httpCode);
  }

  public function saveAiConfig(Request $req)
  {
    $url = "http://10.13.34.154:8001/api/cctv/ai/config";
    $payload = $req->all();

    $ch = curl_init($url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
    curl_setopt($ch, CURLOPT_HTTPHEADER, ['Content-Type: application/json']);
    curl_setopt($ch, CURLOPT_TIMEOUT, 10);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $decoded = json_decode($response, true);
    if ($httpCode === 200) {
      return response()->json($decoded);
    }
    return response()->json($decoded ?: ['error' => 'Failed to save AI config'], $httpCode == 0 ? 502 : $httpCode);
  }

  private function save_camera_logic($m, Request $req)
  {
    try {
      $m->code = $req->input('code');
      $m->username = $req->input('username', 'ps');
      $m->password = $req->input('password', 'ps@12345');
      $m->ip = $req->input('ip');
      $m->threshold = $req->input('threshold', 0.6);
      $m->is_monitored = $req->input('is_monitored', 1);
      $m->alert_muted = $req->input('alert_muted', 0);
      $m->location = $req->input('location');

      if ($req->has('status')) {
        $m->status = $req->input('status');
      }
      if ($req->has('area')) {
        $m->area = is_array($req->input('area')) ? json_encode($req->input('area')) : $req->input('area');
      }
      if ($req->has('category')) {
        $m->category = is_array($req->input('category')) ? json_encode($req->input('category')) : $req->input('category');
      }

      $m->save();

      return [
        'ret_code' => 0,
        'msg' => 'Success',
        'data' => $m,
      ];
    } catch (\Exception $e) {
      return [
        'ret_code' => -1,
        'msg' => 'Failed to save CCTV',
        'error' => $e->getMessage(),
      ];
    }
  }
}

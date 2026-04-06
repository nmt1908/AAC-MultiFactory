<?php

namespace App;

use Illuminate\Database\Eloquent\Model;

class employeeStatusMdl extends Model
{
    protected $connection = 'cctv_db';
    protected $table = 'employee_status';
    protected $fillable = [
        'empno',
        'is_manager',
        'ip',
        'session_token',
        'refresh_token',    // Mã định danh dài hạn (7 ngày)
        'fingerprint_hash', // Mã vân tay phần cứng trình duyệt
        'last_activity',
        'cam_type',
        'isOnline',
        'created_at',
        'updated_at',
    ];
}

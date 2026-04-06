import sys
import os

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from main import get_conn_ch

query = """
CREATE TABLE IF NOT EXISTS `sensor_layout_tbl` ( 
  `id` BIGINT UNSIGNED AUTO_INCREMENT NOT NULL,
  `device_id` VARCHAR(50) NOT NULL,
  `location` VARCHAR(50) NOT NULL,
  `x_percent` DECIMAL(6,3) NULL DEFAULT NULL ,
  `y_percent` DECIMAL(6,3) NULL DEFAULT NULL ,
  `sensor_type` VARCHAR(30) NULL DEFAULT NULL ,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
   PRIMARY KEY (`id`),
   INDEX `idx_device_id` (`device_id`)
) ENGINE = InnoDB;
"""


def init():
    conn = get_conn_ch()
    try:
        with conn.cursor() as cur:
            cur.execute(query)
            print("sensor_layout_tbl created or already exists.")
        conn.commit()
    except Exception as e:
        print("Error:", e)
    finally:
        conn.close()


if __name__ == "__main__":
    init()

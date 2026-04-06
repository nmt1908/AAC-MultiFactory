import requests
from requests.auth import HTTPBasicAuth, HTTPDigestAuth
import os
import pymysql

# Defaults from main.py
DEFAULT_USER = "ps"
DEFAULT_PASS = "ps@12345"

# IPs to test from the screenshot/image
cams_to_test = [
    {"code": "F4025", "ip": "10.13.16.37"},
    {"code": "F4026", "ip": "10.13.16.38"},
    {"code": "A3008", "ip": "10.13.16.39"},
    {"code": "F4027", "ip": "10.13.16.44"},
    {"code": "F4028", "ip": "10.13.16.45"},
    {"code": "B3034_G", "ip": "10.13.14.30"},
    {"code": "B2030_G", "ip": "10.13.14.31"},
    {"code": "B3035", "ip": "10.13.14.32"},
]

def fetch_snapshot(ip, user, password):
    url = f"http://{ip}/cgi-bin/viewer/video.jpg?resolution=1280x720"
    try:
        # Try Basic Auth
        resp = requests.get(url, auth=HTTPBasicAuth(user, password), timeout=3)
        if resp.status_code == 200:
            return True, "Basic Auth OK", len(resp.content)
        
        # Try Digest Auth (if 401)
        if resp.status_code == 401:
            resp2 = requests.get(url, auth=HTTPDigestAuth(user, password), timeout=3)
            if resp2.status_code == 200:
                return True, "Digest Auth OK", len(resp2.content)
            return False, f"Digest Auth Fail (401)", 0
            
        return False, f"HTTP {resp.status_code}", 0
    except Exception as e:
        return False, str(e), 0

def main():
    print(f"{'Code':<10} | {'IP':<15} | {'Status':<10} | {'Method':<20} | {'Size'}")
    print("-" * 80)
    
    # Also check DB for unique credentials
    try:
        conn = pymysql.connect(host='10.1.16.89', user='root', password='admin', database='cctv_db')
        cur = conn.cursor(pymysql.cursors.DictCursor)
        cur.execute("SELECT code, ip, username, password FROM cctv_tbl WHERE ip IS NOT NULL")
        db_cams = {c['ip']: c for c in cur.fetchall()}
        conn.close()
    except Exception as e:
        # print(f"DB Error: {e}")
        db_cams = {}

    for cam in cams_to_test:
        ip = cam["ip"]
        code = cam["code"]
        
        # Use DB credentials if available, otherwise default
        db_info = db_cams.get(ip)
        user = (db_info["username"] if db_info and db_info["username"] else DEFAULT_USER) or DEFAULT_USER
        pwd = (db_info["password"] if db_info and db_info["password"] else DEFAULT_PASS) or DEFAULT_PASS
        
        success, msg, size = fetch_snapshot(ip, user, pwd)
        print(f"{code:<10} | {ip:<15} | {'SUCCESS' if success else 'FAIL':<10} | {msg:<20} | {size}")

if __name__ == "__main__":
    main()

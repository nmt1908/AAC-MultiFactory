@echo off
echo Starting AAC AI Consumer...
call conda activate AAC
cd /d "D:\cctv-map\AAC-CH-Server"
python main.py
pause

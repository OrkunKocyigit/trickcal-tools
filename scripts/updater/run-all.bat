@echo off
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    python -m venv .venv
    .venv\Scripts\pip install -r requirements.txt
)

call .venv\Scripts\activate.bat

python update_foods.py   || exit /b 1
python update_units.py   || exit /b 1
python update_gear.py    || exit /b 1
python update_stages.py  || exit /b 1

echo All updaters completed.

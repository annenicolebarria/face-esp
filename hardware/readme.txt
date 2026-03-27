HARDWARE WIRING

Board:
- Acebott Max V1

Pin assignment:
- Relay Input -> GPIO 26

Common wiring:
- Relay VCC -> 5V or VIN
- Relay GND -> GND

Signal wiring:
- Relay Input -> GPIO 26

Notes:
- The latest sketch now syncs relay + PIR + DHT11 through your local `face-api` server.
- Set `FACE_API_BASE_URL` in `hardware/face.ino` to the LAN IP of the PC running `face-api`.
- Set `DEVICE_SHARED_TOKEN` in `hardware/face.ino` to match `DEVICE_SHARED_TOKEN` in `face-api/.env`.
- If the relay behavior is reversed, swap RELAY_ON and RELAY_OFF in face.ino.

Suggested pin defines for face.ino:
- RELAY_PIN 26

RELAY + FAN WIRING

Suggested relay control pin:
- RELAY_PIN 26

Relay module to Acebott Max V1:
- Relay Input -> GPIO 26
- Relay VCC -> 5V or VIN
- Relay GND -> GND

Suggested pin define:
- RELAY_PIN 26

If your fan is AC mains:
- AC LIVE/HOT from source -> COMMON CONTACT
- NORMALLY OPEN -> Fan LIVE/HOT
- AC NEUTRAL -> Fan NEUTRAL directly
- AC EARTH -> Fan EARTH directly if applicable

If your fan is DC:
- Fan power supply positive -> COMMON CONTACT
- NORMALLY OPEN -> Fan positive
- Fan negative -> Power supply negative directly

Relay contact guide:
- COMMON CONTACT = common input
- NORMALLY OPEN = fan is OFF by default
- NORMALLY CLOSED = do not use if you want fan OFF by default

Exact fan + relay wiring:
- Power supply + -> COMMON CONTACT
- NORMALLY OPEN -> red wire ng fan
- Power supply - -> black wire ng fan

Acebott to relay module:
- Acebott GPIO26 -> Input ng relay
- Acebott 5V -> VCC ng relay
- Acebott GND -> GND ng relay

Offline website control:
- The Acebott creates its own Wi-Fi hotspot
- Wi-Fi name -> Acebott-Fan-Control
- Wi-Fi password -> 12345678
- Open -> 192.168.4.1
- Buttons available -> Fan ON, Fan OFF

Use these relay terminals:
- NORMALLY OPEN
- COMMON CONTACT
- Do not use NORMALLY CLOSED for this setup

Important safety note:
- If your fan is 220V AC, do not test exposed wiring while powered.
- Mains AC can kill. Insulate terminals properly and use a proper relay module rated for your fan load.
- For AC loads, it is best to have an electrician check the final wiring.

ESP32-CAM recognition:
- Set `RECOGNITION_SERVICE_BASE_URL` in `hardware/face-cam.ino` to the LAN IP of the PC running `face-recognition-service`.
- The camera keeps `/stream` and `/capture`, and also uploads a JPEG frame every few seconds to `/recognize?camera_id=ESP32-CAM-01`.

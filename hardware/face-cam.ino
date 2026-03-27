#include "esp_camera.h"
#include <WiFi.h>
#include <HTTPClient.h>
#include <WebServer.h>
#include <Preferences.h>

#define CAMERA_MODEL_AI_THINKER

#define PWDN_GPIO_NUM 32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 0
#define SIOD_GPIO_NUM 26
#define SIOC_GPIO_NUM 27
#define Y9_GPIO_NUM 35
#define Y8_GPIO_NUM 34
#define Y7_GPIO_NUM 39
#define Y6_GPIO_NUM 36
#define Y5_GPIO_NUM 21
#define Y4_GPIO_NUM 19
#define Y3_GPIO_NUM 18
#define Y2_GPIO_NUM 5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM 23
#define PCLK_GPIO_NUM 22

const char* DEFAULT_WIFI_SSID = "BARRIA_FAM";
const char* DEFAULT_WIFI_PASSWORD = "2771d5a44c";
const char* WIFI_SETUP_AP_SSID = "PTC-Camera-Setup";
const char* WIFI_SETUP_AP_PASSWORD = "12345678";

const char* CAMERA_ID = "ESP32-CAM-01";
const char* FACE_API_BASE_URL = "http://192.168.0.9:4000";
const char* CAMERA_SHARED_TOKEN = "ptc-camera-2026-03-26-H7mK4sQ8xP2cR9vL";
const char* RECOGNITION_SERVICE_BASE_URL = "http://192.168.0.9:8001";
const unsigned long RECOGNITION_PUSH_INTERVAL_MS = 2000;
const unsigned long HEARTBEAT_INTERVAL_MS = 5000;
const unsigned long WIFI_RECONNECT_INTERVAL_MS = 10000;
const uint16_t HTTP_TIMEOUT_MS = 2500;

WebServer server(80);
Preferences preferences;

static const char* STREAM_BOUNDARY = "frame";
unsigned long lastRecognitionPushAt = 0;
unsigned long lastHeartbeatAt = 0;
unsigned long lastReconnectAttemptAt = 0;
bool wifiConfigMode = false;
bool serverStarted = false;
String wifiSsid;
String wifiPassword;

bool initCamera() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.frame_size = FRAMESIZE_SVGA;
  config.pixel_format = PIXFORMAT_JPEG;
  config.grab_mode = CAMERA_GRAB_LATEST;
  config.fb_location = CAMERA_FB_IN_PSRAM;
  config.jpeg_quality = 8;
  config.fb_count = 1;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.print("Camera init failed: 0x");
    Serial.println(err, HEX);
    return false;
  }

  sensor_t* sensor = esp_camera_sensor_get();
  if (sensor) {
    sensor->set_brightness(sensor, 0);
    sensor->set_contrast(sensor, 2);
    sensor->set_saturation(sensor, 0);
    sensor->set_sharpness(sensor, 2);
    sensor->set_lenc(sensor, 1);
  }

  return true;
}

String htmlEscape(const String& input) {
  String output;
  output.reserve(input.length());
  for (size_t index = 0; index < input.length(); index++) {
    const char ch = input.charAt(index);
    if (ch == '&') {
      output += "&amp;";
    } else if (ch == '<') {
      output += "&lt;";
    } else if (ch == '>') {
      output += "&gt;";
    } else if (ch == '"') {
      output += "&quot;";
    } else if (ch == '\'') {
      output += "&#39;";
    } else {
      output += ch;
    }
  }
  return output;
}

String deviceIpLabel() {
  if (wifiConfigMode) {
    return WiFi.softAPIP().toString();
  }
  if (WiFi.status() == WL_CONNECTED) {
    return WiFi.localIP().toString();
  }
  return "not connected";
}

void loadWiFiCredentials() {
  preferences.begin("camwifi", true);
  wifiSsid = preferences.getString("ssid", DEFAULT_WIFI_SSID);
  wifiPassword = preferences.getString("pass", DEFAULT_WIFI_PASSWORD);
  preferences.end();
}

void saveWiFiCredentials(const String& ssid, const String& password) {
  preferences.begin("camwifi", false);
  preferences.putString("ssid", ssid);
  preferences.putString("pass", password);
  preferences.end();
  wifiSsid = ssid;
  wifiPassword = password;
}

void clearWiFiCredentials() {
  preferences.begin("camwifi", false);
  preferences.clear();
  preferences.end();
  wifiSsid = DEFAULT_WIFI_SSID;
  wifiPassword = DEFAULT_WIFI_PASSWORD;
}

void startConfigPortal() {
  if (wifiConfigMode) {
    return;
  }

  WiFi.disconnect();
  WiFi.mode(WIFI_AP);
  WiFi.softAP(WIFI_SETUP_AP_SSID, WIFI_SETUP_AP_PASSWORD);
  wifiConfigMode = true;

  Serial.println("[WIFI] Camera config mode enabled.");
  Serial.print("[WIFI] Connect to AP: ");
  Serial.println(WIFI_SETUP_AP_SSID);
  Serial.print("[WIFI] Setup portal IP: ");
  Serial.println(WiFi.softAPIP());
}

void stopConfigPortal() {
  if (!wifiConfigMode) {
    return;
  }

  WiFi.softAPdisconnect(true);
  wifiConfigMode = false;
}

bool connectWiFi(bool allowConfigFallback = true) {
  if (WiFi.status() == WL_CONNECTED) {
    stopConfigPortal();
    return true;
  }

  stopConfigPortal();
  WiFi.mode(WIFI_STA);
  WiFi.begin(wifiSsid.c_str(), wifiPassword.c_str());

  Serial.print("Connecting to WiFi");
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("WiFi connected. IP: ");
    Serial.println(WiFi.localIP());
    return true;
  }

  Serial.println("WiFi connection failed.");
  if (allowConfigFallback) {
    startConfigPortal();
  }
  return false;
}

String buildRootPage() {
  String page = R"HTML(
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ESP32-CAM Setup</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #0f172a; color: #e2e8f0; }
    .shell { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { width: min(94vw, 760px); background: #111827; border: 1px solid #334155; border-radius: 20px; padding: 22px; box-shadow: 0 20px 45px rgba(0, 0, 0, 0.35); }
    h1 { margin: 0 0 8px; font-size: 30px; }
    p { margin: 0 0 14px; color: #94a3b8; }
    .preview { width: 100%; border-radius: 14px; border: 1px solid #334155; background: #020617; margin-bottom: 18px; }
    .grid { display: grid; gap: 12px; margin: 16px 0; padding: 16px; border: 1px solid #334155; border-radius: 16px; background: #0f1b2e; }
    label { font-size: 12px; font-weight: 700; color: #cbd5e1; letter-spacing: 0.08em; text-transform: uppercase; }
    form { display: grid; gap: 12px; }
    input { width: 100%; padding: 12px 14px; border-radius: 12px; border: 1px solid #475569; background: #020617; color: #e2e8f0; font-size: 16px; box-sizing: border-box; }
    button, a { border: 0; border-radius: 14px; padding: 12px 14px; font-size: 15px; font-weight: 700; cursor: pointer; text-decoration: none; text-align: center; }
    .primary { background: #2563eb; color: #fff; }
    .secondary { background: #334155; color: #fff; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; }
    .password-row { display: flex; gap: 10px; align-items: center; }
    .password-row input { flex: 1; }
    .toggle-password { white-space: nowrap; background: #334155; color: #fff; border: 1px solid #475569; }
  </style>
</head>
<body>
  <div class="shell">
    <div class="card">
      <h1>ESP32-CAM Setup</h1>
      <p>Change WiFi locally without reflashing the camera.</p>
)HTML";

  if (!wifiConfigMode && WiFi.status() == WL_CONNECTED) {
    page += "<img class=\"preview\" src=\"/capture?t=" + String(millis()) + "\" alt=\"ESP32-CAM preview\" />";
  }

  page += R"HTML(
      <div class="grid">
        <div><strong>Mode:</strong> )HTML";
  page += wifiConfigMode ? "Setup AP" : "Connected";
  page += R"HTML(</div>
        <div><strong>Current SSID:</strong> )HTML";
  page += htmlEscape(wifiSsid);
  page += R"HTML(</div>
        <div><strong>Open this page at:</strong> )HTML";
  page += htmlEscape(deviceIpLabel());
  page += R"HTML(</div>
        <div><strong>Camera ID:</strong> )HTML";
  page += htmlEscape(CAMERA_ID);
  page += R"HTML(</div>
      </div>
      <form method="POST" action="/save-wifi">
        <div>
          <label for="ssid">WiFi Name</label>
          <input id="ssid" name="ssid" type="text" required value=")HTML";
  page += htmlEscape(wifiSsid);
  page += R"HTML(" />
        </div>
        <div>
          <label for="password">WiFi Password</label>
          <div class="password-row">
            <input id="password" name="password" type="password" value=")HTML";
  page += htmlEscape(wifiPassword);
  page += R"HTML(" />
            <button class="toggle-password" type="button" onclick="togglePassword()">Show</button>
          </div>
        </div>
        <button class="primary" type="submit">Save WiFi and Restart</button>
      </form>
      <form method="POST" action="/reset-wifi">
        <button class="secondary" type="submit">Reset Saved WiFi</button>
      </form>
)HTML";

  if (!wifiConfigMode && WiFi.status() == WL_CONNECTED) {
    page += R"HTML(
      <div class="actions">
        <a class="primary" href="/stream" target="_blank" rel="noopener noreferrer">Open Live Stream</a>
        <a class="secondary" href="/health" target="_blank" rel="noopener noreferrer">Health Check</a>
      </div>
)HTML";
  }

  page += R"HTML(
    <script>
      function togglePassword() {
        const passwordInput = document.getElementById('password');
        const toggleButton = document.querySelector('.toggle-password');
        const isHidden = passwordInput.type === 'password';
        passwordInput.type = isHidden ? 'text' : 'password';
        toggleButton.textContent = isHidden ? 'Hide' : 'Show';
      }
    </script>
    </div>
  </div>
</body>
</html>
)HTML";
  return page;
}

void handleRoot() {
  server.send(200, "text/html", buildRootPage());
}

void handleSaveWiFi() {
  const String nextSsid = server.arg("ssid");
  const String nextPassword = server.arg("password");

  if (nextSsid.length() == 0) {
    server.send(400, "text/html", buildRootPage());
    return;
  }

  saveWiFiCredentials(nextSsid, nextPassword);
  server.send(200, "text/html", "<html><body style='font-family:Arial;padding:24px;'>Saved. Device will restart now.</body></html>");
  delay(1200);
  ESP.restart();
}

void handleResetWiFi() {
  clearWiFiCredentials();
  server.send(200, "text/html", "<html><body style='font-family:Arial;padding:24px;'>Saved WiFi removed. Device will restart now.</body></html>");
  delay(1200);
  ESP.restart();
}

void handleHealth() {
  String json = "{";
  json += "\"ok\":true,";
  json += "\"connected\":" + String(WiFi.status() == WL_CONNECTED ? "true" : "false") + ",";
  json += "\"configMode\":" + String(wifiConfigMode ? "true" : "false") + ",";
  json += "\"cameraId\":\"" + String(CAMERA_ID) + "\"";
  json += "}";
  server.send(200, "application/json", json);
}

void handleCapture() {
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    server.send(500, "application/json", "{\"ok\":false,\"message\":\"Camera capture failed.\"}");
    return;
  }

  server.setContentLength(fb->len);
  server.send(200, "image/jpeg", "");

  WiFiClient client = server.client();
  client.write(fb->buf, fb->len);
  client.flush();
  esp_camera_fb_return(fb);
}

void handleStream() {
  WiFiClient client = server.client();
  server.setContentLength(CONTENT_LENGTH_UNKNOWN);
  server.send(200, "multipart/x-mixed-replace; boundary=frame", "");

  while (client.connected()) {
    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) {
      delay(30);
      continue;
    }

    client.printf("--%s\r\n", STREAM_BOUNDARY);
    client.print("Content-Type: image/jpeg\r\n");
    client.printf("Content-Length: %u\r\n\r\n", fb->len);
    client.write(fb->buf, fb->len);
    client.print("\r\n");

    esp_camera_fb_return(fb);

    if (!client.connected()) {
      break;
    }

    delay(30);
  }
}

void uploadFrameForRecognition() {
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("[RECOGNITION] Camera capture failed");
    return;
  }

  HTTPClient http;
  String url = String(RECOGNITION_SERVICE_BASE_URL) + "/recognize?camera_id=" + String(CAMERA_ID);

  if (!http.begin(url)) {
    Serial.println("[RECOGNITION] Failed to connect to service");
    esp_camera_fb_return(fb);
    return;
  }

  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "image/jpeg");
  int httpCode = http.POST(fb->buf, fb->len);
  String response = httpCode > 0 ? http.getString() : "";

  Serial.print("[RECOGNITION] HTTP ");
  Serial.println(httpCode);
  if (response.length() > 0) {
    Serial.println(response);
  }

  http.end();
  esp_camera_fb_return(fb);
}

void sendCameraHeartbeat() {
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  HTTPClient http;
  String url = String(FACE_API_BASE_URL) + "/api/camera/heartbeat";

  if (!http.begin(url)) {
    Serial.println("[HEARTBEAT] Failed to connect to face-api");
    return;
  }

  http.setTimeout(HTTP_TIMEOUT_MS);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-camera-token", CAMERA_SHARED_TOKEN);

  String payload = "{";
  payload += "\"cameraId\":\"" + String(CAMERA_ID) + "\"";
  payload += "}";

  int httpCode = http.POST(payload);
  String response = httpCode > 0 ? http.getString() : "";

  Serial.print("[HEARTBEAT] HTTP ");
  Serial.println(httpCode);
  if (response.length() > 0) {
    Serial.println(response);
  }

  http.end();
}

void startServer() {
  if (serverStarted) {
    return;
  }

  server.on("/", HTTP_GET, handleRoot);
  server.on("/save-wifi", HTTP_POST, handleSaveWiFi);
  server.on("/reset-wifi", HTTP_POST, handleResetWiFi);
  server.on("/health", HTTP_GET, handleHealth);
  server.on("/capture", HTTP_GET, handleCapture);
  server.on("/stream", HTTP_GET, handleStream);
  server.begin();
  serverStarted = true;

  Serial.println("HTTP server started.");
}

void setup() {
  Serial.begin(115200);
  delay(2000);

  if (!initCamera()) {
    return;
  }

  loadWiFiCredentials();
  connectWiFi(true);
  startServer();

  Serial.println("ESP32-CAM ready.");
  Serial.println("Send w = WiFi setup mode");
  Serial.println("Send r = Reset saved WiFi");
}

void loop() {
  server.handleClient();

  if (Serial.available() > 0) {
    char cmd = Serial.read();

    if (cmd == '\n' || cmd == '\r') {
      return;
    }

    if (cmd == 'w') {
      startConfigPortal();
    } else if (cmd == 'r') {
      clearWiFiCredentials();
      Serial.println("[WIFI] Saved credentials cleared. Restarting...");
      delay(1200);
      ESP.restart();
    }
  }

  if (WiFi.status() != WL_CONNECTED && !wifiConfigMode && millis() - lastReconnectAttemptAt >= WIFI_RECONNECT_INTERVAL_MS) {
    lastReconnectAttemptAt = millis();
    connectWiFi(true);
  }

  if (millis() - lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeatAt = millis();
    sendCameraHeartbeat();
  }

  if (millis() - lastRecognitionPushAt >= RECOGNITION_PUSH_INTERVAL_MS) {
    lastRecognitionPushAt = millis();
    uploadFrameForRecognition();
  }

  delay(2);
}

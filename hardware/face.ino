#include <WiFi.h>
#include <WiFiClient.h>
#include <HTTPClient.h>
#include <DHT.h>
#include <Preferences.h>
#include <WebServer.h>

#define RELAY_PIN 27
#define PIR_PIN 32
#define DHT_PIN 33
#define DHT_TYPE DHT11

const char* DEFAULT_WIFI_SSID = "BARRIA_FAM";
const char* DEFAULT_WIFI_PASSWORD = "2771d5a44c";
const char* WIFI_SETUP_AP_SSID = "PTC-Acebott-Setup";
const char* WIFI_SETUP_AP_PASSWORD = "12345678";

const char* FACE_API_BASE_URL = "http://192.168.0.9:4000";
const char* DEVICE_SHARED_TOKEN = "ptc-device-2026-03-26-J5nT8wE3yU6bC1qZ";
const char* DEVICE_KEY = "acebott-main-01";

const int RELAY_ON = LOW;
const int RELAY_OFF = HIGH;
const unsigned long SENSOR_READ_INTERVAL_MS = 1500;
const unsigned long SUPABASE_PUSH_INTERVAL_MS = 2000;
const unsigned long FAN_STATE_PULL_INTERVAL_MS = 700;
const unsigned long WIFI_RECONNECT_INTERVAL_MS = 10000;
const uint16_t HTTP_TIMEOUT_MS = 1200;

DHT dht(DHT_PIN, DHT_TYPE);
Preferences preferences;
WebServer server(80);

unsigned long lastSensorReadAt = 0;
unsigned long lastSupabasePushAt = 0;
unsigned long lastFanStatePullAt = 0;
unsigned long lastReconnectAttemptAt = 0;
int lastPirState = LOW;
bool relayIsOn = false;
bool wifiConfigMode = false;
bool serverStarted = false;
float lastHumidity = NAN;
float lastTemperatureC = NAN;
bool hasValidDhtReading = false;
String wifiSsid;
String wifiPassword;

void pushToFaceApi(int pirState);
void startConfigPortal();
void stopConfigPortal();

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
  preferences.begin("acebottwifi", true);
  wifiSsid = preferences.getString("ssid", DEFAULT_WIFI_SSID);
  wifiPassword = preferences.getString("pass", DEFAULT_WIFI_PASSWORD);
  preferences.end();
}

void saveWiFiCredentials(const String& ssid, const String& password) {
  preferences.begin("acebottwifi", false);
  preferences.putString("ssid", ssid);
  preferences.putString("pass", password);
  preferences.end();
  wifiSsid = ssid;
  wifiPassword = password;
}

void clearWiFiCredentials() {
  preferences.begin("acebottwifi", false);
  preferences.clear();
  preferences.end();
  wifiSsid = DEFAULT_WIFI_SSID;
  wifiPassword = DEFAULT_WIFI_PASSWORD;
}

void setRelayState(bool turnOn, bool force = false) {
  if (!force && relayIsOn == turnOn) {
    return;
  }

  relayIsOn = turnOn;
  digitalWrite(RELAY_PIN, turnOn ? RELAY_ON : RELAY_OFF);
  Serial.println(turnOn ? "Fan ON" : "Fan OFF");
}

void startConfigPortal() {
  if (wifiConfigMode) {
    return;
  }

  WiFi.disconnect();
  WiFi.mode(WIFI_AP);
  WiFi.softAP(WIFI_SETUP_AP_SSID, WIFI_SETUP_AP_PASSWORD);
  wifiConfigMode = true;

  Serial.println("[WIFI] Config mode enabled.");
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
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
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

String buildPortalPage(const String& notice = "") {
  String page = R"HTML(
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Acebott WiFi Setup</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #edf4ef; color: #143224; }
    .shell { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { width: min(92vw, 720px); background: #fff; border-radius: 20px; padding: 24px; box-shadow: 0 20px 45px rgba(10, 34, 23, 0.14); }
    h1 { margin: 0 0 8px; font-size: 30px; }
    p { margin: 0 0 14px; color: #4f675a; }
    .status { display: grid; gap: 10px; margin: 20px 0; padding: 16px; border: 1px solid #d7e7dc; border-radius: 16px; background: #f7fbf8; }
    .status strong { color: #143224; }
    form { display: grid; gap: 12px; margin-top: 18px; }
    label { font-size: 12px; font-weight: 700; color: #456455; letter-spacing: 0.08em; text-transform: uppercase; }
    input { width: 100%; padding: 12px 14px; border-radius: 12px; border: 1px solid #cfe0d4; font-size: 16px; box-sizing: border-box; }
    button { border: 0; border-radius: 14px; padding: 14px 16px; font-size: 16px; font-weight: 700; cursor: pointer; }
    .primary { background: #1c8c58; color: #fff; }
    .secondary { background: #eef5f0; color: #1d5d3d; border: 1px solid #d7e7dc; }
    .notice { margin-top: 14px; padding: 12px 14px; border-radius: 12px; background: #eef8f2; color: #116841; font-weight: 600; }
    .password-row { display: flex; gap: 10px; align-items: center; }
    .password-row input { flex: 1; }
    .toggle-password { white-space: nowrap; background: #eef5f0; color: #1d5d3d; border: 1px solid #d7e7dc; padding: 12px 14px; }
  </style>
</head>
<body>
  <div class="shell">
    <div class="card">
      <h1>Acebott WiFi Setup</h1>
      <p>Change WiFi locally without reflashing the board.</p>
      <div class="status">
        <div><strong>Mode:</strong> )HTML";
  page += wifiConfigMode ? "Setup AP" : "Connected";
  page += R"HTML(</div>
        <div><strong>Current SSID:</strong> )HTML";
  page += htmlEscape(wifiSsid);
  page += R"HTML(</div>
        <div><strong>Open this page at:</strong> )HTML";
  page += htmlEscape(deviceIpLabel());
  page += R"HTML(</div>
        <div><strong>Fan:</strong> )HTML";
  page += relayIsOn ? "ON" : "OFF";
  page += R"HTML( | <strong>PIR:</strong> )HTML";
  page += lastPirState == HIGH ? "ACTIVE" : "IDLE";
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
  if (notice.length() > 0) {
    page += "<div class=\"notice\">" + htmlEscape(notice) + "</div>";
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
  server.send(200, "text/html", buildPortalPage());
}

void handleSaveWiFi() {
  const String nextSsid = server.arg("ssid");
  const String nextPassword = server.arg("password");

  if (nextSsid.length() == 0) {
    server.send(400, "text/html", buildPortalPage("WiFi name is required."));
    return;
  }

  saveWiFiCredentials(nextSsid, nextPassword);
  server.send(200, "text/html", buildPortalPage("Saved. Device will restart now."));
  delay(1200);
  ESP.restart();
}

void handleResetWiFi() {
  clearWiFiCredentials();
  server.send(200, "text/html", buildPortalPage("Saved WiFi removed. Device will restart now."));
  delay(1200);
  ESP.restart();
}

void handleHealth() {
  String json = "{";
  json += "\"ok\":true,";
  json += "\"connected\":" + String(WiFi.status() == WL_CONNECTED ? "true" : "false") + ",";
  json += "\"configMode\":" + String(wifiConfigMode ? "true" : "false") + ",";
  json += "\"fanIsOn\":" + String(relayIsOn ? "true" : "false") + ",";
  json += "\"pirState\":" + String(lastPirState == HIGH ? "true" : "false") + ",";
  if (hasValidDhtReading) {
    json += "\"temperatureC\":" + String(lastTemperatureC, 2) + ",";
    json += "\"humidity\":" + String(lastHumidity, 2);
  } else {
    json += "\"temperatureC\":null,";
    json += "\"humidity\":null";
  }
  json += "}";
  server.send(200, "application/json", json);
}

void startServer() {
  if (serverStarted) {
    return;
  }

  server.on("/", HTTP_GET, handleRoot);
  server.on("/save-wifi", HTTP_POST, handleSaveWiFi);
  server.on("/reset-wifi", HTTP_POST, handleResetWiFi);
  server.on("/health", HTTP_GET, handleHealth);
  server.begin();
  serverStarted = true;

  Serial.println("[HTTP] Acebott local page ready.");
}

void pushToFaceApi(int pirState) {
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  HTTPClient https;
  String url = String(FACE_API_BASE_URL) + "/api/device/sensor-logs";

  if (!https.begin(url)) {
    Serial.println("[DEVICE] Failed to open face-api connection");
    return;
  }

  https.setTimeout(HTTP_TIMEOUT_MS);
  https.addHeader("Content-Type", "application/json");
  https.addHeader("x-device-token", DEVICE_SHARED_TOKEN);

  String payload = "{";
  payload += "\"device_key\":\"" + String(DEVICE_KEY) + "\",";
  payload += "\"deviceKey\":\"" + String(DEVICE_KEY) + "\",";
  payload += "\"pirState\":" + String(pirState == HIGH ? "true" : "false") + ",";
  payload += "\"fanIsOn\":" + String(relayIsOn ? "true" : "false") + ",";
  if (hasValidDhtReading) {
    payload += "\"temperatureC\":" + String(lastTemperatureC, 2) + ",";
    payload += "\"humidity\":" + String(lastHumidity, 2);
  } else {
    payload += "\"temperatureC\":null,";
    payload += "\"humidity\":null";
  }
  payload += "}";

  int httpCode = https.POST(payload);

  Serial.print("[DEVICE] HTTP ");
  Serial.println(httpCode);

  if (httpCode > 0) {
    String response = https.getString();
    if (response.length() > 0) {
      Serial.println(response);
    }
  }

  https.end();
}

bool fetchFanStateFromSupabase(bool& nextIsOn, String& updatedByLabel) {
  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }

  HTTPClient https;
  String url = String(FACE_API_BASE_URL)
    + "/api/device/fan-state?deviceKey=" + String(DEVICE_KEY);

  if (!https.begin(url)) {
    Serial.println("[FAN] Failed to open face-api connection");
    return false;
  }

  https.setTimeout(HTTP_TIMEOUT_MS);
  https.addHeader("x-device-token", DEVICE_SHARED_TOKEN);
  https.addHeader("Accept", "application/json");

  int httpCode = https.GET();
  if (httpCode <= 0) {
    Serial.print("[FAN] HTTP ");
    Serial.println(httpCode);
    https.end();
    return false;
  }

  String response = https.getString();
  https.end();

  if (response.indexOf("\"isOn\":true") >= 0) {
    nextIsOn = true;
  } else if (response.indexOf("\"isOn\":false") >= 0) {
    nextIsOn = false;
  } else {
    return false;
  }

  int labelIndex = response.indexOf("\"updatedBy\":\"");
  if (labelIndex >= 0) {
    int start = labelIndex + 13;
    int end = response.indexOf("\"", start);
    if (end > start) {
      updatedByLabel = response.substring(start, end);
    }
  }

  return true;
}

void syncRelayFromSupabase() {
  bool nextIsOn = relayIsOn;
  String updatedByLabel = "system";

  if (!fetchFanStateFromSupabase(nextIsOn, updatedByLabel)) {
    return;
  }

  if (nextIsOn != relayIsOn) {
    Serial.print("[FAN] Sync from cloud: ");
    Serial.println(updatedByLabel);
    setRelayState(nextIsOn);
  }
}

void setup() {
  Serial.begin(115200);
  delay(2000);

  pinMode(RELAY_PIN, OUTPUT);
  pinMode(PIR_PIN, INPUT);
  dht.begin();

  setRelayState(false, true);
  loadWiFiCredentials();
  connectWiFi(true);
  startServer();

  Serial.println("START");
  Serial.println("Relay -> GPIO27");
  Serial.println("PIR -> GPIO32");
  Serial.println("DHT11 -> GPIO33");
  Serial.println("Send 1 = ON");
  Serial.println("Send 0 = OFF");
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

    Serial.print("Received: ");
    Serial.println(cmd);

    if (cmd == '1') {
      setRelayState(true);
    } else if (cmd == '0') {
      setRelayState(false);
    } else if (cmd == 'w') {
      startConfigPortal();
    } else if (cmd == 'r') {
      clearWiFiCredentials();
      Serial.println("[WIFI] Saved credentials cleared. Restarting...");
      delay(1200);
      ESP.restart();
    } else {
      Serial.println("Unknown command");
    }
  }

  if (WiFi.status() != WL_CONNECTED && !wifiConfigMode && millis() - lastReconnectAttemptAt >= WIFI_RECONNECT_INTERVAL_MS) {
    lastReconnectAttemptAt = millis();
    connectWiFi(true);
  }

  int pirState = digitalRead(PIR_PIN);
  if (pirState != lastPirState) {
    lastPirState = pirState;
    Serial.println(pirState == HIGH ? "[PIR] Motion detected" : "[PIR] No motion");
    if (WiFi.status() == WL_CONNECTED) {
      pushToFaceApi(pirState);
      lastSupabasePushAt = millis();
    }
  }

  if (millis() - lastSensorReadAt >= SENSOR_READ_INTERVAL_MS) {
    lastSensorReadAt = millis();

    float humidity = dht.readHumidity();
    float temperatureC = dht.readTemperature();

    if (isnan(humidity) || isnan(temperatureC)) {
      hasValidDhtReading = false;
      Serial.println("[DHT11] Failed to read sensor");
    } else {
      hasValidDhtReading = true;
      lastHumidity = humidity;
      lastTemperatureC = temperatureC;
      Serial.print("[DHT11] Temperature: ");
      Serial.print(temperatureC);
      Serial.print(" C | Humidity: ");
      Serial.print(humidity);
      Serial.println(" %");
    }

    Serial.print("[STATUS] Fan: ");
    Serial.println(relayIsOn ? "ON" : "OFF");
    Serial.print("[STATUS] PIR: ");
    Serial.println(pirState == HIGH ? "ACTIVE" : "IDLE");
    Serial.println("------------------------------");
  }

  if (WiFi.status() == WL_CONNECTED && millis() - lastSupabasePushAt >= SUPABASE_PUSH_INTERVAL_MS) {
    lastSupabasePushAt = millis();
    pushToFaceApi(pirState);
  }

  if (WiFi.status() == WL_CONNECTED && millis() - lastFanStatePullAt >= FAN_STATE_PULL_INTERVAL_MS) {
    lastFanStatePullAt = millis();
    syncRelayFromSupabase();
  }
}

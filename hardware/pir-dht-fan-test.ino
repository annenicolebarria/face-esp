#include <DHT.h>

#define RELAY_PIN 27
#define PIR_PIN 32
#define DHT_PIN 33
#define DHT_TYPE DHT11

const int RELAY_ON = LOW;
const int RELAY_OFF = HIGH;

const unsigned long SENSOR_READ_INTERVAL_MS = 2000;

DHT dht(DHT_PIN, DHT_TYPE);

unsigned long lastSensorReadAt = 0;
int lastPirState = LOW;
bool relayIsOn = false;
bool autoMode = true;

void setRelayState(bool turnOn, bool force = false) {
  if (!force && relayIsOn == turnOn) {
    return;
  }

  relayIsOn = turnOn;
  digitalWrite(RELAY_PIN, turnOn ? RELAY_ON : RELAY_OFF);
  Serial.println(turnOn ? "[FAN] ON" : "[FAN] OFF");
}

void printHelp() {
  Serial.println("================================");
  Serial.println("PIR + DHT11 + FAN RELAY TEST");
  Serial.println("Pins:");
  Serial.println("  Relay -> GPIO27");
  Serial.println("  PIR   -> GPIO32");
  Serial.println("  DHT11 -> GPIO33");
  Serial.println("Commands:");
  Serial.println("  a = auto mode using PIR");
  Serial.println("  1 = manual fan ON");
  Serial.println("  0 = manual fan OFF");
  Serial.println("  s = show current status");
  Serial.println("================================");
}

void printStatus(float temperatureC, float humidity, bool hasDhtReading, int pirState) {
  Serial.println("--------------------------------");
  Serial.print("[MODE] ");
  Serial.println(autoMode ? "AUTO (PIR controls fan)" : "MANUAL");

  Serial.print("[PIR] ");
  Serial.println(pirState == HIGH ? "MOTION DETECTED" : "NO MOTION");

  Serial.print("[FAN] ");
  Serial.println(relayIsOn ? "ON" : "OFF");

  if (hasDhtReading) {
    Serial.print("[DHT11] Temperature: ");
    Serial.print(temperatureC, 1);
    Serial.println(" C");

    Serial.print("[DHT11] Humidity: ");
    Serial.print(humidity, 1);
    Serial.println(" %");
  } else {
    Serial.println("[DHT11] Failed to read sensor");
  }

  Serial.println("--------------------------------");
}

void setup() {
  Serial.begin(115200);
  delay(1500);

  pinMode(RELAY_PIN, OUTPUT);
  pinMode(PIR_PIN, INPUT);
  dht.begin();

  setRelayState(false, true);
  printHelp();
}

void loop() {
  if (Serial.available() > 0) {
    char cmd = Serial.read();

    if (cmd == '\n' || cmd == '\r') {
      return;
    }

    if (cmd == 'a' || cmd == 'A') {
      autoMode = true;
      Serial.println("[MODE] AUTO");
    } else if (cmd == '1') {
      autoMode = false;
      setRelayState(true);
      Serial.println("[MODE] MANUAL");
    } else if (cmd == '0') {
      autoMode = false;
      setRelayState(false);
      Serial.println("[MODE] MANUAL");
    } else if (cmd == 's' || cmd == 'S') {
      float humidity = dht.readHumidity();
      float temperatureC = dht.readTemperature();
      bool hasDhtReading = !(isnan(humidity) || isnan(temperatureC));
      int pirState = digitalRead(PIR_PIN);
      printStatus(temperatureC, humidity, hasDhtReading, pirState);
    } else {
      Serial.println("[CMD] Unknown command");
      printHelp();
    }
  }

  int pirState = digitalRead(PIR_PIN);
  if (pirState != lastPirState) {
    lastPirState = pirState;
    Serial.println(pirState == HIGH ? "[PIR] Motion detected" : "[PIR] No motion");

    if (autoMode) {
      setRelayState(pirState == HIGH);
    }
  }

  if (millis() - lastSensorReadAt >= SENSOR_READ_INTERVAL_MS) {
    lastSensorReadAt = millis();

    float humidity = dht.readHumidity();
    float temperatureC = dht.readTemperature();
    bool hasDhtReading = !(isnan(humidity) || isnan(temperatureC));

    if (autoMode) {
      setRelayState(pirState == HIGH);
    }

    printStatus(temperatureC, humidity, hasDhtReading, pirState);
  }
}

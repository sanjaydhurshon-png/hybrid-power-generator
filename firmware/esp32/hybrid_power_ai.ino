#include <Adafruit_INA219.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Wire.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <time.h>

#include "secrets.h"

static const char *READING_URL = API_BASE_URL "/api/energy/reading";
static const char *CHANNEL_A_MAPPING = INA219_A_MAPPING;
static const char *CHANNEL_B_MAPPING = INA219_B_MAPPING;
static const unsigned long SAMPLE_INTERVAL_MS = 5000;

Adafruit_INA219 ina219A(0x40);
Adafruit_INA219 ina219B(0x41);
bool ina219AReady = false;
bool ina219BReady = false;
unsigned long lastSampleAt = 0;

void setUnavailable(JsonObject channel) {
  channel["voltage_v"] = nullptr;
  channel["current_a"] = nullptr;
  channel["power_w"] = nullptr;
}

void measureChannel(Adafruit_INA219 &sensor, JsonObject channel) {
  const float voltage = sensor.getBusVoltage_V();
  const float current = sensor.getCurrent_mA() / 1000.0f;
  channel["voltage_v"] = voltage;
  channel["current_a"] = current;
  channel["power_w"] = voltage * current;
}

void assignSensor(const char *mapping, bool ready, Adafruit_INA219 &sensor, JsonObject sensors) {
  if (!mapping || strcmp(mapping, "unassigned") == 0) return;
  JsonObject channel = sensors[mapping].as<JsonObject>();
  if (channel.isNull()) return;
  if (ready) measureChannel(sensor, channel);
}

bool ensureWiFi() {
  if (WiFi.status() == WL_CONNECTED) return true;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  const unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < 15000) delay(250);
  return WiFi.status() == WL_CONNECTED;
}

bool makeTimestamp(char *output, size_t outputSize) {
  const time_t now = time(nullptr);
  if (now < 1700000000) return false;
  struct tm utc;
  gmtime_r(&now, &utc);
  return strftime(output, outputSize, "%Y-%m-%dT%H:%M:%SZ", &utc) > 0;
}

void sendReading() {
  if (!ensureWiFi()) {
    Serial.println("Wi-Fi unavailable; reading not sent.");
    return;
  }

  char timestamp[32];
  if (!makeTimestamp(timestamp, sizeof(timestamp))) {
    Serial.println("Clock is not synchronized; refusing an invalid timestamp.");
    return;
  }

  StaticJsonDocument<1024> document;
  document["device_id"] = DEVICE_ID;
  document["timestamp"] = timestamp;
  document["mode"] = "live";
  document["firmware_version"] = "1.0.0";

  JsonObject sensors = document.createNestedObject("sensors");
  JsonObject solar = sensors.createNestedObject("solar");
  JsonObject wind = sensors.createNestedObject("wind");
  JsonObject battery = sensors.createNestedObject("battery");
  JsonObject load = sensors.createNestedObject("load");
  setUnavailable(solar);
  setUnavailable(wind);
  setUnavailable(battery);
  setUnavailable(load);
  battery["soc_percent"] = nullptr;
  assignSensor(CHANNEL_A_MAPPING, ina219AReady, ina219A, sensors);
  assignSensor(CHANNEL_B_MAPPING, ina219BReady, ina219B, sensors);

  JsonObject status = document.createNestedObject("sensor_status");
  status["ina219_a"] = ina219AReady;
  status["ina219_b"] = ina219BReady;

  String body;
  serializeJson(document, body);
  WiFiClient client;
  HTTPClient http;
  if (!http.begin(client, READING_URL)) {
    Serial.println("Could not initialize the local HTTP request.");
    return;
  }
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + DEVICE_TOKEN);
  const int statusCode = http.POST(body);
  Serial.printf("Reading POST returned HTTP %d\n", statusCode);
  http.end();
}

void setup() {
  Serial.begin(115200);
  Wire.begin();
  ina219AReady = ina219A.begin();
  ina219BReady = ina219B.begin();
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  ensureWiFi();
  Serial.printf("INA219 A: %s; INA219 B: %s\n", ina219AReady ? "ready" : "unavailable", ina219BReady ? "ready" : "unavailable");
  Serial.println("Check and configure sensor mapping only after verifying the circuit.");
}

void loop() {
  if (millis() - lastSampleAt >= SAMPLE_INTERVAL_MS) {
    lastSampleAt = millis();
    sendReading();
  }
  delay(20);
}
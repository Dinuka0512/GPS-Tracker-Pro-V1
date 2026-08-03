#include <ESP8266WiFi.h>
#include <TinyGPSPlus.h>
#include <SoftwareSerial.h>
#include <Firebase_ESP_Client.h>

// ============================================================
//  WiFi Credentials
// ============================================================

#define WIFI_SSID "Dnk"
#define WIFI_PASSWORD "(Dinuka0512)"

// ============================================================
//  Firebase Realtime Database
// ============================================================

#define API_KEY "AIzaSyBVrJnMrRqApRnmTKZ3m3c2VJUfAbZ1GNo"
#define DATABASE_URL "https://gps-tracker-pro-35958-default-rtdb.firebaseio.com"

FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

// ============================================================
//  Device identity
// ============================================================

#define DEVICE_ID "GPS001"
#define DEVICE_NAME "Car Tracker"
#define DEVICE_TYPE "vehicle"
#define BATTERY_PERCENT 80

// ============================================================
//  GPS module (NodeMCU pinout)
// ============================================================

#define GPS_RX 5   // D1 on NodeMCU (GPIO5)
#define GPS_TX 4   // D2 on NodeMCU (GPIO4)

TinyGPSPlus gps;
SoftwareSerial gpsSerial(GPS_RX, GPS_TX);

unsigned long lastUpload = 0;
const unsigned long UPLOAD_INTERVAL_MS = 5000;
unsigned long lastGPSFix = 0;
const unsigned long GPS_TIMEOUT_MS = 10000;
bool firebaseInitialized = false;

// ============================================================
//  Setup
// ============================================================

void setup() {
  Serial.begin(115200);
  gpsSerial.begin(9600);

  Serial.println("\n\n==========================================");
  Serial.println("GPS Tracker Starting...");
  Serial.println("==========================================");

  // Connect to WiFi
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.println("✓ WiFi connected successfully!");
    Serial.print("IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println();
    Serial.println("✗ WiFi connection failed!");
    Serial.println("Please check SSID and password.");
  }

  // Configure Firebase
  Serial.println("\nConfiguring Firebase...");
  config.api_key = API_KEY;
  config.database_url = DATABASE_URL;
  
  // IMPORTANT: Enable Firebase Authentication
  // Use Email/Password authentication
  auth.user.email = "dinuka0512@gmail.com";  // Your Firebase Auth email
  auth.user.password = "111111";              // Your Firebase Auth password
  
  // Initialize Firebase
  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);
  
  // Test Firebase connection
  Serial.println("Testing Firebase connection...");
  if (Firebase.ready()) {
    Serial.println("✓ Firebase is ready!");
    firebaseInitialized = true;
    
    // Test write to Firebase
    Serial.println("Testing Firebase write...");
    if (Firebase.RTDB.setString(&fbdo, "/test/connection", "OK")) {
      Serial.println("✓ Firebase test write successful!");
    } else {
      Serial.println("✗ Firebase test write failed!");
      Serial.println("Error: " + fbdo.errorReason());
      Serial.println("\nPossible issues:");
      Serial.println("1. Firebase security rules deny write access");
      Serial.println("2. Authentication credentials are incorrect");
      Serial.println("3. Database URL is incorrect");
    }
  } else {
    Serial.println("✗ Firebase initialization failed!");
    Serial.println("Check API_KEY and DATABASE_URL");
    Serial.println("Make sure Email/Password auth is enabled in Firebase Console");
  }

  Serial.println("\nGPS Tracker Ready!");
  Serial.println("Device ID: " + String(DEVICE_ID));
  Serial.println("Waiting for GPS fix (may take 1-2 minutes)...");
  Serial.println("==========================================\n");
}

// ============================================================
//  Main Loop
// ============================================================

void loop() {
  // Read GPS data
  while (gpsSerial.available()) {
    char c = gpsSerial.read();
    gps.encode(c);
  }

  // Check if we have a valid GPS fix
  if (gps.location.isValid() && gps.time.isValid() && gps.date.isValid()) {
    lastGPSFix = millis();
    
    // Upload location at intervals
    if (millis() - lastUpload >= UPLOAD_INTERVAL_MS) {
      lastUpload = millis();
      
      // Check WiFi and Firebase before uploading
      if (WiFi.status() == WL_CONNECTED && firebaseInitialized) {
        uploadLocation();
      } else {
        Serial.println("⚠ Cannot upload - WiFi or Firebase not ready");
        if (WiFi.status() != WL_CONNECTED) {
          Serial.println("  WiFi disconnected");
          WiFi.reconnect();
        }
        if (!firebaseInitialized) {
          Serial.println("  Firebase not initialized");
          // Try to reinitialize Firebase
          Firebase.begin(&config, &auth);
          if (Firebase.ready()) {
            firebaseInitialized = true;
            Serial.println("✓ Firebase reinitialized");
          }
        }
      }
    }
  } else {
    // Check for GPS timeout
    if (millis() - lastGPSFix > GPS_TIMEOUT_MS && lastGPSFix != 0) {
      Serial.println("⚠ GPS signal lost - waiting for reconnection...");
      lastGPSFix = 0;
    }
    
    // Print status every 5 seconds
    static unsigned long lastStatusPrint = 0;
    if (millis() - lastStatusPrint > 5000) {
      lastStatusPrint = millis();
      Serial.print("Waiting for GPS fix... ");
      Serial.print("Satellites: ");
      Serial.println(gps.satellites.value());
    }
  }
}

// ============================================================
//  Upload Location to Firebase
// ============================================================

void uploadLocation() {
  const float lat = gps.location.lat();
  const float lng = gps.location.lng();
  const float speed = gps.speed.kmph();
  const float altitude = gps.altitude.meters();
  const int satellites = gps.satellites.value();
  const String isoTime = buildIsoTimestamp();

  Serial.println("\n========================================");
  Serial.println("📡 Uploading GPS Data to Firebase");
  Serial.println("========================================");
  Serial.print("📍 Latitude: ");
  Serial.println(lat, 6);
  Serial.print("📍 Longitude: ");
  Serial.println(lng, 6);
  Serial.print("💨 Speed: ");
  Serial.println(speed);
  Serial.print("⛰️ Altitude: ");
  Serial.println(altitude);
  Serial.print("🛰️ Satellites: ");
  Serial.println(satellites);
  Serial.print("🕐 Timestamp: ");
  Serial.println(isoTime);
  Serial.println("----------------------------------------");

  // 1. Latest snapshot -> devices/{deviceId}
  FirebaseJson snapshot;
  snapshot.set("deviceId", DEVICE_ID);
  snapshot.set("name", DEVICE_NAME);
  snapshot.set("type", DEVICE_TYPE);
  snapshot.set("latitude", lat);
  snapshot.set("longitude", lng);
  snapshot.set("speed", speed);
  snapshot.set("altitude", altitude);
  snapshot.set("satellites", satellites);
  snapshot.set("battery", BATTERY_PERCENT);
  snapshot.set("status", "online");
  snapshot.set("timestamp", isoTime);

  Serial.println("📤 Uploading to: /devices/" + String(DEVICE_ID));
  if (Firebase.RTDB.updateNode(&fbdo, String("/devices/") + DEVICE_ID, &snapshot)) {
    Serial.println("✓ Device snapshot updated successfully!");
  } else {
    Serial.println("✗ Error updating device snapshot:");
    Serial.println("  " + fbdo.errorReason());
  }

  // 2. Historical point -> history/{deviceId}
  FirebaseJson point;
  point.set("latitude", lat);
  point.set("longitude", lng);
  point.set("speed", speed);
  point.set("altitude", altitude);
  point.set("satellites", satellites);
  point.set("timestamp", isoTime);

  Serial.println("📤 Uploading to: /history/" + String(DEVICE_ID));
  if (Firebase.RTDB.pushJSON(&fbdo, String("/history/") + DEVICE_ID, &point)) {
    Serial.println("✓ History point pushed successfully!");
  } else {
    Serial.println("✗ Error pushing history point:");
    Serial.println("  " + fbdo.errorReason());
  }
  
  Serial.println("========================================\n");
}

// ============================================================
//  Build UTC ISO-8601 timestamp from GPS time
// ============================================================

String buildIsoTimestamp() {
  char buf[25];
  snprintf(buf, sizeof(buf), "%04d-%02d-%02dT%02d:%02d:%02d.000Z",
           gps.date.year(), 
           gps.date.month(), 
           gps.date.day(),
           gps.time.hour(), 
           gps.time.minute(), 
           gps.time.second());
  return String(buf);
}

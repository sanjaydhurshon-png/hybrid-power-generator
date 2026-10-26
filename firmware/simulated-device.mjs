const apiUrl = process.env.API_URL || "http://localhost:3000";
const intervalMs = Number(process.env.SIMULATED_DEVICE_INTERVAL_MS || 5000);
const deviceId = process.env.SIMULATED_DEVICE_ID || "SIM-ESP32-01";
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
let sample = 0;

async function sendSample() {
  const hour = new Date().getHours() + new Date().getMinutes() / 60;
  const daylight = Math.max(0, Math.sin(((hour - 6) / 12) * Math.PI));
  const solarPower = Number((4.5 * daylight * (0.75 + Math.random() * 0.25)).toFixed(3));
  const windPower = Number((0.15 + Math.random() * 0.7).toFixed(3));
  const loadPower = Number((1.2 + Math.random() * 1.1).toFixed(3));
  const payload = {
    device_id: deviceId,
    timestamp: new Date().toISOString(),
    mode: "simulation",
    firmware_version: "simulator-1.0.0",
    sensors: {
      solar: { voltage_v: 5, current_a: Number((solarPower / 5).toFixed(4)), power_w: solarPower },
      wind: { voltage_v: 5, current_a: Number((windPower / 5).toFixed(4)), power_w: windPower },
      battery: { voltage_v: Number((3.55 + 0.006 * (50 + 35 * Math.sin(sample / 50))).toFixed(3)), current_a: null, power_w: null, soc_percent: null },
      load: { voltage_v: 5, current_a: Number((loadPower / 5).toFixed(4)), power_w: loadPower },
    },
    sensor_status: { ina219_a: true, ina219_b: true },
  };
  try {
    const response = await fetch(`${apiUrl}/api/simulator/device-reading`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
    console.log(`${new Date().toISOString()} simulated reading accepted`);
  } catch (error) {
    console.error(`simulated reading failed: ${error instanceof Error ? error.message : error}`);
  }
  sample += 1;
}

console.log(`Sending clearly labeled simulation data to ${apiUrl}`);
await sendSample();
setInterval(sendSample, clamp(intervalMs, 1000, 60000));